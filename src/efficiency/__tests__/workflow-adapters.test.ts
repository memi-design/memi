import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildPreparedToolEnvironment,
  buildClaudeWorkflowArgs,
  buildCodexWorkflowArgs,
  createClaudeWorkflowAdapter,
  createCodexWorkflowAdapter,
  parseClaudeOAuthCredential,
  parseClaudeStreamJson,
} from "../workflow-adapters.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe("model-agnostic workflow adapters", () => {
  it("builds isolated writable Codex arguments", () => {
    const args = buildCodexWorkflowArgs({
      workspaceRoot: "/tmp/workspace",
      modelId: "gpt-5.6-sol",
      reasoningEffort: "medium",
    });

    expect(args).toContain("--ignore-user-config");
    expect(args).toContain("workspace-write");
    expect(args).toContain("--ephemeral");
    expect(args).not.toContain("--dangerously-bypass-approvals-and-sandbox");
  });

  it("builds non-persistent Claude arguments with skills and MCP disabled", () => {
    const args = buildClaudeWorkflowArgs({
      modelId: "claude-sonnet-4-6",
      reasoningEffort: "medium",
    });

    expect(args).toContain("--disable-slash-commands");
    expect(args).toContain("--strict-mcp-config");
    expect(args).toContain("--no-session-persistence");
    expect(args).toContain("acceptEdits");
    expect(args).not.toContain("--dangerously-skip-permissions");
  });

  it("shares only the prepared Playwright browser cache with an isolated agent home", () => {
    const environment = buildPreparedToolEnvironment(
      { PATH: "/usr/bin" },
      "/tmp/isolated-home",
      "/Users/tester",
      "darwin",
    );

    expect(environment).toMatchObject({
      HOME: "/tmp/isolated-home",
      PATH: "/usr/bin",
      PLAYWRIGHT_BROWSERS_PATH: path.join(
        "/Users/tester",
        "Library",
        "Caches",
        "ms-playwright",
      ),
    });
    expect(environment.CODEX_HOME).toBeUndefined();
  });

  it("normalizes Claude usage, cost, tool calls, and failed tools", () => {
    const parsed = parseClaudeStreamJson([
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "tool_use", id: "tool-1", name: "Read" },
            { type: "tool_use", id: "tool-2", name: "Bash" },
          ],
        },
      }),
      JSON.stringify({
        type: "user",
        message: {
          content: [{
            type: "tool_result",
            tool_use_id: "tool-2",
            is_error: true,
          }],
        },
      }),
      JSON.stringify({
        type: "result",
        subtype: "success",
        result: "Implemented and verified.",
        total_cost_usd: 0.42,
        usage: {
          input_tokens: 1000,
          cache_read_input_tokens: 400,
          output_tokens: 200,
        },
      }),
    ].join("\n"));

    expect(parsed.finalResponse).toBe("Implemented and verified.");
    expect(parsed.usage).toEqual({
      inputTokens: 1000,
      cachedInputTokens: 400,
      outputTokens: 200,
      reasoningTokens: 0,
      estimatedCostUsd: 0.42,
    });
    expect(parsed.tools).toEqual({ calls: 2, errors: 1, retries: 0 });
    expect(parsed.failed).toBe(false);
  });

  it("recognizes Claude structured authentication failures even when the CLI exits zero", () => {
    const parsed = parseClaudeStreamJson([
      JSON.stringify({
        type: "assistant",
        error: "authentication_failed",
        message: { content: [{ type: "text", text: "Not logged in" }] },
      }),
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: true,
        result: "Not logged in",
        usage: {},
      }),
    ].join("\n"));

    expect(parsed.failed).toBe(true);
    expect(parsed.failure).toBe("authentication_failed");
  });

  it("accepts only unexpired Claude OAuth credentials", () => {
    const now = Date.parse("2026-07-29T20:00:00.000Z");
    const valid = JSON.stringify({
      claudeAiOauth: {
        accessToken: "test-oauth-token",
        expiresAt: now + 60_000,
      },
    });
    const expired = JSON.stringify({
      claudeAiOauth: {
        accessToken: "expired-token",
        expiresAt: now - 1,
      },
    });

    expect(parseClaudeOAuthCredential(valid, now)).toBe("test-oauth-token");
    expect(parseClaudeOAuthCredential(expired, now)).toBeNull();
  });

  it("executes Claude in an isolated home and retains streamed tool accounting", async () => {
    const root = await temporaryDirectory();
    const authHome = path.join(root, "claude-auth");
    const executable = path.join(root, "fixture-claude.cjs");
    await mkdir(authHome, { recursive: true });
    await writeFile(path.join(authHome, ".credentials.json"), JSON.stringify({
      claudeAiOauth: {
        accessToken: "fixture-token",
        expiresAt: Date.now() + 60_000,
      },
    }));
    await writeFile(executable, [
      "const events=[",
      "{type:'assistant',message:{content:[{type:'tool_use',id:'tool-1',name:'Bash'}]}},",
      "{type:'user',message:{content:[{type:'tool_result',tool_use_id:'tool-1',content:'done'}]}},",
      "{type:'result',subtype:'success',result:'ok',usage:{input_tokens:10,output_tokens:2}}",
      "];",
      "for(const event of events) process.stdout.write(JSON.stringify(event)+'\\n');",
    ].join("\n"));
    const adapter = createClaudeWorkflowAdapter({
      executable: process.execPath,
      executableArgs: [executable],
      modelId: "fixture-model",
      reasoningEffort: "low",
      authHome,
    });

    const result = await adapter.execute({
      workspaceRoot: root,
      prompt: "fixture prompt",
      timeoutMs: 2_000,
      maximumToolCalls: 4,
      maximumToolOutputBytes: 1_024,
    });

    expect(result.exitCode).toBe(0);
    expect(result.usage).toMatchObject({ inputTokens: 10, outputTokens: 2 });
    expect(result.tools).toMatchObject({ calls: 1, outputBytes: 4, errors: 0 });
  });

  it("escalates termination for a stubborn child while retaining complete output accounting", async () => {
    const root = await temporaryDirectory();
    const authHome = path.join(root, "auth");
    const executable = path.join(root, "stubborn-codex.cjs");
    await mkdir(authHome, { recursive: true });
    await writeFile(path.join(authHome, "auth.json"), "{}\n");
    await writeFile(executable, [
      "process.on('SIGTERM', () => {});",
      "const first={type:'item.started',item:{type:'command_execution',id:'call-1'}};",
      "const second={type:'item.completed',item:{type:'command_execution',id:'call-1',aggregated_output:'0123456789'}};",
      "process.stdout.write(JSON.stringify(first)+'\\n');",
      "process.stdout.write(JSON.stringify(second)+'\\n');",
      "setTimeout(() => process.exit(0), 1200);",
    ].join("\n"));
    const adapter = createCodexWorkflowAdapter({
      executable: process.execPath,
      executableArgs: [executable],
      modelId: "fixture-model",
      reasoningEffort: "low",
      authHome,
    });

    const started = performance.now();
    const result = await adapter.execute({
      workspaceRoot: root,
      prompt: "fixture prompt",
      timeoutMs: 5_000,
      maximumToolCalls: 4,
      maximumToolOutputBytes: 4,
    });
    const durationMs = performance.now() - started;

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("0123456789");
    expect(result.stderr).toContain("budget-exhausted:max-tool-output-bytes");
    expect(result.tools).toMatchObject({
      calls: 1,
      outputBytes: 10,
    });
    expect(durationMs).toBeLessThan(900);
  });

  it("stops Codex at the first reported input-token budget breach", async () => {
    const root = await temporaryDirectory();
    const authHome = path.join(root, "auth");
    const executable = path.join(root, "input-budget-codex.cjs");
    await mkdir(authHome, { recursive: true });
    await writeFile(path.join(authHome, "auth.json"), "{}\n");
    await writeFile(executable, [
      "process.on('SIGTERM', () => process.exit(0));",
      "process.stdout.write(JSON.stringify({type:'turn.completed',usage:{input_tokens:451,output_tokens:2,reasoning_output_tokens:1}})+'\\n');",
      "setTimeout(() => process.exit(0), 1200);",
    ].join("\n"));
    const adapter = createCodexWorkflowAdapter({
      executable: process.execPath,
      executableArgs: [executable],
      modelId: "fixture-model",
      reasoningEffort: "low",
      authHome,
    });

    const result = await adapter.execute({
      workspaceRoot: root,
      prompt: "fixture prompt",
      timeoutMs: 5_000,
      maximumToolCalls: 4,
      maximumToolOutputBytes: 1_024,
      maximumInputTokens: 450,
      maximumOutputTokens: 20,
      maximumReasoningTokens: 20,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("budget-exhausted:max-input-tokens");
    expect(result.usage).toMatchObject({ inputTokens: 451 });
  });

  it("preserves partial output when the adapter deadline terminates a stubborn child", async () => {
    const root = await temporaryDirectory();
    const authHome = path.join(root, "auth");
    const executable = path.join(root, "timeout-codex.cjs");
    await mkdir(authHome, { recursive: true });
    await writeFile(path.join(authHome, "auth.json"), "{}\n");
    await writeFile(executable, [
      "process.on('SIGTERM', () => {});",
      "process.stdout.write(JSON.stringify({type:'thread.started'})+'\\n');",
      "process.stderr.write('provider-stderr\\n');",
      "while (true) {}",
    ].join("\n"));
    const adapter = createCodexWorkflowAdapter({
      executable: process.execPath,
      executableArgs: [executable],
      modelId: "fixture-model",
      reasoningEffort: "low",
      authHome,
    });

    const result = await adapter.execute({
      workspaceRoot: root,
      prompt: "fixture prompt",
      timeoutMs: 500,
      maximumToolCalls: 4,
      maximumToolOutputBytes: 1_024,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("thread.started");
    expect(result.stderr).toContain("provider-stderr");
    expect(result.stderr).toContain("timeout-exhausted:500ms");
    expect(result.tools).toMatchObject({ calls: 0, outputBytes: 0 });
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "memi-adapter-test-"));
  temporaryDirectories.push(directory);
  return directory;
}
