import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diagnoseAppQuality } from "../../app-quality/engine.js";
import { entryFromDiagnosis, historyPath } from "../../app-quality/history.js";
import { composeReport } from "../report-html.js";

describe("composeReport score trend honesty", () => {
  it("filters the SVG trend to comparable coverage fingerprints", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-report-html-trend-"));
    try {
      await mkdir(join(root, "src", "app"), { recursive: true });
      await writeFile(join(root, "src", "app", "page.tsx"), `
export default function Page() {
  return <main className="p-4 text-base"><button type="button">Save</button></main>;
}
`, "utf-8");

      const diagnosis = await diagnoseAppQuality({ projectRoot: root, write: true });
      const current = entryFromDiagnosis(diagnosis);
      const comparable = {
        ...current,
        at: "2026-07-24T00:00:00.000Z",
        score: 92,
      };
      const incomparable = {
        ...current,
        at: "2026-07-25T00:00:00.000Z",
        coverageFingerprint: "swiftui:partial:dimensions=:checks=swiftui.reduced-motion",
        score: 0,
      };
      const latest = {
        ...current,
        at: "2026-07-26T00:00:00.000Z",
        score: current.score,
      };
      await writeFile(
        historyPath(root),
        [comparable, incomparable, latest].map((entry) => JSON.stringify(entry)).join("\n") + "\n",
        "utf-8",
      );

      const report = await composeReport({ projectRoot: root });

      expect(report.markdown).toContain("2026-07-24");
      expect(report.markdown).toContain("2026-07-26");
      expect(report.markdown).not.toContain("2026-07-25");
      expect(report.html).toContain("2026-07-24");
      expect(report.html).toContain("2026-07-26");
      expect(report.html).not.toContain("2026-07-25");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
