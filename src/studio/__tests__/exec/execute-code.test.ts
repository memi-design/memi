import { describe, expect, it } from "vitest";
import { executeCode, resolveExecuteCodeCommand } from "../../exec/execute-code.js";
import type { ToolRunner } from "../../exec/tools-rpc-server.js";

function makeRunner(allowed: string[], handler: (tool: string, args: unknown) => unknown | Promise<unknown>): ToolRunner {
  return {
    allowedTools: () => allowed,
    run: async (ctx) => handler(ctx.tool, ctx.args),
  };
}

describe("exec/executeCode", () => {
  const successTimeoutMs = 20_000;

  it("launches the tsx module through Node instead of a platform shell shim", () => {
    const resolved = resolveExecuteCodeCommand("tsx", "C:\\Temp\\script.mts");

    expect(resolved.command).toBe(process.execPath);
    expect(resolved.args[0]?.replaceAll("\\", "/")).toMatch(/\/tsx\/dist\/cli\.mjs$/);
    expect(resolved.args[1]).toBe("C:\\Temp\\script.mts");
  });

  it("happy path: script that calls one tool and exits ok", async () => {
    const runner = makeRunner(["Echo"], (_tool, args) => {
      const a = args as { value: number };
      return a.value * 2;
    });
    const script = `
      import { Echo, exit } from "./memi_tools.mts";
      const result = await Echo({ value: 21 });
      await exit(true, { doubled: result });
    `;
    const result = await executeCode(
      {
        script,
        tools: [{ name: "Echo", argsType: "{ value: number }", resultType: "number" }],
        timeoutMs: successTimeoutMs,
      },
      runner,
    );
    expect(result.ok).toBe(true);
    expect(result.result).toEqual({ doubled: 42 });
    expect(result.exitCode).toBe(0);
  });

  it("script that calls many tools in a loop collapses N round-trips into one execute call", async () => {
    let runnerCalls = 0;
    const runner = makeRunner(["Inc"], (_tool, args) => {
      runnerCalls += 1;
      const a = args as { value: number };
      return a.value + 1;
    });
    const script = `
      import { Inc, exit } from "./memi_tools.mts";
      let n = 0;
      for (let i = 0; i < 10; i++) {
        n = await Inc({ value: n });
      }
      await exit(true, { total: n });
    `;
    const result = await executeCode(
      {
        script,
        tools: [{ name: "Inc", argsType: "{ value: number }", resultType: "number" }],
        timeoutMs: successTimeoutMs,
      },
      runner,
    );
    expect(result.ok).toBe(true);
    expect(result.result).toEqual({ total: 10 });
    expect(runnerCalls).toBe(10); // 10 tool calls happened, but only 1 LLM turn was needed to set this up
  });

  it("script that runs over the timeout is killed", async () => {
    const runner = makeRunner([], () => undefined);
    const script = `
      import { exit } from "./memi_tools.mts";
      // Hang forever
      await new Promise(() => {});
      await exit(true);
    `;
    const result = await executeCode(
      {
        script,
        tools: [],
        timeoutMs: 200,
      },
      runner,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/timed out/);
  });

  it("env scrub: API keys not forwarded to the child", async () => {
    const runner = makeRunner([], () => undefined);
    const original = process.env["ANTHROPIC_API_KEY"];
    process.env["ANTHROPIC_API_KEY"] = "sk-test-secret";
    try {
      const script = `
        import { exit } from "./memi_tools.mts";
        await exit(true, { hasKey: !!process.env.ANTHROPIC_API_KEY });
      `;
      const result = await executeCode(
        {
          script,
          tools: [],
          timeoutMs: successTimeoutMs,
        },
        runner,
      );
      expect(result.ok).toBe(true);
      expect((result.result as { hasKey: boolean }).hasKey).toBe(false);
    } finally {
      if (original === undefined) delete process.env["ANTHROPIC_API_KEY"];
      else process.env["ANTHROPIC_API_KEY"] = original;
    }
  });

  it("log() messages from the script reach the parent's logs array", async () => {
    const runner = makeRunner([], () => undefined);
    const script = `
      import { log, exit } from "./memi_tools.mts";
      await log("info", "step 1");
      await log("warn", "step 2");
      await exit(true);
    `;
    const result = await executeCode(
      {
        script,
        tools: [],
        timeoutMs: successTimeoutMs,
      },
      runner,
    );
    expect(result.ok).toBe(true);
    const messages = result.logs.map((l) => `${l.level}: ${l.message}`);
    expect(messages).toContain("info: step 1");
    expect(messages).toContain("warn: step 2");
  });

  it("captures script stdout + stderr separately", async () => {
    const runner = makeRunner([], () => undefined);
    const script = `
      import { exit } from "./memi_tools.mts";
      console.log("stdout-line");
      console.error("stderr-line");
      await exit(true);
    `;
    const result = await executeCode(
      {
        script,
        tools: [],
        timeoutMs: successTimeoutMs,
      },
      runner,
    );
    expect(result.ok).toBe(true);
    expect(result.stdout).toContain("stdout-line");
    expect(result.stderr).toContain("stderr-line");
  });
});
