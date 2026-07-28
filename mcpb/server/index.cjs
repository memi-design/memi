const { spawn } = require("node:child_process");

const executable = process.platform === "win32" ? "npx.cmd" : "npx";
const args = [
  "-y",
  "@memi-design/cli@2.6.4",
  "mcp", "start", "--no-figma",
];

const child = spawn(executable, args, {
  env: process.env,
  stdio: "inherit",
  windowsHide: true,
});

child.once("error", (error) => {
  console.error(`Failed to start Memi through ${executable}: ${error.message}`);
  process.exitCode = 1;
});

child.once("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exitCode = code ?? 1;
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    if (!child.killed) child.kill(signal);
  });
}
