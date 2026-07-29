import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildAgentAuditContext,
  buildRepositoryAgentAuditContext,
  deriveAgentContextRouting,
} from "../agent-context.js";
import type { AppQualityDiagnosis } from "../engine.js";

describe("agent audit context", () => {
  it("keeps high-signal files and source-linked issues in a bounded immutable payload", () => {
    const diagnosis = {
      target: ".",
      generatedAt: "2026-07-29T00:00:00.000Z",
      summary: {
        score: 64,
        verdict: "visibly inconsistent",
        scannedFiles: 3,
        routes: 1,
        components: 1,
        styleFiles: 1,
        tailwindClasses: 20,
        shadcnImports: 0,
        cssVariables: 12,
        hexColors: 2,
      },
      appGraph: {
        routes: 1,
        components: 1,
        imports: 4,
        shadcnComponents: [],
        package: {
          name: "fixture",
          version: "1.0.0",
          dependencies: [],
          devDependencies: [],
          hasShadcn: false,
          hasTailwind: true,
        },
      },
      files: [
        {
          path: "src/quiet.ts",
          kind: "config",
          classCount: 0,
          shadcnImports: [],
          hexColors: [],
          cssVariables: [],
        },
        {
          path: "src/theme.css",
          kind: "style",
          classCount: 2,
          shadcnImports: [],
          hexColors: ["#fff"],
          cssVariables: ["--surface", "--ink"],
        },
        {
          path: "src/Button.tsx",
          kind: "component",
          classCount: 18,
          shadcnImports: [],
          hexColors: [],
          cssVariables: [],
        },
      ],
      issues: [
        {
          id: "color.raw-hex",
          normalizedId: "color.raw-hex",
          category: "color",
          severity: "high",
          title: "Raw colors are leaking into UI code",
          detail: "Hardcoded values bypass the system.",
          evidence: ["1 unique hex color"],
          recommendation: "Use a token.",
          affectedFiles: ["src/theme.css"],
          evidenceLocations: [{
            file: "src/theme.css",
            line: 4,
            excerpt: "color: #fff",
          }],
          confidence: 0.9,
          estimatedEffort: "small",
          fixCategory: "tokens",
        },
      ],
      sourceCoverage: {
        web: {
          scannedFiles: 3,
          analysis: "ruleset",
          assessedDimensions: ["color", "components"],
          assessedChecks: ["tokens", "component-graph"],
        },
        swiftui: {
          scannedFiles: 0,
          analysis: "not-detected",
          assessedDimensions: [],
          assessedChecks: [],
        },
        swift: {
          scannedFiles: 0,
          analysis: "not-detected",
          assessedDimensions: [],
          assessedChecks: [],
        },
        metal: {
          scannedFiles: 0,
          analysis: "not-detected",
          assessedDimensions: [],
          assessedChecks: [],
        },
      },
      confidence: 0.7,
      assessedDimensions: ["color", "components"],
      unassessedDimensions: ["rendered-quality"],
      evidenceProvenance: [{ kind: "static-scan", analyzed: true, target: "." }],
    } as unknown as AppQualityDiagnosis;

    const context = buildAgentAuditContext(diagnosis, {
      maxFiles: 2,
      maxIssues: 1,
    });

    expect(context).toMatchObject({
      schemaVersion: 1,
      target: ".",
      summary: { score: 64, scannedFiles: 3 },
      limits: {
        maxFiles: 2,
        maxIssues: 1,
        totalFiles: 3,
        totalIssues: 1,
        filesTruncated: true,
        issuesTruncated: false,
      },
      unassessedDimensions: ["rendered-quality"],
    });
    expect(context.files.map((file) => file.path)).toEqual([
      "src/Button.tsx",
      "src/theme.css",
    ]);
    expect(context.issues[0]).toMatchObject({
      id: "color.raw-hex",
      affectedFiles: ["src/theme.css"],
      evidenceLocations: [{ file: "src/theme.css", line: 4 }],
    });
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.files)).toBe(true);
  });

  it("rejects non-positive context bounds", () => {
    const diagnosis = { target: "." } as AppQualityDiagnosis;
    expect(() => buildAgentAuditContext(diagnosis, { maxFiles: 0 })).toThrow(
      "maxFiles must be positive",
    );
    expect(() => buildAgentAuditContext(diagnosis, { maxIssues: -1 })).toThrow(
      "maxIssues must be positive",
    );
  });

  it("adds bounded line-numbered design excerpts for direct agent evidence", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "memi-agent-context-"));
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "theme.css"), [
      ":root {",
      "  --color-surface: #fff;",
      "  --radius-card: 12px;",
      "}",
    ].join("\n"));
    await writeFile(path.join(root, "src", "Button.tsx"), [
      "export function Button() {",
      "  return <button className=\"rounded-card bg-surface\" />;",
      "}",
    ].join("\n"));
    const diagnosis = {
      target: ".",
      generatedAt: "2026-07-29T00:00:00.000Z",
      summary: { score: 90, scannedFiles: 2 },
      files: [
        {
          path: "src/theme.css",
          kind: "style",
          classCount: 0,
          shadcnImports: [],
          hexColors: ["#fff"],
          cssVariables: ["--color-surface", "--radius-card"],
        },
        {
          path: "src/Button.tsx",
          kind: "component",
          classCount: 2,
          shadcnImports: [],
          hexColors: [],
          cssVariables: [],
        },
      ],
      issues: [],
      sourceCoverage: {},
      confidence: 0.9,
      assessedDimensions: ["color", "components"],
      unassessedDimensions: [],
      evidenceProvenance: [],
    } as unknown as AppQualityDiagnosis;

    const context = await buildRepositoryAgentAuditContext(root, diagnosis, {
      maxFiles: 2,
      maxIssues: 1,
      maxExcerptFiles: 2,
      maxExcerptsPerFile: 2,
      routingMode: "full",
    });

    expect(context.sourceExcerpts).toEqual([
      {
        path: "src/theme.css",
        excerpts: [
          { line: 2, text: "--color-surface: #fff;" },
          { line: 3, text: "--radius-card: 12px;" },
        ],
      },
      {
        path: "src/Button.tsx",
        excerpts: [
          { line: 1, text: "export function Button() {" },
          {
            line: 2,
            text: "return <button className=\"rounded-card bg-surface\" />;",
          },
        ],
      },
    ]);
    expect(Object.isFrozen(context.sourceExcerpts)).toBe(true);
  });

  it("prioritizes concrete Swift design-token values over nearby type declarations", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "memi-swift-context-"));
    await mkdir(path.join(root, "App"), { recursive: true });
    await writeFile(path.join(root, "App", "Theme.swift"), [
      "enum FirstPresentation {}",
      "enum SecondPresentation {}",
      "enum ThirdPresentation {}",
      "enum FourthPresentation {}",
      "enum FifthPresentation {}",
      "enum SixthPresentation {}",
      "enum LightWoodPalette {",
      "  static let ink = Color(red: 0.11, green: 0.09, blue: 0.08)",
      "  static let accent = Color(red: 0.82, green: 0.32, blue: 0.18)",
      "}",
    ].join("\n"));
    const diagnosis = {
      target: ".",
      generatedAt: "2026-07-29T00:00:00.000Z",
      summary: { score: 0, scannedFiles: 1 },
      files: [{
        path: "App/Theme.swift",
        kind: "component",
        classCount: 0,
        shadcnImports: [],
        hexColors: [],
        cssVariables: [],
      }],
      issues: [],
      sourceCoverage: {},
      confidence: 0.5,
      assessedDimensions: [],
      unassessedDimensions: ["swiftui:rendered-quality"],
      evidenceProvenance: [],
    } as unknown as AppQualityDiagnosis;

    const context = await buildRepositoryAgentAuditContext(root, diagnosis, {
      maxFiles: 1,
      maxIssues: 1,
      maxExcerptFiles: 1,
      maxExcerptsPerFile: 3,
      routingMode: "full",
    });

    expect(context.sourceExcerpts[0]?.excerpts).toEqual([
      {
        line: 7,
        text: "enum LightWoodPalette {",
      },
      {
        line: 8,
        text: "static let ink = Color(red: 0.11, green: 0.09, blue: 0.08)",
      },
      {
        line: 9,
        text: "static let accent = Color(red: 0.82, green: 0.32, blue: 0.18)",
      },
    ]);
  });

  it("routes full context only to high-ambiguity supported repositories", () => {
    const hybrid = {
      summary: {
        score: 86,
        scoreScope: "web",
        scannedFiles: 386,
        routes: 12,
        components: 110,
        styleFiles: 2,
      },
      appGraph: {
        package: { dependencies: ["next"], devDependencies: [] },
      },
      sourceCoverage: {
        web: { scannedFiles: 371 },
        swiftui: { scannedFiles: 3 },
      },
    } as unknown as AppQualityDiagnosis;
    const reactNative = {
      ...hybrid,
      summary: {
        ...hybrid.summary,
        scannedFiles: 500,
        routes: 0,
        components: 317,
        styleFiles: 0,
      },
      appGraph: {
        package: {
          dependencies: ["expo", "react-native"],
          devDependencies: [],
        },
      },
      sourceCoverage: {
        web: { scannedFiles: 498 },
        swiftui: { scannedFiles: 0 },
      },
    } as unknown as AppQualityDiagnosis;
    const focusedWeb = {
      ...hybrid,
      summary: {
        ...hybrid.summary,
        score: 93,
        scannedFiles: 62,
        routes: 21,
        components: 25,
        styleFiles: 4,
      },
      sourceCoverage: {
        web: { scannedFiles: 62 },
        swiftui: { scannedFiles: 0 },
      },
    } as unknown as AppQualityDiagnosis;

    expect(deriveAgentContextRouting(hybrid)).toMatchObject({
      mode: "full",
      reason: "supported-multi-surface-repository",
    });
    expect(deriveAgentContextRouting(reactNative)).toMatchObject({
      mode: "abstain",
      reason: "react-native-analyzer-incomplete",
    });
    expect(deriveAgentContextRouting(focusedWeb)).toMatchObject({
      mode: "abstain",
      reason: "low-discovery-complexity",
    });
  });
});
