import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildRepositoryFingerprint } from "../repository-fingerprint.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe("repository fingerprint", () => {
  it("detects Expo Router dependencies, route files, scripts, languages, and imports", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "memi-fingerprint-"));
    tempDirs.push(root);
    await mkdir(path.join(root, "app", "(tabs)"), { recursive: true });
    await writeFile(path.join(root, "package.json"), JSON.stringify({
      scripts: { ios: "expo start --ios", test: "vitest run" },
      dependencies: {
        expo: "54.0.0",
        "expo-router": "6.0.0",
        "react-native": "0.81.0",
      },
    }));
    await writeFile(
      path.join(root, "app", "(tabs)", "_layout.tsx"),
      "import { Tabs } from 'expo-router';\nexport default function Layout() { return <Tabs />; }\n",
    );

    const fingerprint = await buildRepositoryFingerprint(root);

    expect(fingerprint.frameworks).toEqual(expect.arrayContaining([
      "expo",
      "expo-router",
      "react-native",
    ]));
    expect(fingerprint.dependencies).toContain("expo-router");
    expect(fingerprint.files).toContain("app/(tabs)/_layout.tsx");
    expect(fingerprint.imports).toContain("expo-router");
    expect(fingerprint.languages).toContain("typescript");
    expect(fingerprint.scripts).toEqual(["ios", "test"]);
  });

  it("ignores dependency, build, and VCS directories", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "memi-fingerprint-ignore-"));
    tempDirs.push(root);
    await mkdir(path.join(root, "node_modules", "noise"), { recursive: true });
    await mkdir(path.join(root, ".git", "objects"), { recursive: true });
    await writeFile(path.join(root, "node_modules", "noise", "index.ts"), "import 'noise';");
    await writeFile(path.join(root, ".git", "objects", "fake.swift"), "import SwiftUI");
    await writeFile(path.join(root, "App.swift"), "import SwiftUI\n");

    const fingerprint = await buildRepositoryFingerprint(root);

    expect(fingerprint.files).toEqual(["App.swift"]);
    expect(fingerprint.imports).toEqual(["SwiftUI"]);
    expect(fingerprint.languages).toEqual(["swift"]);
  });
});
