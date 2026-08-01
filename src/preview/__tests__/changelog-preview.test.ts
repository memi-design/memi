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

    expect(releases[0]).toMatchObject({
      version: "v2.7.4",
      commits: expect.arrayContaining([
        ["0568964b", "test: define 2.7.4 candidate release surfaces"],
        ["289bd728", "chore: prepare Memi 2.7.4 candidate"],
        ["cd5335b1", "chore: sync 2.7.4 candidate artifacts"],
      ]),
    });
    expect(generatedHtml).toContain(`memoire changelog - synced with CHANGELOG.md through ${releases[0].version}`);
    expect(generatedHtml).toContain('<span class="summary-kicker">Candidate release</span>');
    expect(generatedHtml).not.toContain('<span class="summary-kicker">Current release</span>');
    expect(currentHtml.replace(/\r\n/g, "\n")).toBe(
      generatedHtml.replace(/\r\n/g, "\n"),
    );
  });
});
