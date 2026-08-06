import { describe, expect, it } from "vitest";
import {
  RepositoryDesignIndexV1Schema,
  createRepositoryDesignIndex,
  isExcludedRepositoryPath,
} from "../repository-design-index.js";

const REVISION_A = "a".repeat(40);
const REVISION_B = "b".repeat(40);

function validIndexInput() {
  return {
    repositoryRevision: REVISION_A,
    lockfile: {
      path: "package-lock.json",
      content: "{\"lockfileVersion\":3}",
    },
    relevantSources: [
      { path: "src/z.tsx", content: "export const Z = 1;" },
      { path: "src/a.tsx", content: "export const A = 1;" },
      { path: "src/a.tsx", content: "export const A = 1;" },
      { path: ".env", content: "TOKEN=secret" },
      { path: "node_modules/pkg/index.js", content: "noise" },
      { path: "dist/generated.js", content: "noise" },
      { path: "vendor/pkg/file.ts", content: "noise" },
      { path: "fixtures/archive.tgz", content: "noise" },
    ],
    components: [
      {
        id: "SettingsPanel",
        atomicLevel: "organism" as const,
        sourcePath: "src/z.tsx",
        dependencies: ["Button", "Field", "Button"],
      },
      {
        id: "Button",
        atomicLevel: "atom" as const,
        sourcePath: "src/a.tsx",
        dependencies: [],
      },
    ],
    designTokens: [
      { name: "color.accent", value: "var(--accent)", sourcePath: "src/a.tsx" },
      { name: "space.4", value: "1rem" },
    ],
    frameworkConventions: ["tailwind", "react", "react"],
    directDependencies: [
      { name: "react", version: "19.0.0" },
      { name: "zod", version: "3.25.0" },
    ],
    testCommands: [
      { name: "typecheck", command: "npm run typecheck" },
      { name: "unit", command: "npm test" },
    ],
  };
}

describe("RepositoryDesignIndexV1", () => {
  it("derives identity from revision, lockfile content, and included source content", () => {
    const original = createRepositoryDesignIndex(validIndexInput());
    const same = createRepositoryDesignIndex({
      ...validIndexInput(),
      relevantSources: [...validIndexInput().relevantSources].reverse(),
    });
    const changedRevision = createRepositoryDesignIndex({
      ...validIndexInput(),
      repositoryRevision: REVISION_B,
    });
    const changedLockfile = createRepositoryDesignIndex({
      ...validIndexInput(),
      lockfile: { path: "package-lock.json", content: "{\"lockfileVersion\":4}" },
    });
    const changedSource = createRepositoryDesignIndex({
      ...validIndexInput(),
      relevantSources: validIndexInput().relevantSources.map((source) =>
        source.path === "src/a.tsx"
          ? { ...source, content: "export const A = 2;" }
          : source),
    });

    expect(original.identitySha256).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(same.identitySha256).toBe(original.identitySha256);
    expect(changedRevision.identitySha256).not.toBe(original.identitySha256);
    expect(changedLockfile.identitySha256).not.toBe(original.identitySha256);
    expect(changedSource.identitySha256).not.toBe(original.identitySha256);
  });

  it("excludes secrets, generated output, dependencies, vendors, and archives", () => {
    const index = createRepositoryDesignIndex(validIndexInput());

    expect(index.relevantSources.map((source) => source.path)).toEqual([
      "src/a.tsx",
      "src/z.tsx",
    ]);
    expect(index.relevantSources.every((source) => !("content" in source))).toBe(true);
    expect(isExcludedRepositoryPath(".env.local")).toBe(true);
    expect(isExcludedRepositoryPath("coverage/report.json")).toBe(true);
    expect(isExcludedRepositoryPath("Pods/Framework/file.swift")).toBe(true);
    expect(isExcludedRepositoryPath("assets/export.zip")).toBe(true);
    expect(isExcludedRepositoryPath("certs/release.pem")).toBe(true);
    expect(isExcludedRepositoryPath("config/.npmrc")).toBe(true);
    expect(isExcludedRepositoryPath("/absolute/App.tsx")).toBe(true);
    expect(isExcludedRepositoryPath("src/App.tsx")).toBe(false);
  });

  it("sorts and deduplicates metadata without mutating the input", () => {
    const input = validIndexInput();
    const before = structuredClone(input);
    const index = createRepositoryDesignIndex(input);

    expect(input).toEqual(before);
    expect(index.frameworkConventions).toEqual(["react", "tailwind"]);
    expect(index.components.map((component) => component.id)).toEqual([
      "Button",
      "SettingsPanel",
    ]);
    expect(index.components[1]?.dependencies).toEqual(["Button", "Field"]);
    expect(Object.isFrozen(index)).toBe(true);
    expect(Object.isFrozen(index.components[1]?.dependencies)).toBe(true);
  });

  it("rejects conflicting duplicate source paths and unknown fields", () => {
    expect(() => createRepositoryDesignIndex({
      ...validIndexInput(),
      relevantSources: [
        { path: "src/a.tsx", content: "one" },
        { path: "src/a.tsx", content: "two" },
      ],
    })).toThrow(/conflicting content/i);

    const index = createRepositoryDesignIndex(validIndexInput());
    expect(() => RepositoryDesignIndexV1Schema.parse({ ...index, surprise: true })).toThrow();

    expect(() => createRepositoryDesignIndex({
      ...validIndexInput(),
      components: [{
        id: "Unsafe",
        atomicLevel: "atom",
        sourcePath: "generated/Unsafe.tsx",
        dependencies: [],
      }],
    })).toThrow(/excluded/i);

    expect(() => createRepositoryDesignIndex({
      ...validIndexInput(),
      components: [
        {
          id: "Button",
          atomicLevel: "atom",
          sourcePath: "src/a.tsx",
          dependencies: [],
        },
        {
          id: "Button",
          atomicLevel: "atom",
          sourcePath: "src/z.tsx",
          dependencies: [],
        },
      ],
    })).toThrow(/conflicting values/i);
  });

  it("rejects externally supplied non-canonical ordering and identity tampering", () => {
    const index = createRepositoryDesignIndex(validIndexInput());
    expect(() => RepositoryDesignIndexV1Schema.parse({
      ...index,
      frameworkConventions: [...index.frameworkConventions].reverse(),
    })).toThrow(/sorted and unique/i);
    expect(() => RepositoryDesignIndexV1Schema.parse({
      ...index,
      identitySha256: `sha256:${"0".repeat(64)}`,
    })).toThrow(/identitySha256/i);
  });
});
