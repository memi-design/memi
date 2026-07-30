import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diagnoseAppQuality } from "../engine.js";

describe("diagnoseAppQuality", () => {
  it("returns an explicit unassessed result for source repositories with no UI signal", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-app-quality-non-ui-"));
    try {
      await mkdir(join(root, "lib"), { recursive: true });
      await writeFile(
        join(root, "lib", "server.js"),
        "export function handle(request, response) { response.end('ok'); }\n",
        "utf-8",
      );

      const diagnosis = await diagnoseAppQuality({ projectRoot: root, write: false });

      expect(diagnosis.summary.scannedFiles).toBe(1);
      expect(diagnosis.summary.score).toBe(0);
      expect(diagnosis.summary.scoreScope).toBe("none");
      expect(diagnosis.summary.verdict).toBe("unassessed — no UI class signal found");
      expect(diagnosis.assessedDimensions).toEqual([]);
      expect(diagnosis.unassessedDimensions).toEqual([
        "accessibility",
        "color",
        "components",
        "maintainability",
        "responsive",
        "spacing",
        "typography",
        "visual-system",
      ]);
      expect(diagnosis.issues.map((issue) => issue.id)).toEqual(["scan.empty"]);
      expect(diagnosis.nextActions).toContain(
        "Run the audit against a route, app directory, or built HTML page with visible UI.",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("detects code-native design debt and writes reports", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-app-quality-"));
    try {
      await mkdir(join(root, "src", "components", "ui"), { recursive: true });
      await mkdir(join(root, "src", "app", "dashboard"), { recursive: true });
      await writeFile(join(root, "package.json"), JSON.stringify({ dependencies: { next: "15.0.0", tailwindcss: "4.0.0" } }), "utf-8");
      await writeFile(join(root, "src", "components", "ui", "button.tsx"), "export function Button(){ return null }\n", "utf-8");
      await writeFile(join(root, "src", "app", "dashboard", "page.tsx"), `
import { Button } from "@/components/ui/button";

export default function Dashboard() {
  return (
    <main className="p-1 p-2 p-3 p-4 p-5 p-6 p-7 p-8 p-9 text-xs text-sm text-base text-lg text-xl text-2xl text-[19px] bg-[#111111] text-[#fafafa] rounded-sm rounded-md rounded-lg rounded-xl rounded-[18px] shadow-sm shadow-md shadow-lg">
      <img src="/hero.png" />
      <Button className="bg-blue-500 hover:bg-blue-600">Ship</Button>
      <button onClick={() => null} className="px-[13px] py-[7px] bg-[#0055ff]">Raw</button>
    </main>
  );
}
`, "utf-8");

      const diagnosis = await diagnoseAppQuality({ projectRoot: root, write: true });

      expect(diagnosis.summary.scannedFiles).toBeGreaterThan(0);
      expect(diagnosis.summary.scannedBytes).toBeGreaterThan(0);
      expect(diagnosis.summary.scanMs).toBeGreaterThanOrEqual(0);
      expect(diagnosis.summary.analysisMs).toBeGreaterThanOrEqual(diagnosis.summary.scanMs ?? 0);
      expect(diagnosis.summary.score).toBeLessThan(100);
      expect(diagnosis.issues.map((issue) => issue.id)).toContain("color.raw-hex");
      expect(diagnosis.issues.map((issue) => issue.id)).toContain("a11y.image-alt");
      expect(diagnosis.ux.score).toBeLessThan(100);
      expect(diagnosis.ux.trapRisks.map((risk) => risk.trapId)).toContain("token-drift");
      expect(diagnosis.ux.findings.map((finding) => finding.id)).toContain("ux.color.raw-hex");
      expect(diagnosis.directions.map((direction) => direction.id)).toContain("premium-saas");
      await expect(readFile(join(root, ".memoire", "app-quality", "diagnosis.json"), "utf-8")).resolves.toContain("\"version\": 1");
      await expect(readFile(join(root, ".memoire", "app-quality", "diagnosis.md"), "utf-8")).resolves.toContain("# Memoire App Diagnosis");
      await expect(readFile(join(root, ".memoire", "app-quality", "diagnosis.md"), "utf-8")).resolves.toContain("## UX Tenets and Traps");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("scopes default scans away from generated bundles and agent scratch artifacts", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-app-quality-scope-"));
    try {
      await mkdir(join(root, "src", "app"), { recursive: true });
      await mkdir(join(root, ".dist", "npm-runtime", "preview"), { recursive: true });
      await mkdir(join(root, ".astro"), { recursive: true });
      await mkdir(join(root, ".superpowers", "brainstorm", "session"), { recursive: true });
      await mkdir(join(root, "docs", "audits", "artifacts", "visual-parity"), { recursive: true });
      await mkdir(join(root, "dist-runtime-resources", "examples"), { recursive: true });
      await mkdir(join(root, "generated", "components", "Card"), { recursive: true });
      await mkdir(join(root, "notes", "figma-library-builder", "scripts"), { recursive: true });
      await mkdir(join(root, "agent-kits", "codex", "memoire-design-tooling"), { recursive: true });
      await mkdir(join(root, "plugins", "memoire", "skills"), { recursive: true });
      await mkdir(join(root, "plugin", "main"), { recursive: true });
      await mkdir(join(root, "examples", "site-bundle", "codex-plugin"), { recursive: true });
      await mkdir(join(root, "apps", "studio", "src-tauri", "resources", "memoire-runtime", "examples", "site-bundle"), { recursive: true });
      await mkdir(join(root, "apps", "studio", "src-tauri", "target", "debug", "resources", "memoire-runtime", "examples"), { recursive: true });
      await writeFile(join(root, "package.json"), JSON.stringify({ dependencies: { next: "15.0.0", tailwindcss: "4.0.0" } }), "utf-8");
      await writeFile(join(root, "src", "app", "page.tsx"), `
export default function Page() {
  return <main className="p-4 text-base">Clean scoped app</main>;
}
`, "utf-8");
      await writeFile(join(root, ".dist", "npm-runtime", "preview", "index.html"), `<div style="color:#fedcba" class="text-[74px]">package staging</div>`, "utf-8");
      await writeFile(join(root, ".astro", "types.d.ts"), `declare const color = "#123456";`, "utf-8");
      await writeFile(join(root, ".superpowers", "brainstorm", "session", "scratch.html"), `<div style="color:#ff0000" class="text-[72px]">scratch</div>`, "utf-8");
      await writeFile(join(root, "docs", "audits", "artifacts", "visual-parity", "dashboard-preview.html"), `<main style="color:#1188ff" class="text-[80px]">audit artifact</main>`, "utf-8");
      await writeFile(join(root, "dist-runtime-resources", "examples", "index.html"), `<div style="color:#abcdef" class="text-[52px]">runtime cache</div>`, "utf-8");
      await writeFile(join(root, "generated", "components", "Card", "Card.tsx"), `export function Card(){ return <div className="text-[50px] text-[#fafafa]" /> }`, "utf-8");
      await writeFile(join(root, "notes", "figma-library-builder", "scripts", "createComponent.js"), `export const color = "#eeeeee";`, "utf-8");
      await writeFile(join(root, "agent-kits", "codex", "memoire-design-tooling", "SKILL.md"), `<div class="text-[48px] text-[#dddddd]">kit</div>`, "utf-8");
      await writeFile(join(root, "plugins", "memoire", "skills", "SKILL.md"), `<div class="text-[46px] text-[#cccccc]">plugin</div>`, "utf-8");
      await writeFile(join(root, "plugin", "main", "index.ts"), `export const color = "#bbbbbb";`, "utf-8");
      await writeFile(join(root, "examples", "site-bundle", "codex-plugin", "index.html"), `<div style="color:#00ff00" class="text-[64px]">bundle</div>`, "utf-8");
      await writeFile(join(root, "apps", "studio", "src-tauri", "resources", "memoire-runtime", "examples", "site-bundle", "index.html"), `<div style="color:#0000ff" class="text-[56px]">runtime bundle</div>`, "utf-8");
      await writeFile(join(root, "apps", "studio", "src-tauri", "target", "debug", "resources", "memoire-runtime", "examples", "index.html"), `<div style="color:#ff00ff" class="text-[54px]">target bundle</div>`, "utf-8");

      const diagnosis = await diagnoseAppQuality({ projectRoot: root, write: false });

      expect(diagnosis.files.map((file) => file.path)).toEqual(["src/app/page.tsx"]);
      expect(diagnosis.summary.hexColors).toBe(0);
      expect(diagnosis.issues.map((issue) => issue.id)).not.toContain("color.raw-hex");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("treats CSS custom-property declarations as the color token source, not raw-color leakage", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-app-quality-color-tokens-"));
    try {
      await mkdir(join(root, "src", "app"), { recursive: true });
      await mkdir(join(root, "src", "styles"), { recursive: true });
      await writeFile(join(root, "src", "app", "page.tsx"), `
export default function Page() {
  return <main className="p-4 text-base bg-background text-foreground">Tokenized UI</main>;
}
`, "utf-8");
      await writeFile(join(root, "src", "styles", "tokens.css"), `
:root {
  --background: #08090a;
  --surface: #161718;
  --foreground: #f7f8f8;
  --muted: #8a8f98;
  --border: #383b3f;
  --accent: #ff5470;
}
`, "utf-8");

      const diagnosis = await diagnoseAppQuality({ projectRoot: root, write: false });

      expect(diagnosis.summary.hexColors).toBe(0);
      expect(diagnosis.issues.map((issue) => issue.id)).not.toContain("color.raw-hex");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("scores rendered UI surfaces instead of prompt and test fixture strings", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-app-quality-ui-scope-"));
    try {
      await mkdir(join(root, "src", "app"), { recursive: true });
      await mkdir(join(root, "src", "styles"), { recursive: true });
      await mkdir(join(root, "src", "agents"), { recursive: true });
      await mkdir(join(root, "src", "app", "__tests__"), { recursive: true });
      await writeFile(join(root, "package.json"), JSON.stringify({ dependencies: { next: "15.0.0", tailwindcss: "4.0.0" } }), "utf-8");
      await writeFile(join(root, "src", "styles", "app.css"), `
:root {
  --background: white;
  --foreground: black;
  --surface: white;
  --muted: gray;
  --primary: blue;
  --primary-foreground: white;
  --border: gray;
  --ring: blue;
}
:focus-visible {
  outline: 2px solid var(--ring);
}
`, "utf-8");
      await writeFile(join(root, "src", "app", "page.tsx"), `
export default function Page() {
  return <main className="p-4 text-base"><button type="button">Save</button></main>;
}
`, "utf-8");
      await writeFile(join(root, "src", "agents", "prompts.ts"), `
export const prompt = '<img src="/demo.png" class="text-[96px] text-[#ff00ff]" /><button onClick={() => null}>Bad fixture</button>';
`, "utf-8");
      await writeFile(join(root, "src", "app", "__tests__", "page.test.tsx"), `
export const fixture = '<Image src="/test.png" className="p-[99px] bg-[#00ff00]" />';
`, "utf-8");

      const diagnosis = await diagnoseAppQuality({ projectRoot: root, write: false });
      const issueIds = diagnosis.issues.map((issue) => issue.id);

      expect(issueIds).not.toContain("a11y.image-alt");
      expect(issueIds).not.toContain("a11y.focus-missing");
      expect(issueIds).not.toContain("maintainability.arbitrary-tailwind");
      expect(diagnosis.summary.hexColors).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not let excluded fixtures consume the scan budget for an explicit directory target", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-app-quality-budget-"));
    try {
      await mkdir(join(root, "src", "__tests__"), { recursive: true });
      await mkdir(join(root, "src", "app"), { recursive: true });
      await writeFile(join(root, "src", "__tests__", "a.test.tsx"), "export const fixture = '<div className=\"text-[#ff00ff]\" />';");
      await writeFile(join(root, "src", "app", "page.tsx"), "export default function Page(){ return <main className=\"p-4 text-base\" />; }");

      const diagnosis = await diagnoseAppQuality({
        projectRoot: root,
        target: "src",
        maxFiles: 1,
        write: false,
      });

      expect(diagnosis.files.map((file) => file.path)).toEqual(["src/app/page.tsx"]);
      expect(diagnosis.summary.hexColors).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns a file-anchored SwiftUI motion finding without awarding unassessed web dimensions", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-app-quality-swiftui-"));
    try {
      await mkdir(join(root, "Sources", "Ripple"), { recursive: true });
      await writeFile(join(root, "Sources", "Ripple", "RippleView.swift"), `import SwiftUI

struct RippleView: View {
    let trigger: Int

    var body: some View {
        Text("Ripple")
            .keyframeAnimator(initialValue: 0.0, trigger: trigger) { view, value in
                view.opacity(value)
            } keyframes: { _ in
                LinearKeyframe(1.0, duration: 0.4)
            }
            .onSpatialTap { _ in }
    }
}
`, "utf-8");

      const diagnosis = await diagnoseAppQuality({ projectRoot: root, write: false });
      const finding = diagnosis.issues.find((issue) => issue.id === "swiftui.reduced-motion-missing");

      expect(diagnosis.summary.scannedFiles).toBe(1);
      expect(diagnosis.summary.components).toBe(1);
      expect(diagnosis.appGraph?.components).toBe(1);
      expect(diagnosis.summary.score).toBe(0);
      expect(diagnosis.summary.verdict).toBe("unassessed — SwiftUI coverage is partial");
      expect(diagnosis.assessedDimensions).toEqual([
        "swiftui.gesture-accessibility-action",
        "swiftui.reduced-motion",
      ]);
      expect(diagnosis.unassessedDimensions).toEqual([
        "accessibility",
        "color",
        "components",
        "maintainability",
        "responsive",
        "spacing",
        "swiftui:rendered-quality",
        "swiftui:runtime-accessibility",
        "swiftui:whole-category-analysis",
        "typography",
        "visual-system",
      ]);
      expect(diagnosis.sourceCoverage.swiftui).toMatchObject({
        scannedFiles: 1,
        analysis: "partial",
        assessedChecks: [
          "swiftui.gesture-accessibility-action",
          "swiftui.reduced-motion",
        ],
      });
      expect(finding?.affectedFiles).toEqual(["Sources/Ripple/RippleView.swift"]);
      expect(finding?.evidenceLocations).toEqual([
        expect.objectContaining({
          file: "Sources/Ripple/RippleView.swift",
          line: 8,
        }),
      ]);
      expect(diagnosis.issues.map((issue) => issue.id)).not.toContain("scan.empty");
      expect(diagnosis.ux.findings.map((finding) => finding.id)).toContain("ux.swiftui.reduced-motion-missing");
      expect(diagnosis.issues.find((issue) => issue.id === "swiftui.gesture-accessibility-action-missing")?.evidenceLocations).toEqual([
        expect.objectContaining({
          file: "Sources/Ripple/RippleView.swift",
          line: 13,
        }),
      ]);
      expect(diagnosis.ux.tenetCoverage.find((entry) => entry.tenetId === "consistency")?.status).toBe("not-assessed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("recognizes explicit reduced-motion and accessibility-action handling", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-app-quality-swiftui-covered-"));
    try {
      await mkdir(join(root, "Sources"), { recursive: true });
      await writeFile(join(root, "Sources", "CoveredView.swift"), `import SwiftUI

struct CoveredView: View {
    @Environment(\\.accessibilityReduceMotion) private var reduceMotion
    let trigger: Int

    var body: some View {
        Text("Ripple")
            .keyframeAnimator(initialValue: 0.0, trigger: reduceMotion ? 0 : trigger) { view, value in
                view.opacity(value)
            } keyframes: { _ in
                LinearKeyframe(1.0, duration: 0.4)
            }
            .onSpatialTap { _ in }
            .accessibilityAction { }
    }
}
`, "utf-8");

      const diagnosis = await diagnoseAppQuality({ projectRoot: root, write: false });

      expect(diagnosis.summary.scannedFiles).toBe(1);
      expect(diagnosis.issues.map((issue) => issue.id)).not.toContain("swiftui.reduced-motion-missing");
      expect(diagnosis.issues.map((issue) => issue.id)).not.toContain("swiftui.gesture-accessibility-action-missing");
      expect(diagnosis.sourceCoverage.swiftui.assessedChecks).toEqual([
        "swiftui.gesture-accessibility-action",
        "swiftui.reduced-motion",
      ]);
      expect(diagnosis.ux.appliedScoreCaps).toEqual([
        expect.objectContaining({
          id: "partial-static-analysis",
          maximum: 0,
        }),
      ]);
      expect(diagnosis.ux.evidenceProvenance).toContainEqual(
        expect.objectContaining({ kind: "static-scan", analyzed: true }),
      );
      expect(diagnosis.ux.appliedScoreCaps.map((cap) => cap.id)).not.toContain("no-analyzed-evidence");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("discovers Metal sources but leaves them explicitly unassessed", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-app-quality-metal-"));
    try {
      await mkdir(join(root, "Shaders"), { recursive: true });
      await writeFile(join(root, "Shaders", "Ripple.metal"), `#include <metal_stdlib>
using namespace metal;

[[ stitchable ]] half4 Ripple(float2 position, half4 color) {
    return color;
}
`, "utf-8");

      const diagnosis = await diagnoseAppQuality({ projectRoot: root, write: false });

      expect(diagnosis.summary.scannedFiles).toBe(1);
      expect(diagnosis.summary.score).toBe(0);
      expect(diagnosis.summary.verdict).toBe("unassessed — detected source has no supported analyzer");
      expect(diagnosis.sourceCoverage.metal).toEqual({
        scannedFiles: 1,
        analysis: "unassessed",
        assessedDimensions: [],
        assessedChecks: [],
      });
      expect(diagnosis.assessedDimensions).toEqual([]);
      expect(diagnosis.unassessedDimensions).toContain("metal:shader-semantics");
      expect(diagnosis.unassessedDimensions).toContain("metal:gpu-performance");
      expect(diagnosis.unassessedDimensions).toContain("metal:color-correctness");
      expect(diagnosis.issues).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps the web score explicitly scoped when SwiftUI coverage is partial", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-app-quality-mixed-"));
    try {
      await mkdir(join(root, "src", "app"), { recursive: true });
      await mkdir(join(root, "Sources"), { recursive: true });
      await writeFile(join(root, "src", "app", "page.tsx"), `
export default function Page() {
  return <main className="p-4 text-base"><button type="button">Save</button></main>;
}
`, "utf-8");
      await writeFile(join(root, "Sources", "MotionView.swift"), `import SwiftUI
struct MotionView: View {
    var body: some View {
        Text("Motion")
            .phaseAnimator([false, true]) { view, active in
                view.opacity(active ? 1 : 0)
            }
    }
}
`, "utf-8");

      const diagnosis = await diagnoseAppQuality({ projectRoot: root, write: false });

      expect(diagnosis.summary.scannedFiles).toBe(2);
      expect(diagnosis.summary.score).toBeLessThan(100);
      expect(diagnosis.summary.scoreScope).toBe("web");
      expect(diagnosis.summary.verdict).toBe("needs a design-system pass — web ruleset only; native coverage incomplete");
      expect(diagnosis.sourceCoverage.web.analysis).toBe("ruleset");
      expect(diagnosis.sourceCoverage.swiftui.analysis).toBe("partial");
      expect(diagnosis.assessedDimensions).toEqual([
        "accessibility",
        "maintainability",
        "spacing",
        "swiftui.gesture-accessibility-action",
        "swiftui.reduced-motion",
        "typography",
      ]);
      expect(diagnosis.unassessedDimensions).toEqual([
        "color",
        "components",
        "responsive",
        "swiftui:rendered-quality",
        "swiftui:runtime-accessibility",
        "swiftui:whole-category-analysis",
        "visual-system",
      ]);
      expect(diagnosis.issues.map((issue) => issue.id)).toContain("swiftui.reduced-motion-missing");
      expect(diagnosis.directions.map((direction) => direction.id)).toContain("premium-saas");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps web scoring comparable when a Package.swift manifest is present", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-app-quality-web-helper-swift-"));
    try {
      await mkdir(join(root, "src", "app"), { recursive: true });
      await writeFile(join(root, "src", "app", "page.tsx"), `
export default function Page() {
  return <main className="p-4 text-base"><button type="button">Save</button></main>;
}
`, "utf-8");
      await writeFile(join(root, "Package.swift"), `// swift-tools-version: 6.0
import PackageDescription
let package = Package(
    name: "WebCompanion",
    products: [],
    targets: []
)
`, "utf-8");

      const diagnosis = await diagnoseAppQuality({ projectRoot: root, write: false });

      expect(diagnosis.summary.score).toBeLessThan(100);
      expect(diagnosis.summary.scoreScope).toBe("web");
      expect(diagnosis.summary.verdict).toBe("needs a design-system pass — web ruleset only; native coverage incomplete");
      expect(diagnosis.sourceCoverage.swift.scannedFiles).toBe(1);
      expect(diagnosis.sourceCoverage.swiftui.scannedFiles).toBe(0);
      expect(diagnosis.assessedDimensions).toEqual([
        "accessibility",
        "maintainability",
        "spacing",
        "typography",
      ]);
      expect(diagnosis.unassessedDimensions).toEqual([
        "color",
        "components",
        "responsive",
        "swift:source-analysis",
        "visual-system",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("excludes Swift test and generated fixture sources from native coverage", async () => {
    const root = await mkdtemp(join(tmpdir(), "memoire-app-quality-swift-exclusions-"));
    try {
      await mkdir(join(root, "Tests"), { recursive: true });
      await mkdir(join(root, "Fixtures"), { recursive: true });
      await mkdir(join(root, "Generated"), { recursive: true });
      const fixture = `import SwiftUI
struct FixtureView: View {
    var body: some View {
        Text("fixture").keyframeAnimator(initialValue: 0.0, trigger: 1) { view, _ in view }
    }
}
`;
      await writeFile(join(root, "Tests", "RippleTests.swift"), fixture, "utf-8");
      await writeFile(join(root, "Fixtures", "Preview.swift"), fixture, "utf-8");
      await writeFile(join(root, "Generated", "GeneratedView.swift"), fixture, "utf-8");

      const diagnosis = await diagnoseAppQuality({ projectRoot: root, write: false });

      expect(diagnosis.summary.scannedFiles).toBe(0);
      expect(diagnosis.sourceCoverage.swiftui.analysis).toBe("not-detected");
      expect(diagnosis.issues).toEqual([]);
      expect(diagnosis.summary.verdict).toBe("unassessed — no supported source files detected");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
