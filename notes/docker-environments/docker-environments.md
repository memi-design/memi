# Docker Environments

---
name: Docker Environments
category: connect
activateOn: docker-environment
freedomLevel: high
version: 1.0.0
description: >
  Docker-aware Mémoire operation. Detects Dockerfile, docker-compose.yml, and
  .devcontainer/ in the project root and adapts the Mémoire pipeline accordingly.
  Covers Figma bridge port-forwarding, CI/CD headless audits, shared MCP server
  as a team service, agent worker containers, and devcontainer setup.
---

## 1. Auto-Detection

Mémoire activates this Note when any of the following are present in the project root:

| File / Directory | Signals |
|-----------------|---------|
| `Dockerfile` | Single-service container build |
| `docker-compose.yml` / `docker-compose.yaml` | Multi-service orchestration |
| `compose.yml` / `compose.yaml` | Compose v2 convention |
| `.devcontainer/devcontainer.json` | VS Code / Codespaces dev environment |
| `.devcontainer/docker-compose.yml` | Devcontainer with compose override |

**When detected, Mémoire applies these Docker-aware defaults:**
- Bridge discovery checks `localhost` AND `host.docker.internal`
- Preview server binds to `0.0.0.0` (not `127.0.0.1`)
- Port conflict warnings include Docker port-mapping guidance
- `memi doctor` output includes container networking status

---

## 2. Figma Bridge in Docker

**Problem:** Figma plugin runs on the host machine. Mémoire inside a container cannot auto-discover it — `localhost` inside the container is the container, not the host.

**Fix:** Forward the bridge port range from host to container.

```yaml
# docker-compose.yml
services:
  memoire:
    ports:
      - "9223-9232:9223-9232"  # Figma bridge range
```

```json
// .memoire/project.json
{
  "bridge": {
    "host": "0.0.0.0",
    "portRange": [9223, 9232]
  }
}
```

**When NOT to use Docker for canvas work:** If your primary workflow is Figma canvas operations (design, library, real-time sync), run Mémoire on the host. Port forwarding works but adds latency. Use Docker for CI, MCP, and agent workers.

---

## 3. CI/CD Headless Pipeline

### Headless-Safe Commands

| Command | Needs Bridge | CI-Safe |
|---------|-------------|---------|
| `memi audit --wcag` | No | Yes |
| `memi spec validate` | No | Yes |
| `memi generate` | No | Yes |
| `memi research synthesize` | No | Yes |
| `memi preview` | No | Yes |
| `memi pull` | Yes | No |
| `memi sync` | Yes | No |
| `memi connect` | Yes | No |

### Dockerfile (CI Build)

```dockerfile
FROM node:20-alpine AS base
WORKDIR /app
COPY package.json npm-shrinkwrap.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM base AS ci
ENV MEMOIRE_HEADLESS=true
ENV MEMOIRE_NO_BRIDGE=true
ENTRYPOINT ["node", "dist/cli.js"]
```

### docker-compose.yml with Profiles

```yaml
version: "3.9"
services:
  # Local dev — bridge enabled, ports forwarded
  memoire-dev:
    build: { context: ., target: base }
    profiles: ["dev"]
    ports:
      - "4400:4400"
      - "4401:4401"
      - "9223-9232:9223-9232"
    volumes: [".:/app", "/app/node_modules"]
    environment: [MEMOIRE_ENV=development]
    command: ["node", "dist/cli.js", "watch", "--code"]

  # CI — headless, no bridge
  memoire-ci:
    build: { context: ., target: ci }
    profiles: ["ci"]
    volumes: [".:/workspace"]
    working_dir: /workspace
    environment: [MEMOIRE_HEADLESS=true, MEMOIRE_NO_BRIDGE=true]
    command: ["node", "dist/cli.js", "audit", "--wcag", "--exit-code"]

  # MCP server — shared team service
  memoire-mcp:
    build: { context: ., target: base }
    profiles: ["mcp"]
    ports: ["4402:4402"]
    environment: [MEMOIRE_MCP_PORT=4402]
    command: ["node", "dist/cli.js", "mcp", "start"]
    restart: unless-stopped
```

### Running CI Audits

```bash
# Run headless WCAG audit
docker compose --profile ci run --rm memoire-ci

# Validate all specs
docker compose --profile ci run --rm memoire-ci \
  node dist/cli.js spec validate --all --strict

# Dry-run code generation
docker compose --profile ci run --rm memoire-ci \
  node dist/cli.js generate --dry-run
```

### GitHub Actions

```yaml
name: Design System CI
on: [push, pull_request]
jobs:
  design-audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: WCAG audit
        run: docker compose --profile ci run --rm memoire-ci
      - name: Validate specs
        run: docker compose --profile ci run --rm memoire-ci node dist/cli.js spec validate --all --strict
      - name: Generate (dry run)
        run: docker compose --profile ci run --rm memoire-ci node dist/cli.js generate --dry-run
```

### Exit Codes

| Code | Meaning | Gate |
|------|---------|------|
| `0` | All pass | — |
| `1` | Warnings | Fail with `--fail-on-warn` |
| `2` | Errors | Always fails |
| `3` | Critical violations | Always fails |

Soft policy: gate on `2+`. Strict policy: gate on `1+`.

---

## 4. Shared MCP Server (Team Service)

**Problem:** Each developer running `memi mcp start` locally produces divergent design system state.

**Fix:** Deploy one containerized MCP instance. All Claude Code and Cursor sessions on the team point to it.

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json npm-shrinkwrap.json ./
RUN npm ci
COPY . .
RUN npm run build
VOLUME ["/workspace/.memoire"]
EXPOSE 4402
CMD ["node", "dist/cli.js", "mcp", "start", "--port", "4402"]
```

**Claude Code config for each developer** — replace `localhost` with the shared host:

```json
{
  "mcpServers": {
    "memoire": {
      "url": "http://memoire.internal:4402/mcp",
      "transport": "http"
    }
  }
}
```

**Shared volume for `.memoire/` state:**

```yaml
services:
  memoire-mcp:
    volumes:
      - design-system:/workspace/.memoire
    command: ["node", "dist/cli.js", "mcp", "start"]

volumes:
  design-system:
    driver: local
    driver_opts:
      type: nfs
      o: addr=nas.internal,rw
      device: ":/design-system"
```

---

## 5. Agent Workers as Containers

Each role gets isolated resources, its own restart policy, and no shared process state.

```yaml
services:
  token-engineer:
    build: .
    command: ["node", "dist/cli.js", "agent", "spawn", "token-engineer"]
    environment: [MEMOIRE_AGENT_ROLE=token-engineer]
    restart: on-failure:3
    healthcheck:
      test: ["CMD", "node", "dist/cli.js", "agent", "status", "--role", "token-engineer", "--json"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 15s

  component-architect:
    build: .
    command: ["node", "dist/cli.js", "agent", "spawn", "component-architect"]
    environment: [MEMOIRE_AGENT_ROLE=component-architect]
    restart: on-failure:3

  accessibility-checker:
    build: .
    command: ["node", "dist/cli.js", "agent", "spawn", "accessibility-checker"]
    environment: [MEMOIRE_AGENT_ROLE=accessibility-checker]
    restart: on-failure:3

  orchestrator:
    build: .
    command: ["node", "dist/cli.js", "compose", "--listen"]
    depends_on: [token-engineer, component-architect, accessibility-checker]
    restart: unless-stopped
```

**Scale bottleneck roles** (the task queue is lock-based — multiple workers are safe):

```bash
docker compose up --scale code-generator=3
```

---

## 6. Devcontainer Support

```json
// .devcontainer/devcontainer.json
{
  "name": "Mémoire Dev",
  "dockerComposeFile": "docker-compose.yml",
  "service": "memoire-dev",
  "workspaceFolder": "/app",
  "features": {
    "ghcr.io/devcontainers/features/node:1": { "version": "20" }
  },
  "forwardPorts": [4400, 4401, 9223, 9224, 9225],
  "postCreateCommand": "npm ci && npm run build",
  "customizations": {
    "vscode": {
      "extensions": ["dbaeumer.vscode-eslint", "esbenp.prettier-vscode"]
    }
  },
  "remoteEnv": {
    "FIGMA_ACCESS_TOKEN": "${localEnv:FIGMA_ACCESS_TOKEN}",
    "MEMOIRE_ENV": "development"
  }
}
```

- `remoteEnv` forwards `FIGMA_ACCESS_TOKEN` from host shell — set once in `.zshrc`/`.bashrc`, never committed.
- VS Code auto-forwards ports in `forwardPorts`. The Figma plugin connects to `localhost:9223` on the host; VS Code tunnels it into the container transparently.

---

## 7. Environment Variables Reference

| Variable | Default | Purpose |
|----------|---------|---------|
| `MEMOIRE_HEADLESS` | `false` | Disables interactive TUI, uses JSON output |
| `MEMOIRE_NO_BRIDGE` | `false` | Skips Figma bridge discovery entirely |
| `MEMOIRE_ENV` | `development` | `development`, `ci`, `production` |
| `MEMOIRE_MCP_PORT` | `4402` | Port for MCP HTTP transport |
| `MEMOIRE_PREVIEW_PORT` | `4400` | Port for preview server |
| `MEMOIRE_DASHBOARD_PORT` | `4401` | Port for dashboard server |
| `MEMOIRE_BRIDGE_HOST` | `0.0.0.0` | Host to bind the WebSocket bridge listener |
| `MEMOIRE_AGENT_ROLE` | `general` | Role for a spawned agent worker |
| `FIGMA_ACCESS_TOKEN` | — | Figma REST API token (required for `memi pull`) |

Set in `.env` for local dev (never commit). Use Docker secrets or CI environment for production.

---

## 8. .memoire/project.json Docker Block

```json
{
  "docker": {
    "enabled": true,
    "mode": "dev",
    "bridge": {
      "host": "0.0.0.0",
      "portRange": [9223, 9232],
      "fallbackHost": "host.docker.internal"
    },
    "preview": { "host": "0.0.0.0", "port": 4400 },
    "ci": {
      "headless": true,
      "noBridge": true,
      "exitOnAuditError": true,
      "failOnWarn": false
    },
    "mcp": { "shared": true, "host": "memoire.internal", "port": 4402 }
  }
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `docker.mode` | `dev` | `dev`, `ci`, or `mcp` |
| `bridge.fallbackHost` | `host.docker.internal` | Fallback for Docker Desktop on Mac/Win |
| `ci.failOnWarn` | `false` | Exit non-zero on audit warnings |
| `mcp.shared` | `false` | Use shared remote MCP server |

---

## 9. Anti-Patterns

### Never: Run bridge exclusively in Docker for canvas work
Every canvas op adds a port-forward round trip. Run Mémoire on the host for design-heavy sessions.

### Never: Use root user in production containers
```dockerfile
# Bad
CMD ["node", "dist/cli.js"]

# Good
RUN addgroup -S memoire && adduser -S memoire -G memoire
USER memoire
CMD ["node", "dist/cli.js"]
```

### Never: Bake `.memoire/` into the image
Mount it as a volume. Baking it in means every spec change requires a rebuild.
```dockerfile
VOLUME ["/workspace/.memoire"]
```

### Never: Bind preview server to 127.0.0.1 in containers
Set `MEMOIRE_PREVIEW_HOST=0.0.0.0` or configure via `.memoire/project.json`.

### Never: Hardcode FIGMA_ACCESS_TOKEN in docker-compose.yml
```yaml
# Bad
environment: [FIGMA_ACCESS_TOKEN=figd_abc123...]

# Good — read from host env
environment: [FIGMA_ACCESS_TOKEN=${FIGMA_ACCESS_TOKEN}]

# Production — Docker secrets
secrets:
  figma_token: { external: true }
services:
  memoire-mcp:
    secrets: [figma_token]
    environment: [FIGMA_ACCESS_TOKEN_FILE=/run/secrets/figma_token]
```

### Never: Skip health checks on agent workers
Dead workers stall the task queue. The heartbeat timeout is 30s. Always add health checks and `restart: on-failure`.
