#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const v15TaskRoot = join(root, "..", "v15-2.7.3-confirmatory", "tasks");
const outputRoot = join(root, "tasks");
const checkOnly = process.argv.includes("--check");

const iosCollector = String.raw`import { execFile } from "node:child_process";
import { copyFile, lstat, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const options = new Map(process.argv.slice(2).reduce((pairs, value, index, values) => {
  if (value.startsWith("--")) pairs.push([value.slice(2), values[index + 1]]);
  return pairs;
}, []));
const kind = options.get("kind");
const flow = options.get("flow");
const output = options.get("output");
const udid = process.env.MEMI_V16_IOS_UDID;
const maestro = process.env.MEMI_V16_MAESTRO_BIN || "maestro";

if (!kind || !flow || !output) throw new Error("kind, flow, and output are required");
if (!udid || !/^[A-F0-9-]{36}$/i.test(udid)) {
  throw new Error("MEMI_V16_IOS_UDID must name the reset, exclusive iOS Simulator");
}
if (!new Set(["screenshot", "interaction-trace", "accessibility-tree"]).has(kind)) {
  throw new Error("unsupported native capture kind: " + kind);
}
const existing = await lstat(output).catch(() => null);
if (existing) throw new Error("refusing to overwrite native capture: " + output);
await mkdir(dirname(output), { recursive: true });

const trace = output.replace(/[^/]+$/, "memi-v16-maestro-junit.xml");
async function runJourney() {
  await exec(maestro, ["--udid", udid, "test", flow, "--format", "junit", "--output", trace], {
    timeout: 300000,
    maxBuffer: 4_000_000,
  });
  const result = await lstat(trace).catch(() => null);
  if (!result?.isFile() || result.size === 0) throw new Error("Maestro did not emit a journey trace");
}

await runJourney();
if (kind === "screenshot") {
  await exec("xcrun", ["simctl", "io", udid, "screenshot", output], { timeout: 60000 });
} else if (kind === "interaction-trace") {
  const source = await lstat(trace).catch(() => null);
  if (!source?.isFile()) throw new Error("Maestro did not emit its JUnit journey trace");
  await copyFile(trace, output);
} else {
  const hierarchy = await exec(maestro, ["--udid", udid, "hierarchy"], {
    timeout: 60000,
    maxBuffer: 8_000_000,
  });
  if (!hierarchy.stdout.trim()) throw new Error("Maestro returned an empty accessibility hierarchy");
  await writeFile(output, JSON.stringify({
    schemaVersion: 1,
    collector: "maestro-hierarchy",
    udid,
    capturedAt: new Date().toISOString(),
    hierarchy: hierarchy.stdout,
  }, null, 2) + "\n", { mode: 0o600 });
}
`;

const iosExclusiveReset = String.raw`import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const udid = process.env.MEMI_V16_IOS_UDID;
if (!udid || !/^[A-F0-9-]{36}$/i.test(udid)) {
  throw new Error("MEMI_V16_IOS_UDID must name the dedicated V16 Simulator");
}

async function bootedDevices() {
  const { stdout } = await exec("xcrun", ["simctl", "list", "devices", "--json"], {
    timeout: 60000,
    maxBuffer: 4_000_000,
  });
  const payload = JSON.parse(stdout);
  return Object.values(payload.devices).flat().filter((device) => device.state === "Booted");
}

const before = await bootedDevices();
const other = before.filter((device) => device.udid !== udid);
if (other.length > 0) {
  throw new Error("exclusive-simulator-required: other booted device(s): " + other.map((device) => device.name + " " + device.udid).join(", "));
}
await exec("xcrun", ["simctl", "shutdown", udid], { timeout: 60000 }).catch(() => undefined);
await exec("xcrun", ["simctl", "erase", udid], { timeout: 180000 });
await exec("xcrun", ["simctl", "boot", udid], { timeout: 120000 });
await exec("xcrun", ["simctl", "bootstatus", udid, "-b"], { timeout: 300000 });
const after = await bootedDevices();
if (after.length !== 1 || after[0].udid !== udid) {
  throw new Error("exclusive-simulator-required: dedicated device was not the only booted device after reset");
}
`;

const hostProcessProbe = String.raw`import { spawn } from "node:child_process";

const probeCode = "process.stdout.write('memi-host-process-probe-ok\\n')";
const command = process.platform === "win32" ? process.execPath : "/usr/bin/env";
const args = process.platform === "win32"
  ? ["-e", probeCode]
  : ["node", "-e", probeCode];
const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
let stdout = "";
let stderr = "";
let settled = false;
await new Promise((resolve, reject) => {
  const fail = (reason) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    child.kill("SIGTERM");
    reject(new Error("host-process-launch-unavailable: " + reason));
  };
  const timeout = setTimeout(() => fail("probe timed out after 10000ms"), 10000);
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", (error) => fail(error.message));
  child.on("close", (code, signal) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    if (code !== 0 || stdout.trim() !== "memi-host-process-probe-ok") {
      reject(new Error("host-process-launch-unavailable: " + (stderr.trim() || signal || "exit " + code)));
      return;
    }
    resolve();
  });
});
`;

const webCollector = String.raw`import { spawn } from "node:child_process";
import { lstat, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { chromium } from "@playwright/test";

const options = new Map(process.argv.slice(2).reduce((pairs, value, index, values) => {
  if (value.startsWith("--")) pairs.push([value.slice(2), values[index + 1]]);
  return pairs;
}, []));
const kind = options.get("kind");
const output = options.get("output");
if (!kind || !output) throw new Error("kind and output are required");
if (!new Set(["screenshot", "interaction-trace", "accessibility-tree"]).has(kind)) {
  throw new Error("unsupported native capture kind: " + kind);
}
if (await lstat(output).catch(() => null)) throw new Error("refusing to overwrite native capture: " + output);
await mkdir(dirname(output), { recursive: true });

const server = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", "43173"], {
  stdio: "ignore",
});
const stop = () => { if (!server.killed) server.kill("SIGTERM"); };
try {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:43173");
      if (response.ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (attempt === 119) throw new Error("Paraform dev server did not become ready");
  }
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
  await page.goto("http://127.0.0.1:43173", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Recruiter" }).click();
  const trigger = page.getByTestId("command-menu-trigger");
  await trigger.waitFor();
  await page.keyboard.press("ControlOrMeta+K");
  const dialog = page.getByRole("dialog", { name: "Navigate Paraform" });
  await dialog.waitFor();
  const search = dialog.getByRole("combobox", { name: "Search destinations" });
  await search.fill("Candidates");
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "Candidates" }).waitFor();
  await trigger.click();
  await dialog.waitFor();
  if (kind === "screenshot") {
    await page.screenshot({ path: output, fullPage: true });
  } else if (kind === "interaction-trace") {
    await context.tracing.stop({ path: output });
  } else {
    const session = await context.newCDPSession(page);
    const tree = await session.send("Accessibility.getFullAXTree");
    await writeFile(output, JSON.stringify({
      schemaVersion: 1,
      collector: "chromium-cdp-accessibility",
      capturedAt: new Date().toISOString(),
      tree,
    }, null, 2) + "\n", { mode: 0o600 });
    await context.tracing.stop();
  }
  await browser.close();
} finally {
  stop();
}
`;

const iosFlows = {
  "buzzr-tab-unread-badge": String.raw`appId: com.buzzr.app
---
- launchApp:
    clearState: true
- tapOn:
    id: tab-button-chat
- assertVisible:
    id: tab-unread-count-chat
`,
  "nate-options-reduce-motion": String.raw`appId: com.sarveshsea.NateTheBait
---
- launchApp:
    clearState: true
- tapOn: Options
- assertVisible:
    id: options-reduce-motion-status
`,
};

function captures(taskId) {
  const isWeb = taskId === "paraform-command-menu";
  const collector = isWeb ? "scripts/memi-v16-web-capture.mjs" : "scripts/memi-v16-ios-capture.mjs";
  const flowArgs = isWeb ? [] : ["--flow", "scripts/memi-v16-journey.yaml"];
  return [
    ["screenshot", "native-screenshot.png", "evidence/native-screenshot.png"],
    ["interaction-trace", "native-interaction-trace." + (isWeb ? "zip" : "xml"), "evidence/native-interaction-trace." + (isWeb ? "zip" : "xml")],
    ["accessibility-tree", "native-accessibility-tree.json", "evidence/native-accessibility-tree.json"],
  ].map(([kind, artifactName, sourcePath]) => ({
    kind,
    command: "node",
    args: [collector, "--kind", kind, "--output", sourcePath, ...flowArgs],
    timeoutMs: isWeb ? 300000 : 420000,
    sourcePath,
    artifactName,
  }));
}

async function buildTask(taskId) {
  const source = JSON.parse(await readFile(join(v15TaskRoot, taskId + ".json"), "utf8"));
  const isWeb = taskId === "paraform-command-menu";
  const collector = isWeb ? webCollector : iosCollector;
  const collectorName = isWeb ? "scripts/memi-v16-web-capture.mjs" : "scripts/memi-v16-ios-capture.mjs";
  return {
    ...source,
    preparation: [
      {
        command: "node",
        args: ["scripts/memi-v16-host-process-probe.mjs"],
        timeoutMs: 20_000,
      },
      ...isWeb ? [] : [
      {
        command: "node",
        args: ["scripts/memi-v16-ios-exclusive-reset.mjs"],
        timeoutMs: 420000,
      },
      ],
      ...source.preparation,
    ],
    nativeCaptures: captures(taskId),
    fixtures: [
      ...source.fixtures,
      {
        path: "scripts/memi-v16-host-process-probe.mjs",
        content: hostProcessProbe,
        executable: false,
      },
      { path: collectorName, content: collector, executable: false },
      ...isWeb ? [] : [{
        path: "scripts/memi-v16-ios-exclusive-reset.mjs",
        content: iosExclusiveReset,
        executable: false,
      }, {
        path: "scripts/memi-v16-journey.yaml",
        content: iosFlows[taskId],
        executable: false,
      }],
    ],
  };
}

for (const taskId of ["buzzr-tab-unread-badge", "paraform-command-menu", "nate-options-reduce-motion"]) {
  const expected = JSON.stringify(await buildTask(taskId), null, 2) + "\n";
  const target = join(outputRoot, taskId + ".json");
  if (checkOnly) {
    const actual = await readFile(target, "utf8").catch(() => "");
    if (actual !== expected) throw new Error("V16 task manifest is stale: " + taskId);
  } else {
    await mkdir(outputRoot, { recursive: true });
    await writeFile(target, expected, "utf8");
  }
}
console.log(checkOnly ? "V16 task manifests are current." : "Generated V16 task manifests.");
