#!/usr/bin/env node

import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveReleaseChannel } from "./lib/npm-release-verification.mjs";

try {
  const args = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(
    await readFile(join(process.cwd(), "release-manifest.json"), "utf8"),
  );
  const inputVersion = args.version ?? stripTagPrefix(args.tag);
  const channel = resolveReleaseChannel({
    version: inputVersion,
    previousPublicRelease:
      manifest?.releaseGroups?.engine?.previousPublicRelease?.version,
  });

  if (args.tag !== undefined && args.tag !== `v${channel.version}`) {
    throw new Error(`unsupported release tag: ${args.tag}`);
  }

  const outputs = {
    release_version: channel.version,
    npm_dist_tag: channel.distTag,
    expected_latest: channel.expectedLatest,
    is_prerelease: channel.isPrerelease,
    github_prerelease: channel.githubPrerelease,
    github_make_latest: channel.githubMakeLatest,
    promote_stable_channels: channel.promoteStableChannels,
  };

  if (args.githubOutput) {
    const lines = Object.entries(outputs)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join("\n");
    await appendFile(args.githubOutput, `${lines}\n`, "utf8");
  }

  console.log(JSON.stringify(outputs));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

function parseArgs(rawArgs) {
  const parsed = {};
  for (let index = 0; index < rawArgs.length; index += 1) {
    const flag = rawArgs[index];
    if (!["--version", "--tag", "--github-output"].includes(flag)) {
      throw new Error(`unsupported argument: ${flag}`);
    }
    const value = rawArgs[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${flag} requires a value`);
    }
    const key = flag === "--github-output"
      ? "githubOutput"
      : flag.slice(2);
    if (parsed[key] !== undefined) {
      throw new Error(`${flag} may only be provided once`);
    }
    parsed[key] = value;
    index += 1;
  }
  if ((parsed.version === undefined) === (parsed.tag === undefined)) {
    throw new Error("provide exactly one of --version or --tag");
  }
  return parsed;
}

function stripTagPrefix(tag) {
  if (typeof tag !== "string" || !tag.startsWith("v")) {
    throw new Error(`unsupported release tag: ${tag}`);
  }
  return tag.slice(1);
}
