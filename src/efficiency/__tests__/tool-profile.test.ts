import { describe, expect, it } from "vitest";
import { profileWorkflowTools } from "../tool-profile.js";

describe("privacy-safe workflow tool profiles", () => {
  it("profiles Codex discovery and verification without retaining commands or paths", () => {
    const trace = [
      codexCommand("/bin/zsh -lc \"pwd && rg --files | sed -n '1,120p'\""),
      codexCommand(
        "sed -n '1,120p' app/secret/CustomTabBar.tsx\n"
          + "sed -n '1,120p' app/secret/CustomTabBar.test.tsx",
      ),
      JSON.stringify({
        type: "item.completed",
        item: { type: "file_change", changes: [{ path: "app/secret/CustomTabBar.tsx" }] },
      }),
      codexCommand("/bin/zsh -lc 'npm test -- CustomTabBar'"),
      codexCommand("/bin/zsh -lc 'npm test -- CustomTabBar'"),
      codexCommand("git status --short"),
    ].join("\n");

    const profile = profileWorkflowTools("codex:gpt-5.6-sol:medium", trace);

    expect(profile).toMatchObject({
      schemaVersion: 1,
      provider: "codex",
      totalCalls: 5,
      preEditCalls: 2,
      postEditCalls: 3,
      categories: {
        search: 1,
        read: 1,
        verification: 2,
        status: 1,
        other: 0,
      },
      batchedReadCalls: 1,
      repeatedVerificationCalls: 1,
    });
    expect(profile.commandSequenceHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(profile)).not.toContain("CustomTabBar");
    expect(JSON.stringify(profile)).not.toContain("app/secret");
    expect(JSON.stringify(profile)).not.toContain("npm test");
  });

  it("profiles Claude tool use with the same model-agnostic schema", () => {
    const trace = [
      claudeTool("Glob", { pattern: "app/**/*.tsx" }),
      claudeTool("Read", { file_path: "app/private.tsx" }),
      claudeTool("Edit", { file_path: "app/private.tsx" }),
      claudeTool("Bash", { command: "/bin/zsh -lc 'npm test -- private'" }),
    ].join("\n");

    const profile = profileWorkflowTools("claude:sonnet:medium", trace);

    expect(profile).toMatchObject({
      schemaVersion: 1,
      provider: "claude",
      totalCalls: 4,
      preEditCalls: 2,
      postEditCalls: 2,
      categories: {
        search: 1,
        read: 1,
        verification: 1,
        status: 0,
        other: 1,
      },
      batchedReadCalls: 0,
      repeatedVerificationCalls: 0,
    });
    expect(JSON.stringify(profile)).not.toContain("private.tsx");
  });
});

function codexCommand(command: string): string {
  return JSON.stringify({
    type: "item.completed",
    item: {
      type: "command_execution",
      command,
      aggregated_output: "",
      exit_code: 0,
    },
  });
}

function claudeTool(name: string, input: Record<string, unknown>): string {
  return JSON.stringify({
    type: "assistant",
    message: {
      content: [{ type: "tool_use", id: `tool-${name}`, name, input }],
    },
  });
}
