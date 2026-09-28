// @ts-nocheck
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const installer = join(process.cwd(), "scripts/install.sh");

async function fixture(options: { badArchive?: boolean; failSwap?: boolean; platform?: [string, string]; unsafeEntry?: "symlink" | "fifo"; killAfterBackup?: "TERM" | "KILL" } = {}) {
  const root = await mkdtemp(join(tmpdir(), "memi-installer-test-"));
  const assets = join(root, "assets");
  const tools = join(root, "tools");
  const installDir = join(root, "install");
  await Promise.all([mkdir(assets), mkdir(tools), mkdir(join(installDir, "app"), { recursive: true })]);
  await writeFile(join(installDir, "app", "memi"), "previous-version\n");
  const payload = join(root, "payload");
  const [system, machine] = options.platform ?? ["Linux", "aarch64"];
  const target = system === "Darwin" ? (machine === "arm64" ? "darwin-arm64" : "darwin-x64") : (machine === "x86_64" ? "linux-x64" : "linux-arm64");
  await mkdir(join(payload, `memi-${target}`), { recursive: true });
  await writeFile(join(payload, `memi-${target}`, "memi"), "#!/bin/sh\necho new-version\n");
  await chmod(join(payload, `memi-${target}`, "memi"), 0o755);
  if (options.unsafeEntry === "symlink") await symlink("/etc/passwd", join(payload, `memi-${target}`, "escape"));
  if (options.unsafeEntry === "fifo") execFileSync("mkfifo", [join(payload, `memi-${target}`, "escape")]);
  const archiveName = `memi-${target}.tar.gz`;
  const archive = join(assets, archiveName);
  if (options.badArchive) await writeFile(archive, "not a tar archive");
  else execFileSync("tar", ["-czf", archive, "-C", payload, `memi-${target}`]);
  const hash = createHash("sha256").update(await readFile(archive)).digest("hex");
  await writeFile(join(assets, "SHA256SUMS.txt"), `${hash}  ${archiveName}\n`);
  await writeFile(join(tools, "uname"), `#!/bin/sh\nif [ "$1" = -s ]; then echo ${system}; else echo ${machine}; fi\n`);
  await writeFile(join(tools, "curl"), "#!/bin/sh\nurl=\"\"\nout=\"\"\nwhile [ \"$#\" -gt 0 ]; do\n  case \"$1\" in\n    https://*) url=\"$1\";;\n    -o) shift; out=\"$1\";;\n  esac\n  shift\ndone\ncp \"$MOCK_ASSET_DIR/$(basename \"$url\")\" \"$out\"\n");
  await Promise.all([chmod(join(tools, "uname"), 0o755), chmod(join(tools, "curl"), 0o755)]);
  if (options.failSwap) {
    await writeFile(join(tools, "mv"), `#!/bin/sh\ncase "$1:$2" in *memi-install*/memi-${target}:*/app) exit 77;; esac\n/bin/mv "$@"\n`);
    await chmod(join(tools, "mv"), 0o755);
  } else if (options.killAfterBackup) {
    await writeFile(join(tools, "mv"), `#!/bin/sh\n/bin/mv "$@" || exit $?\ncase "$2" in */previous-app) if [ ! -e "$MOCK_ASSET_DIR/killed" ]; then touch "$MOCK_ASSET_DIR/killed"; kill -${options.killAfterBackup} "$PPID"; fi;; esac\n`);
    await chmod(join(tools, "mv"), 0o755);
  }
  return { root, assets, tools, installDir };
}

describe("standalone shell installer", () => {
  it.each([
    ["Darwin", "arm64"], ["Darwin", "x86_64"], ["Linux", "x86_64"], ["Linux", "aarch64"],
  ])("installs a checksum-verified %s %s release", async (system, machine) => {
    const { root, assets, tools, installDir } = await fixture({ platform: [system, machine] });
    const result = spawnSync("sh", [installer, "--dir", installDir, "--no-path"], {
      env: { ...process.env, HOME: root, PATH: `${tools}:${process.env.PATH}`, MOCK_ASSET_DIR: assets },
      encoding: "utf8",
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("sha256 verified");
    expect(await readFile(join(installDir, "app", "memi"), "utf8")).toContain("new-version");
  });

  it.each(["symlink", "fifo"] as const)("rejects %s archive entries before extraction", async (unsafeEntry) => {
    const { root, assets, tools, installDir } = await fixture({ unsafeEntry });
    const result = spawnSync("sh", [installer, "--dir", installDir, "--no-path"], {
      env: { ...process.env, HOME: root, PATH: `${tools}:${process.env.PATH}`, MOCK_ASSET_DIR: assets },
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("unsafe archive entry");
    expect(await readFile(join(installDir, "app", "memi"), "utf8")).toBe("previous-version\n");
  });

  it("keeps an existing installation when the verified archive cannot be extracted", async () => {
    const { root, assets, tools, installDir } = await fixture({ badArchive: true });
    const result = spawnSync("sh", [installer, "--dir", installDir, "--no-path"], {
      env: { ...process.env, HOME: root, PATH: `${tools}:${process.env.PATH}`, MOCK_ASSET_DIR: assets },
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(await readFile(join(installDir, "app", "memi"), "utf8")).toBe("previous-version\n");
  });

  it("rejects a checksum mismatch without touching the existing installation", async () => {
    const { root, assets, tools, installDir } = await fixture();
    await writeFile(join(assets, "SHA256SUMS.txt"), `${"0".repeat(64)}  memi-linux-arm64.tar.gz\n`);
    const result = spawnSync("sh", [installer, "--dir", installDir, "--no-path"], {
      env: { ...process.env, HOME: root, PATH: `${tools}:${process.env.PATH}`, MOCK_ASSET_DIR: assets },
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("sha256 mismatch");
    expect(await readFile(join(installDir, "app", "memi"), "utf8")).toBe("previous-version\n");
  });

  it("rolls back when activation fails after backing up the old app", async () => {
    const { root, assets, tools, installDir } = await fixture({ failSwap: true });
    const result = spawnSync("sh", [installer, "--dir", installDir, "--no-path"], {
      env: { ...process.env, HOME: root, PATH: `${tools}:${process.env.PATH}`, MOCK_ASSET_DIR: assets },
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(await readFile(join(installDir, "app", "memi"), "utf8")).toBe("previous-version\n");
  });

  it("restores the previous app after SIGTERM between backup and activation", async () => {
    const { root, assets, tools, installDir } = await fixture({ killAfterBackup: "TERM" });
    const result = spawnSync("sh", [installer, "--dir", installDir, "--no-path"], {
      env: { ...process.env, HOME: root, PATH: `${tools}:${process.env.PATH}`, MOCK_ASSET_DIR: assets },
      encoding: "utf8",
    });
    expect(result.status).not.toBe(0);
    expect(await readFile(join(installDir, "app", "memi"), "utf8")).toBe("previous-version\n");
  });

  it("recovers the previous app on the next invocation after SIGKILL", async () => {
    const { root, assets, tools, installDir } = await fixture({ killAfterBackup: "KILL" });
    const env = { ...process.env, HOME: root, PATH: `${tools}:${process.env.PATH}`, MOCK_ASSET_DIR: assets };
    const first = spawnSync("sh", [installer, "--dir", installDir, "--no-path"], { env, encoding: "utf8" });
    expect(first.status).not.toBe(0);
    await writeFile(join(assets, "SHA256SUMS.txt"), `${"0".repeat(64)}  memi-linux-arm64.tar.gz\n`);
    const second = spawnSync("sh", [installer, "--dir", installDir, "--no-path"], { env, encoding: "utf8" });
    expect(second.status).not.toBe(0);
    expect(second.stderr).toContain("sha256 mismatch");
    expect(await readFile(join(installDir, "app", "memi"), "utf8")).toBe("previous-version\n");
  });
});
