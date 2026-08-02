import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const taskRoot = path.join(
  process.cwd(),
  "docs/research/memi-2.7-prospective-study/v16-2.7.5-native-pilot/tasks",
);

describe("V16 native study task manifests", () => {
  it.each([
    "buzzr-tab-unread-badge",
    "paraform-command-menu",
    "nate-options-reduce-motion",
  ])("fails before provider invocation when %s cannot launch Node children", async (taskId) => {
    const task = JSON.parse(await readFile(path.join(taskRoot, `${taskId}.json`), "utf8")) as {
      preparation: Array<{ command: string; args: string[]; timeoutMs: number }>;
      fixtures: Array<{ path: string; content: string }>;
    };

    expect(task.preparation[0]).toEqual({
      command: "node",
      args: ["scripts/memi-v16-host-process-probe.mjs"],
      timeoutMs: 20_000,
    });
    expect(task.fixtures).toContainEqual(expect.objectContaining({
      path: "scripts/memi-v16-host-process-probe.mjs",
      content: expect.stringContaining("host-process-launch-unavailable"),
    }));
  });
});
