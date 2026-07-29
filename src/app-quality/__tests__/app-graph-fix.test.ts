import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { buildAppGraph } from "../app-graph.js";
import { diagnoseAppQuality } from "../engine.js";
import { addMissingAltPlaceholders, applyUiFixPlan, buildUiFixPlan } from "../fix-plan.js";

describe("app graph and fix planning", () => {
  it("builds a component, route, import, shadcn, token, and package graph", async () => {
    const projectRoot = await makeFixtureProject();
    try {
      const graph = await buildAppGraph({ projectRoot });

      expect(graph.summary.routes).toBeGreaterThanOrEqual(1);
      expect(graph.summary.components).toBeGreaterThanOrEqual(1);
      expect(graph.summary.imports).toBeGreaterThanOrEqual(1);
      expect(graph.package.hasTailwind).toBe(true);
      expect(graph.shadcn.imports).toContain("@/components/ui/button");
      expect(graph.tokens.cssVariables).toContain("--background");
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("classifies generic src/app React modules as components instead of routes", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "memoire-react-app-"));
    await mkdir(join(projectRoot, "src", "app"), { recursive: true });
    await writeFile(join(projectRoot, "package.json"), JSON.stringify({
      name: "react-fixture",
      dependencies: { react: "^19.0.0" },
    }));
    await writeFile(join(projectRoot, "src", "app", "Chrome.tsx"), `
      export function Chrome() {
        return <aside className="bg-surface">Navigation</aside>
      }
    `);
    await writeFile(join(projectRoot, "src", "app", "Dashboard.tsx"), `
      export function Dashboard() {
        return <main className="grid gap-4">Dashboard</main>
      }
    `);

    try {
      const graph = await buildAppGraph({ projectRoot });
      const diagnosis = await diagnoseAppQuality({
        projectRoot,
        write: false,
      });

      expect(graph.summary.routes).toBe(0);
      expect(graph.summary.components).toBe(2);
      expect(graph.components.map((component) => component.name)).toEqual([
        "Chrome",
        "Dashboard",
      ]);
      expect(diagnosis.summary.routes).toBe(0);
      expect(diagnosis.summary.components).toBe(2);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("adds evidence fields to diagnosis issues", async () => {
    const projectRoot = await makeFixtureProject();
    try {
      const diagnosis = await diagnoseAppQuality({ projectRoot, write: false });
      const altIssue = diagnosis.issues.find((issue) => issue.id === "a11y.image-alt");

      expect(altIssue).toBeDefined();
      expect(altIssue?.affectedFiles?.[0]).toContain("app/page.tsx");
      expect(altIssue?.evidenceLocations?.[0]?.line).toBeGreaterThan(0);
      expect(altIssue?.confidence).toBeGreaterThan(0.7);
      expect(altIssue?.fixCategory).toBe("accessibility");
      expect(diagnosis.appGraph?.routes).toBeGreaterThanOrEqual(1);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("generates no-write fix plans", async () => {
    const projectRoot = await makeFixtureProject();
    try {
      const plan = await buildUiFixPlan({ projectRoot, write: false });
      expect(plan.ux.score).toBeLessThan(100);
      expect(plan.ux.recommendedTweaks.length).toBeGreaterThan(0);
      expect(plan.patches.some((patch) => patch.id === "a11y.add-image-alt-hints")).toBe(true);
      await expect(access(join(projectRoot, ".memoire", "app-quality", "fix-plan.json"))).rejects.toThrow();
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("blocks apply without --yes and applies safe patches with --yes", async () => {
    const projectRoot = await makeFixtureProject();
    try {
      const imagePath = join(projectRoot, "app", "page.tsx");
      const blocked = await applyUiFixPlan({ projectRoot, yes: false });
      expect(blocked.status).toBe("blocked");
      expect(await readFile(imagePath, "utf8")).not.toContain('alt=""');

      const applied = await applyUiFixPlan({ projectRoot, yes: true });
      expect(applied.status).toBe("applied");
      expect(applied.appliedPatches).toContain("a11y.add-image-alt-hints");
      expect(await readFile(imagePath, "utf8")).toContain('alt=""');
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("adds alt placeholders without changing existing alt text", () => {
    const result = addMissingAltPlaceholders('<img src="/a.png" /><Image src="/b.png" alt="B" />');
    expect(result).toContain('<img src="/a.png" alt="" />');
    expect(result).toContain('<Image src="/b.png" alt="B" />');
  });
});

async function makeFixtureProject(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), "memoire-app-graph-"));
  await mkdir(join(projectRoot, "app"), { recursive: true });
  await mkdir(join(projectRoot, "components", "ui"), { recursive: true });
  await writeFile(join(projectRoot, "package.json"), JSON.stringify({
    name: "fixture",
    dependencies: {
      tailwindcss: "^4.0.0",
      shadcn: "^2.0.0",
    },
  }));
  await writeFile(join(projectRoot, "app", "globals.css"), `
    :root {
      --background: #ffffff;
      --foreground: #111827;
    }
  `);
  await writeFile(join(projectRoot, "components", "ui", "button.tsx"), `
    export function Button() {
      return <button className="bg-[#2563eb] px-[17px] py-2 rounded-lg">Save</button>
    }
  `);
  await writeFile(join(projectRoot, "app", "page.tsx"), `
    import { Button } from "@/components/ui/button"

    export default function Page() {
      return (
        <main className="p-[17px] text-lg">
          <img src="/hero.png" />
          <Button />
        </main>
      )
    }
  `);
  return projectRoot;
}
