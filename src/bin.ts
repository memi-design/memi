#!/usr/bin/env node

declare const __MEMI_PACKAGE_VERSION__: string;

export {};

const args = process.argv.slice(2);
const isVersionRequest = args.length === 1 && (
  args[0] === "--version"
  || args[0] === "-V"
  || args[0] === "version"
);

if (isVersionRequest) {
  process.stdout.write(`${__MEMI_PACKAGE_VERSION__}\n`);
} else {
  await import("./index.js");
}
