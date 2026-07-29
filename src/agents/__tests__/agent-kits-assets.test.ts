import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

interface AgentKitManifest {
  version: number;
  mirrorRepository: string;
  suiteManifest: string;
  daemon: {
    start: string;
    status: string;
  };
  references?: {
    craftSkills?: string;
    proofRepo?: string;
    githubAction?: string;
    skillsEcosystem?: string;
    grokDocs?: string;
  };
  targets: Array<{
    id: string;
    kind: string;
    source: string;
    sourceBase?: string;
    defaultDestination: string;
  }>;
}

interface CodexPluginManifest {
  name: string;
  version: string;
  description: string;
  homepage: string;
  privacyPolicyURL: string;
  termsOfServiceURL: string;
  skills: string;
  mcpServers: string;
  interface: {
    displayName: string;
    defaultPrompt: string[];
    privacyPolicyURL: string;
    termsOfServiceURL: string;
    composerIcon: string;
    logo: string;
    screenshots: string[];
  };
}

interface PluginMarketplace {
  name: string;
  interface: {
    displayName: string;
  };
  plugins: Array<{
    name: string;
    source: {
      source: string;
      path: string;
    };
    policy: {
      installation: string;
      authentication: string;
    };
    category: string;
  }>;
}

describe("packaged agent kits", () => {
  it("declares every external agent kit with existing source files", async () => {
    const root = process.cwd();
    const manifest = JSON.parse(
      await readFile(join(root, "agent-kits", "manifest.json"), "utf-8"),
    ) as AgentKitManifest;

    expect(manifest.mirrorRepository).toBe("sarveshsea/memoire-agent-skills");
    expect(manifest.suiteManifest).toBe("memoire.agent.yaml");
    expect(manifest.daemon.status).toBe("memi daemon status --json");
    expect(manifest.targets.map((target) => target.id)).toEqual([
      "universal",
      "universal",
      "universal",
      "universal",
      "hermes",
      "openclaw",
      "claude-code",
      "cursor",
      "codex",
      "codex",
      "codex",
      "codex",
      "opencode",
      "grok-build",
      "grok-build",
      "grok-build",
    ]);
    expect(manifest.references?.craftSkills).toBe("emilkowalski/skills");
    expect(manifest.references?.proofRepo).toBe("memi-design/design-sandbox");

    for (const target of manifest.targets) {
      const sourcePath = target.sourceBase === "package"
        ? join(root, target.source)
        : join(root, "agent-kits", target.source);
      const sourceStat = await stat(sourcePath);
      expect(sourceStat.isFile() || sourceStat.isDirectory()).toBe(true);
    }
  });

  it("ships a root Agent Skills package discoverable by npx skills add", async () => {
    const root = process.cwd();
    const rootSkill = await readFile(join(root, "skills", "memoire-design-tooling", "SKILL.md"), "utf-8");
    const codexSkill = await readFile(join(root, "agent-kits", "codex", "memoire-design-tooling", "SKILL.md"), "utf-8");
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf-8"));

    expect(pkg.files).toContain("skills");
    expect(rootSkill).toBe(codexSkill);
    expect(rootSkill).toContain("name: memoire-design-tooling");
    expect(rootSkill).toContain("memi agent install --dry-run --json");
    expect(rootSkill).toContain("memi mcp start --no-figma");
  });

  it("ships focused zero-setup skills for the four core design-agent jobs", async () => {
    const root = process.cwd();
    const focusedSkills = [
      "audit-frontend-design",
      "remember-design-system",
      "enforce-design-ci",
      "build-swiftui-interface",
    ];
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf-8"));

    for (const name of focusedSkills) {
      const skill = await readFile(join(root, "skills", name, "SKILL.md"), "utf-8");
      const lines = skill.split("\n");

      expect(skill).toMatch(new RegExp(`^---\\nname: ${name}\\ndescription: Use when `));
      expect(skill).toContain(`npx -y @memi-design/cli@${pkg.version}`);
      expect(skill).not.toContain("npm i -g");
      expect(skill).not.toContain("daemon start");
      expect(lines.length).toBeLessThanOrEqual(95);
      expect(Buffer.byteLength(skill, "utf-8")).toBeLessThanOrEqual(5_500);
    }
  });

  it("ships valid SKILL.md frontmatter for Hermes and OpenClaw", async () => {
    const root = process.cwd();
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf-8"));
    const hermesSkill = await readFile(join(root, "agent-kits", "hermes", "memoire-design-tooling", "SKILL.md"), "utf-8");
    const openClawSkill = await readFile(join(root, "agent-kits", "openclaw", "memoire-design-tooling", "SKILL.md"), "utf-8");

    for (const skill of [hermesSkill, openClawSkill]) {
      expect(skill).toMatch(/^---\n/);
      expect(skill).toContain("name: memoire-design-tooling");
      expect(skill).toContain("description: Use when");
      expect(skill).toMatch(/\n---\n\n# Memi Design Tooling/);
      expect(skill).toContain(`npx -y @memi-design/cli@${pkg.version}`);
      expect(skill).toContain("memoire.agent.yaml");
      expect(skill).not.toContain("npm i -g");
      expect(skill).not.toContain("daemon start");
      expect(skill).toContain("memi");
    }
    expect(openClawSkill).toContain("metadata:");
    expect(openClawSkill).toContain("\"openclaw\"");
  });

  it("keeps the npm runtime focused while retaining core skills and evidence", async () => {
    const pkg = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf-8"));
    expect(pkg.files).toEqual(expect.arrayContaining([
      "dist",
      "skills",
      "mcpb",
      "schemas/memi-runtime-trace-v1.schema.json",
      "docs/case-studies/memi-2.7-six-repo/README.md",
      "docs/case-studies/memi-2.7-six-repo/results.json",
    ]));
    expect(pkg.files).not.toEqual(expect.arrayContaining([
      "agent-kits",
      "plugins",
      "notes",
      "plugin",
      "assets",
      "docs/case-studies",
    ]));
  });

  it("ships registry-safe MCP config templates", async () => {
    const root = process.cwd();
    const claude = JSON.parse(await readFile(join(root, "agent-kits", "mcp", "claude-code", "mcp.json"), "utf-8"));
    const cursor = JSON.parse(await readFile(join(root, "agent-kits", "mcp", "cursor", "mcp.json"), "utf-8"));
    expect(claude.mcpServers.memoire.args).toEqual(["mcp", "start", "--no-figma"]);
    expect(cursor.mcpServers.memoire.args).toEqual(["mcp", "start", "--no-figma"]);
  });

  it("ships a Codex plugin manifest, MCP config, and synced skill", async () => {
    const root = process.cwd();
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf-8"));
    const manifest = JSON.parse(
      await readFile(join(root, "plugins", "memoire", ".codex-plugin", "plugin.json"), "utf-8"),
    ) as CodexPluginManifest;
    const mcpConfig = JSON.parse(await readFile(join(root, "plugins", "memoire", ".mcp.json"), "utf-8"));
    const pluginSkill = await readFile(join(root, "plugins", "memoire", "skills", "memoire-design-tooling", "SKILL.md"), "utf-8");
    const codexSkill = await readFile(join(root, "agent-kits", "codex", "memoire-design-tooling", "SKILL.md"), "utf-8");

    expect(manifest).toMatchObject({
      name: "memoire",
      version: pkg.version,
      homepage: "https://www.memoire.cv/codex-plugin",
      privacyPolicyURL: "https://www.memoire.cv/privacy",
      termsOfServiceURL: "https://www.memoire.cv/terms",
      skills: "./skills/",
      mcpServers: "./.mcp.json",
      interface: {
        displayName: "memi",
        privacyPolicyURL: "https://www.memoire.cv/privacy",
        termsOfServiceURL: "https://www.memoire.cv/terms",
      },
    });
    expect(manifest.description).toContain(
      "read-only design engineering audit and skill layer for coding agents",
    );
    expect(manifest.interface.defaultPrompt.length).toBeLessThanOrEqual(4);
    expect(manifest.interface.defaultPrompt).toContain("Audit this UI with memi before editing.");
    expect(manifest.interface.logo).toBeUndefined();
    expect(manifest.interface.composerIcon).toBeUndefined();
    expect(manifest.interface.screenshots).toBeUndefined();
    expect(mcpConfig.mcpServers.memoire).toMatchObject({
      command: "memi",
      args: ["mcp", "start", "--no-figma"],
      env: {
        FIGMA_TOKEN: "${FIGMA_TOKEN}",
        FIGMA_FILE_KEY: "${FIGMA_FILE_KEY}",
      },
    });
    expect(pluginSkill).toBe(codexSkill);
    for (const skillName of ["audit-frontend-design", "remember-design-system", "enforce-design-ci", "build-swiftui-interface"]) {
      const focusedPluginSkill = await readFile(join(root, "plugins", "memoire", "skills", skillName, "SKILL.md"), "utf-8");
      const focusedRootSkill = await readFile(join(root, "skills", skillName, "SKILL.md"), "utf-8");
      expect(focusedPluginSkill).toBe(focusedRootSkill);
    }
  });

  it("ships the Claude plugin with the same five zero-setup skills", async () => {
    const root = process.cwd();
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf-8"));
    const manifest = JSON.parse(await readFile(join(root, "plugins", "memi-claude", ".claude-plugin", "plugin.json"), "utf-8"));
    const skillNames = ["memoire-design-tooling", "audit-frontend-design", "remember-design-system", "enforce-design-ci", "build-swiftui-interface"];

    expect(manifest.version).toBe(pkg.version);
    for (const skillName of skillNames) {
      const skill = await readFile(join(root, "plugins", "memi-claude", "skills", skillName, "SKILL.md"), "utf-8");
      expect(skill).toContain(`name: ${skillName}`);
      expect(skill).toContain(`npx -y @memi-design/cli@${pkg.version}`);
      expect(skill).not.toContain("npm i -g");
      expect(skill).not.toContain("daemon start");
    }
  });

  it("documents public Git-backed Codex marketplace installation", async () => {
    const root = process.cwd();
    const readme = await readFile(join(root, "README.md"), "utf-8");
    const codexPage = await readFile(join(root, "docs", "CODEX_PLUGIN.md"), "utf-8");
    const smokeScript = await readFile(join(root, "scripts", "smoke-codex-plugin-marketplace.mjs"), "utf-8");
    const installCommand = "codex plugin marketplace add memi-design/memi --ref main --sparse .agents/plugins --sparse plugins/memoire";

    expect(readme).toContain(installCommand);
    expect(codexPage).toContain(installCommand);
    expect(codexPage).toContain("https://www.memoire.cv/codex-plugin");
    expect(smokeScript).toContain(installCommand);
  });

  it("declares the repo-local Codex plugin marketplace entry", async () => {
    const root = process.cwd();
    const marketplace = JSON.parse(
      await readFile(join(root, ".agents", "plugins", "marketplace.json"), "utf-8"),
    ) as PluginMarketplace;
    const entry = marketplace.plugins.find((plugin) => plugin.name === "memoire");

    expect(marketplace).toMatchObject({
      name: "memoire-local",
      interface: {
        displayName: "Memoire Local",
      },
    });
    expect(entry).toEqual({
      name: "memoire",
      source: {
        source: "local",
        path: "./plugins/memoire",
      },
      policy: {
        installation: "AVAILABLE",
        authentication: "ON_INSTALL",
      },
      category: "Productivity",
    });
  });

  it("excludes repository-only integration assets from npm pack output", () => {
    const npmCache = mkdtempSync(join(tmpdir(), "memoire-npm-cache-"));
    const pack = spawnSync("npm", ["pack", "--dry-run", "--json"], {
      cwd: process.cwd(),
      encoding: "utf-8",
      env: {
        ...process.env,
        npm_config_cache: npmCache,
        npm_config_update_notifier: "false",
      },
      maxBuffer: 8 * 1024 * 1024,
    });
    try {
      expect(pack.status, pack.stderr || pack.stdout).toBe(0);
    } finally {
      rmSync(npmCache, { recursive: true, force: true });
    }

    const [packageInfo] = JSON.parse(pack.stdout) as Array<{
      files: Array<{ path: string }>;
    }>;
    const paths = new Set(packageInfo.files.map((file) => file.path));
    expect(paths).toContain("skills/memoire-design-tooling/SKILL.md");
    expect(paths).toContain("schemas/memi-runtime-trace-v1.schema.json");
    expect(paths).toContain("docs/case-studies/README.md");
    expect(paths).toContain("mcpb/manifest.json");
    expect([...paths].filter((path) => /^(agent-kits|plugins|notes|plugin|assets)\//.test(path))).toEqual([]);
  });
});
