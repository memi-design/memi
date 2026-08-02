import { mkdtemp, readFile, rm, writeFile, mkdir, chmod } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildHarnessCommand,
  classifyCliAuthResult,
  clearHarnessProbeCaches,
  listHarnesses,
} from "../harnesses.js";
import { defaultStudioConfig } from "../config.js";
import type { StudioAgentContext, StudioConfig, StudioHarnessId } from "../types.js";

function enableHarness(config: StudioConfig, harnessId: StudioHarnessId): StudioConfig {
  return {
    ...config,
    harnesses: config.harnesses.map((harness) => (
      harness.id === harnessId ? { ...harness, enabled: true } : harness
    )),
  };
}

function agentContext(root: string, prompt = "Audit the design system"): StudioAgentContext {
  return {
    workspaceLabel: "Memoire workspace",
    projectRoot: root,
    action: "audit",
    harness: "codex",
    mode: "delegate",
    chatMode: "ideate",
    permissionMode: "guarded",
    prompt,
    memory: {
      counts: { home: 1, research: 0, spec: 4, system: 7, monitor: 1, changelog: 0 },
      recent: [{ kind: "spec", title: "MetricCard", summary: "Molecule KPI component." }],
    },
    figma: {
      enabled: true,
      status: "disconnected",
      clients: 0,
      port: null,
    },
  };
}

describe("studio harnesses", () => {
  beforeEach(() => {
    clearHarnessProbeCaches();
  });

  it("builds Memoire native compose command with JSON output", () => {
    const root = "/tmp/project";
    const config = enableHarness(defaultStudioConfig(root), "memoire");

    const command = buildHarnessCommand(config, {
      harnessId: "memoire",
      cwd: root,
      prompt: "create a dashboard",
    });

    expect(command.args).toEqual(["compose", "create a dashboard", "--json", "--no-figma"]);
    expect(command.cwd).toBe(root);
  });

  it("prefers the local Memoire CLI source when running inside the active repo", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-studio-local-cli-"));
    try {
      await mkdir(join(root, "src"), { recursive: true });
      await mkdir(join(root, "node_modules", ".bin"), { recursive: true });
      await writeFile(join(root, "src", "index.ts"), "console.log('local memoire')\n");
      const tsxBin = join(
        root,
        "node_modules",
        ".bin",
        process.platform === "win32" ? "tsx.cmd" : "tsx",
      );
      await writeFile(tsxBin, process.platform === "win32" ? "@exit /b 0\r\n" : "#!/bin/sh\n");
      await chmod(tsxBin, 0o755);
      const config = enableHarness(defaultStudioConfig(root), "memoire");

      const command = buildHarnessCommand(config, {
        harnessId: "memoire",
        cwd: root,
        prompt: "create a dashboard",
      });

      expect(command.command).toContain(tsxBin);
      expect(command.args).toEqual(["src/index.ts", "compose", "create a dashboard", "--json", "--no-figma"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("builds external CLI harness commands without shell interpolation", () => {
    const root = "/tmp/project";
    const config = defaultStudioConfig(root);

    expect(buildHarnessCommand(config, {
      harnessId: "codex",
      cwd: root,
      prompt: "audit the app",
      action: "audit",
      agentContext: agentContext(root, "audit the app"),
    })).toMatchObject({
      command: "codex",
      args: expect.arrayContaining(["exec", "--json", "--model", "gpt-5.5", "-c", 'model_reasoning_effort="xhigh"', "-c", 'approval_policy="on-request"', "--sandbox", "workspace-write", "--skip-git-repo-check"]),
      cwd: root,
      outputParser: "codex-jsonl",
    });
    const codex = buildHarnessCommand(config, {
      harnessId: "codex",
      cwd: root,
      prompt: "audit the app",
      goal: "Keep the product designer workflow obvious.",
      action: "audit",
      agentContext: agentContext(root, "audit the app"),
    });
    expect(codex.args.at(-1)).toContain("# Mémoire Studio Agent Task");
    expect(codex.args.at(-1)).toContain("Codex GPT-5.5 design workspace");
    expect(codex.args.at(-1)).toContain("acceptance criteria");
    expect(codex.args.at(-1)).toContain("repo creation");
    expect(codex.args.at(-1)).toContain("UX research");
    expect(codex.args.at(-1)).toContain("Codex + Mémoire command ladder");
    expect(codex.args.at(-1)).toContain("memi research report --json");
    expect(codex.args.at(-1)).toContain("codex login status");
    expect(codex.args.at(-1)).toContain("model_reasoning_effort");
    expect(codex.args.at(-1)).toContain("- Chat mode: ideate");
    expect(codex.args.at(-1)).toContain("## Conversation goal");
    expect(codex.args.at(-1)).toContain("Keep the product designer workflow obvious.");
    expect(codex.args.at(-1)).toContain("- Permission mode: guarded");

    expect(buildHarnessCommand(config, {
      harnessId: "claude-code",
      cwd: root,
      prompt: "fix layout",
      action: "compose",
      agentContext: agentContext(root, "fix layout"),
    })).toMatchObject({
      command: "claude",
      args: expect.arrayContaining(["-p", "--verbose", "--output-format", "stream-json", "--include-partial-messages", "--permission-mode", "default", "--append-system-prompt"]),
      cwd: root,
      outputParser: "claude-stream-json",
    });
    const claude = buildHarnessCommand(config, {
      harnessId: "claude-code",
      cwd: root,
      prompt: "fix layout",
      action: "compose",
      agentContext: agentContext(root, "fix layout"),
    });
    expect(claude.args).toContain("--verbose");
    expect(claude.args.at(-1)).toContain("# Mémoire Studio Agent Task");
    expect(claude.args[claude.args.indexOf("--append-system-prompt") + 1]).toContain("Mémoire Studio design harness");
    expect(claude.args[claude.args.indexOf("--append-system-prompt") + 1]).toContain("Chat mode: ideate");
  });

  it("maps Codex permission modes to explicit sandbox power levels", () => {
    const root = "/tmp/project";
    const config = defaultStudioConfig(root);
    const commandForMode = (permissionMode: "plan" | "guarded" | "full_access") => buildHarnessCommand(config, {
      harnessId: "codex",
      cwd: root,
      prompt: "audit the app",
      action: "audit",
      permissionMode,
      agentContext: { ...agentContext(root, "audit the app"), permissionMode },
    }).args;

    expect(commandForMode("plan")).toEqual(expect.arrayContaining(["--sandbox", "read-only"]));
    expect(commandForMode("guarded")).toEqual(expect.arrayContaining(["--sandbox", "workspace-write"]));
    expect(commandForMode("full_access")).toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(commandForMode("full_access")).not.toContain("--sandbox");
  });

  it("applies Codex research settings without placing global flags after exec", () => {
    const root = "/tmp/project";
    const config: StudioConfig = {
      ...defaultStudioConfig(root),
      codex: {
        ...defaultStudioConfig(root).codex,
        model: "gpt-5.4",
        reasoningEffort: "high",
        approvalPolicy: "on-request",
        webSearch: true,
      },
    };

    const args = buildHarnessCommand(config, {
      harnessId: "codex",
      cwd: root,
      prompt: "research the onboarding market",
      action: "research",
      agentContext: {
        ...agentContext(root, "research the onboarding market"),
        action: "research",
        codex: config.codex,
      },
    }).args;

    expect(args.slice(0, 2)).toEqual(["--search", "exec"]);
    expect(args).toEqual(expect.arrayContaining([
      "--model",
      "gpt-5.4",
      "-c",
      'model_reasoning_effort="high"',
      "-c",
      'approval_policy="on-request"',
    ]));
    expect(args.indexOf("--search")).toBeLessThan(args.indexOf("exec"));
  });

  it("does not add Codex web search when research search is disabled", () => {
    const root = "/tmp/project";
    const config: StudioConfig = {
      ...defaultStudioConfig(root),
      codex: {
        ...defaultStudioConfig(root).codex,
        webSearch: false,
      },
    };

    const args = buildHarnessCommand(config, {
      harnessId: "codex",
      cwd: root,
      prompt: "research the onboarding market",
      action: "research",
      agentContext: { ...agentContext(root), action: "research", codex: config.codex },
    }).args;

    expect(args).not.toContain("--search");
    expect(args[0]).toBe("exec");
  });

  it("enables Hermes toolsets for memory, skills, terminal, and file-backed design work", () => {
    const root = "/tmp/project";
    const config = {
      ...defaultStudioConfig(root),
      harnesses: defaultStudioConfig(root).harnesses.map((harness) => harness.id === "hermes" ? { ...harness, enabled: true } : harness),
    };
    const command = buildHarnessCommand(config, {
      harnessId: "hermes",
      cwd: root,
      prompt: "Synthesize research into specs",
      action: "compose",
      agentContext: agentContext(root, "Synthesize research into specs"),
    });

    expect(command.command).toBe("hermes");
    expect(command.args).toEqual(expect.arrayContaining([
      "--toolsets",
      "terminal,file,memory,skills,todo,session_search,clarify",
      "--oneshot",
    ]));
    expect(command.args.at(-1)).toContain("Project memory");
    expect(command.outputParser).toBe("hermes-text");
  });

  it("blocks shell harness unless explicitly enabled", () => {
    const root = "/tmp/project";
    const config = defaultStudioConfig(root);

    expect(() => buildHarnessCommand(config, {
      harnessId: "shell",
      cwd: root,
      prompt: "echo unsafe",
    })).toThrow(/disabled/i);
  });

  it("marks installed harnesses by PATH lookup", () => {
    const root = "/tmp/project";
    const config = defaultStudioConfig(root);
    const harnesses = listHarnesses(config, {
      resolveCommand: (command) => command === "memi" ? "/usr/local/bin/memi" : null,
    });

    expect(harnesses.find((harness) => harness.id === "memoire")?.installed).toBe(true);
    expect(harnesses.find((harness) => harness.id === "codex")?.installed).toBe(false);
  });

  it("uses install probes instead of only the primary command", () => {
    const root = "/tmp/project";
    const config = defaultStudioConfig(root);
    const harnesses = listHarnesses(config, {
      resolveCommand: (command) => {
        if (command === "memoire") return "/usr/local/bin/memoire";
        if (command === "claude") return "/usr/local/bin/claude";
        if (command === "hermes") return "/usr/local/bin/hermes";
        return null;
      },
    });

    expect(harnesses.find((harness) => harness.id === "memoire")).toMatchObject({
      installed: true,
      resolvedPath: "/usr/local/bin/memoire",
    });
    expect(harnesses.find((harness) => harness.id === "claude-code")?.installed).toBe(true);
    expect(harnesses.find((harness) => harness.id === "hermes")?.installed).toBe(true);
  });

  it("caches CLI auth probes inside the harness probe TTL", async () => {
    const root = "/tmp/memoire-studio-auth-cache";
    const probeAuth = vi.fn(() => ({
      authStatus: "signed_in" as const,
      authMessage: "Codex logged in",
    }));
    const config = defaultStudioConfig(root);
    const resolveCommand = (command: string) => command === "codex" ? "/usr/local/bin/codex" : null;

    const first = listHarnesses(config, { resolveCommand, probeAuth });
    const second = listHarnesses(config, { resolveCommand, probeAuth });

    expect(first.find((harness) => harness.id === "codex")?.authStatus).toBe("signed_in");
    expect(second.find((harness) => harness.id === "codex")?.authStatus).toBe("signed_in");
    expect(probeAuth).toHaveBeenCalledTimes(1);
  });

  it("surfaces Codex config parse failures separately from login failures", () => {
    const result = classifyCliAuthResult({
      status: 1,
      stdout: "",
      stderr: "Error loading configuration: /tmp/project/.codex/config.toml:38:16: unknown variant `default`, expected `fast` or `flex`",
    }, "Codex");

    expect(result).toMatchObject({
      authStatus: "config_error",
      authMessage: expect.stringContaining("Fix Codex config"),
    });
    expect(result.authMessage).not.toMatch(/login/i);
  });
});
