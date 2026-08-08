import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  applyChangelogData,
  parseChangelogMarkdown,
} from "../../../scripts/build-changelog-preview.mjs";

describe("preview changelog sync", () => {
  it("keeps preview/changelog.html generated from CHANGELOG.md", async () => {
    const root = process.cwd();
    const [markdown, currentHtml, releaseManifest] = await Promise.all([
      readFile(join(root, "CHANGELOG.md"), "utf-8"),
      readFile(join(root, "preview", "changelog.html"), "utf-8"),
      readFile(join(root, "release-manifest.json"), "utf-8").then(JSON.parse),
    ]);

    const releases = parseChangelogMarkdown(markdown);
    const generatedHtml = applyChangelogData(currentHtml, releases, {
      releaseState: releaseManifest.releaseGroups.engine.state,
    });

    const engine = releaseManifest.releaseGroups.engine as {
      version: string;
      state: string;
    };
    expect(releases[0]).toMatchObject({
      version: `v${engine.version}`,
      commits: [["53ef8686", "fix: verify promoted public surfaces"]],
    });
    expect(generatedHtml).toContain(`memoire changelog - synced with CHANGELOG.md through ${releases[0].version}`);
    const expectedKicker = engine.state === "candidate" ? "Candidate release" : "Current release";
    expect(generatedHtml).toContain(`<span class="summary-kicker">${expectedKicker}</span>`);
    expect(currentHtml.replace(/\r\n/g, "\n")).toBe(
      generatedHtml.replace(/\r\n/g, "\n"),
    );
  });
});
