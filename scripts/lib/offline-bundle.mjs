import { createHash } from "node:crypto";
import {
  access,
  chmod,
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { create as createTar } from "tar";

export const OFFLINE_TARGETS = Object.freeze({
  "darwin-arm64": Object.freeze({
    id: "darwin-arm64",
    os: "darwin",
    arch: "arm64",
    binary: "memi",
    binaryStageTarget: "darwin-arm64",
  }),
  "darwin-x64": Object.freeze({
    id: "darwin-x64",
    os: "darwin",
    arch: "x64",
    binary: "memi",
    binaryStageTarget: "darwin-x64",
  }),
  "linux-arm64": Object.freeze({
    id: "linux-arm64",
    os: "linux",
    arch: "arm64",
    binary: "memi",
    binaryStageTarget: "linux-arm64",
  }),
  "linux-x64": Object.freeze({
    id: "linux-x64",
    os: "linux",
    arch: "x64",
    binary: "memi",
    binaryStageTarget: "linux-x64",
  }),
  "windows-x64": Object.freeze({
    id: "windows-x64",
    os: "windows",
    arch: "x64",
    binary: "memi.exe",
    binaryStageTarget: "win-x64",
  }),
});

const SIDECAR_DIRECTORIES = Object.freeze(["skills", "notes", "plugin", "preview/templates"]);
const FORBIDDEN_SEGMENTS = new Set([
  ".git",
  ".github",
  ".cache",
  "__tests__",
  "coverage",
  "node_modules",
  "src",
  "test",
  "tests",
]);
const FORBIDDEN_FILE_PATTERNS = Object.freeze([
  /^\.env(?:\..*)?$/i,
  /\.(?:key|p12|pfx|pem)$/i,
  /^(?:id_dsa|id_ecdsa|id_ed25519|id_rsa)$/i,
]);
const SEMVER_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export function resolveOfflineTarget(value) {
  const target = OFFLINE_TARGETS[value];
  if (!target) {
    throw new Error(
      `Unsupported offline target: ${String(value)}. Supported targets: ${Object.keys(OFFLINE_TARGETS).join(", ")}`,
    );
  }
  return target;
}

export async function buildOfflineBundle({
  root,
  target,
  binaryStageDir,
  outputDir,
  sourceDateEpoch = 0,
}) {
  const contract = resolveOfflineTarget(target);
  const repositoryRoot = resolve(root);
  const destinationRoot = resolve(outputDir ?? join(repositoryRoot, "dist-bin"));
  const epochSeconds = normalizeSourceDateEpoch(sourceDateEpoch);
  const packageMetadata = await readJson(join(repositoryRoot, "package.json"), "package.json");
  const shrinkwrap = await readJson(
    join(repositoryRoot, "npm-shrinkwrap.json"),
    "npm-shrinkwrap.json",
  );
  validatePackageMetadata(packageMetadata);

  const archiveBase = `memi-offline-${packageMetadata.version}-${contract.id}`;
  const archiveName = `${archiveBase}.tar.gz`;
  const archivePath = join(destinationRoot, archiveName);
  const checksumPath = `${archivePath}.sha256`;
  const stageDir = join(destinationRoot, archiveBase);
  const compiledStage = resolve(
    binaryStageDir ?? join(repositoryRoot, "dist-bin", `memi-${contract.binaryStageTarget}`),
  );

  await mkdir(destinationRoot, { recursive: true });
  await rm(stageDir, { force: true, recursive: true });
  await rm(archivePath, { force: true });
  await rm(checksumPath, { force: true });
  await mkdir(stageDir, { recursive: true });

  await copyRequiredFile(join(compiledStage, contract.binary), join(stageDir, contract.binary));
  await chmod(join(stageDir, contract.binary), 0o755);
  for (const relativePath of SIDECAR_DIRECTORIES) {
    const sourcePath = join(compiledStage, relativePath);
    if (!(await exists(sourcePath))) continue;
    await assertSafeRuntimeTree(sourcePath, relativePath);
    const destinationPath = join(stageDir, relativePath);
    await mkdir(dirname(destinationPath), { recursive: true });
    await cp(sourcePath, destinationPath, {
      dereference: false,
      force: false,
      preserveTimestamps: false,
      recursive: true,
      verbatimSymlinks: true,
    });
  }

  await copyRequiredFile(join(repositoryRoot, "LICENSE"), join(stageDir, "LICENSE"));
  await copyRequiredFile(join(repositoryRoot, "NOTICE"), join(stageDir, "NOTICE"));

  const runtimePackage = createRuntimePackage(packageMetadata, contract);
  await writeCanonicalJson(join(stageDir, "package.json"), runtimePackage);

  const components = productionComponentsFromShrinkwrap(shrinkwrap);
  const sbom = createCycloneDxSbom(runtimePackage, components);
  await writeCanonicalJson(join(stageDir, "sbom.cdx.json"), sbom);
  await writeFile(
    join(stageDir, "THIRD_PARTY_NOTICES.txt"),
    renderThirdPartyNotices(components),
    "utf8",
  );
  await writeFile(
    join(stageDir, "OFFLINE.md"),
    renderOfflineReadme(runtimePackage, contract, archiveName),
    "utf8",
  );

  await normalizeTreeModes(stageDir, contract.binary);
  const payloadFiles = await inventoryFiles(stageDir);
  const manifest = {
    schemaVersion: 1,
    product: runtimePackage.name,
    version: runtimePackage.version,
    target: {
      id: contract.id,
      os: contract.os,
      arch: contract.arch,
      binary: contract.binary,
    },
    runtime: {
      standalone: true,
      requiresNodeRuntime: false,
      requiresFirstRunDependencyFetch: false,
      networkRequiredForLaunch: false,
    },
    evidence: {
      license: "LICENSE",
      productNotice: "NOTICE",
      thirdPartyNotices: "THIRD_PARTY_NOTICES.txt",
      sbom: "sbom.cdx.json",
      checksums: "SHA256SUMS.txt",
    },
    files: payloadFiles,
  };
  await writeCanonicalJson(join(stageDir, "offline-bundle.json"), manifest);

  const checksumInventory = await inventoryFiles(stageDir);
  await writeFile(
    join(stageDir, "SHA256SUMS.txt"),
    checksumInventory.map((file) => `${file.sha256}  ${file.path}\n`).join(""),
    "utf8",
  );
  await normalizeTreeModes(stageDir, contract.binary);

  const archiveEntries = await inventoryArchiveEntries(destinationRoot, archiveBase);
  await createTar({
    cwd: destinationRoot,
    file: archivePath,
    gzip: { mtime: 0 },
    jobs: 1,
    mtime: new Date(epochSeconds * 1000),
    noDirRecurse: true,
    portable: true,
    strict: true,
  }, archiveEntries);

  const archiveSha256 = await sha256File(archivePath);
  await writeFile(checksumPath, `${archiveSha256}  ${archiveName}\n`, "utf8");

  return {
    archiveName,
    archivePath,
    archiveSha256,
    checksumPath,
    manifest,
    stageDir,
    target: contract,
  };
}

export function productionComponentsFromShrinkwrap(shrinkwrap) {
  if (!shrinkwrap || typeof shrinkwrap !== "object" || !shrinkwrap.packages) {
    throw new Error("npm-shrinkwrap.json must contain a packages object");
  }

  const uniqueComponents = new Map();
  for (const [lockPath, packageEntry] of Object.entries(shrinkwrap.packages)) {
    if (!lockPath || !packageEntry || typeof packageEntry !== "object" || packageEntry.dev === true) {
      continue;
    }
    const name = packageEntry.name ?? packageNameFromLockPath(lockPath);
    const version = packageEntry.version;
    if (!name || typeof version !== "string" || !version) {
      throw new Error(`Production package at ${lockPath} is missing its name or version`);
    }
    const key = `${name}@${version}`;
    if (uniqueComponents.has(key)) continue;
    const license = normalizeLicense(packageEntry.license);
    const component = {
      type: "library",
      "bom-ref": npmPurl(name, version),
      name,
      version,
      licenses: [{ license: spdxLicense(license) }],
      purl: npmPurl(name, version),
      properties: [{
        name: "memi:npmOptional",
        value: packageEntry.optional === true ? "true" : "false",
      }],
    };
    const integrityHash = integrityToCycloneDxHash(packageEntry.integrity);
    if (integrityHash) component.hashes = [integrityHash];
    uniqueComponents.set(key, component);
  }

  return [...uniqueComponents.values()].sort((left, right) =>
    left.name.localeCompare(right.name) || left.version.localeCompare(right.version));
}

export function createCycloneDxSbom(runtimePackage, components) {
  return {
    $schema: "http://cyclonedx.org/schema/bom-1.5.schema.json",
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    version: 1,
    metadata: {
      component: {
        type: "application",
        "bom-ref": npmPurl(runtimePackage.name, runtimePackage.version),
        name: runtimePackage.name,
        version: runtimePackage.version,
        licenses: [{ license: spdxLicense(normalizeLicense(runtimePackage.license)) }],
        purl: npmPurl(runtimePackage.name, runtimePackage.version),
      },
      properties: [{ name: "memi:distribution", value: "standalone-offline-bundle" }],
    },
    components,
  };
}

export async function sha256File(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function createRuntimePackage(packageMetadata, target) {
  return {
    name: packageMetadata.name,
    version: packageMetadata.version,
    description: packageMetadata.description,
    license: packageMetadata.license,
    type: "module",
    bin: { memi: `./${target.binary}` },
  };
}

function validatePackageMetadata(packageMetadata) {
  for (const key of ["name", "version", "description", "license"]) {
    if (typeof packageMetadata?.[key] !== "string" || !packageMetadata[key]) {
      throw new Error(`package.json must define a non-empty ${key}`);
    }
  }
  if (packageMetadata.name !== "@memi-design/cli") {
    throw new Error("package.json name must be @memi-design/cli for an offline Memi bundle");
  }
  if (!SEMVER_PATTERN.test(packageMetadata.version)) {
    throw new Error("package.json version must be a valid semantic version");
  }
}

function normalizeSourceDateEpoch(value) {
  const number = typeof value === "string" ? Number(value) : value;
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error("sourceDateEpoch must be a non-negative integer");
  }
  return number;
}

async function copyRequiredFile(sourcePath, destinationPath) {
  const sourceStat = await lstat(sourcePath).catch(() => null);
  if (!sourceStat?.isFile() || sourceStat.isSymbolicLink()) {
    throw new Error(`Required offline bundle file is missing or unsafe: ${basename(sourcePath)}`);
  }
  await mkdir(dirname(destinationPath), { recursive: true });
  await cp(sourcePath, destinationPath, { force: false, preserveTimestamps: false });
}

async function assertSafeRuntimeTree(rootPath, label) {
  const rootStat = await lstat(rootPath);
  if (rootStat.isSymbolicLink()) {
    throw new Error(`Runtime sidecar contains a symbolic link: ${label}`);
  }
  if (!rootStat.isDirectory()) {
    throw new Error(`Runtime sidecar must be a directory: ${label}`);
  }
  await walk(rootPath, label);

  async function walk(currentPath, relativePath) {
    const entries = (await readdir(currentPath, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const entryPath = join(currentPath, entry.name);
      const entryLabel = `${relativePath}/${entry.name}`;
      const entryStat = await lstat(entryPath);
      if (entryStat.isSymbolicLink()) {
        throw new Error(`Runtime sidecar contains a symbolic link: ${entryLabel}`);
      }
      if (isForbiddenRuntimeName(entry.name)) {
        throw new Error(`Runtime sidecar contains forbidden dev or secret content: ${entryLabel}`);
      }
      if (!isPortableRuntimeName(entry.name)) {
        throw new Error(`Runtime sidecar contains a non-portable filename: ${entryLabel}`);
      }
      if (entryStat.isDirectory()) {
        await walk(entryPath, entryLabel);
      } else if (!entryStat.isFile() || entryStat.nlink > 1) {
        throw new Error(`Runtime sidecar contains an unsupported file: ${entryLabel}`);
      }
    }
  }
}

function isForbiddenRuntimeName(name) {
  return FORBIDDEN_SEGMENTS.has(name) || FORBIDDEN_FILE_PATTERNS.some((pattern) => pattern.test(name));
}

export function isPortableRuntimeName(name) {
  return ![
    /[\u0000-\u001f\u007f<>:"|?*\\]/,
    /[ .]$/,
    WINDOWS_RESERVED_NAME,
  ].some((pattern) => pattern.test(name));
}

async function normalizeTreeModes(rootPath, binaryName) {
  await chmod(rootPath, 0o755);
  await walk(rootPath, "");

  async function walk(currentPath, relativePath) {
    const entries = (await readdir(currentPath, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const entryPath = join(currentPath, entry.name);
      const entryRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await chmod(entryPath, 0o755);
        await walk(entryPath, entryRelativePath);
      } else if (entry.isFile()) {
        await chmod(entryPath, entryRelativePath === binaryName ? 0o755 : 0o644);
      }
    }
  }
}

async function inventoryFiles(rootPath) {
  const files = [];
  await walk(rootPath, "");
  return files;

  async function walk(currentPath, relativePath) {
    const entries = (await readdir(currentPath, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const entryPath = join(currentPath, entry.name);
      const entryRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(entryPath, entryRelativePath);
      } else if (entry.isFile()) {
        const fileStat = await stat(entryPath);
        files.push({
          path: entryRelativePath,
          sha256: await sha256File(entryPath),
          size: fileStat.size,
        });
      }
    }
  }
}

async function inventoryArchiveEntries(parentPath, directoryName) {
  const directoryPath = requireContainedPath(parentPath, directoryName);
  const entries = [directoryName];
  await walk(directoryPath, directoryName);
  return entries;

  async function walk(currentPath, relativePath) {
    const children = (await readdir(currentPath, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const childPath = join(currentPath, child.name);
      const childRelativePath = `${relativePath}/${child.name}`;
      const childStat = await lstat(childPath);
      if (childStat.isSymbolicLink()) {
        throw new Error(`Offline bundle contains a symbolic link: ${childRelativePath}`);
      }
      if (childStat.isDirectory()) {
        entries.push(childRelativePath);
        await walk(childPath, childRelativePath);
      } else if (childStat.isFile() && childStat.nlink === 1) {
        entries.push(childRelativePath);
      } else {
        throw new Error(`Offline bundle contains an unsupported file: ${childRelativePath}`);
      }
    }
  }
}

function renderThirdPartyNotices(components) {
  return [
    "Memi standalone offline bundle — third-party dependency notices",
    "",
    "These packages are compiled into or conservatively reported for the standalone runtime.",
    "Refer to each package's upstream distribution for its complete license text.",
    "",
    ...components.map((component) =>
      `- ${component.name}@${component.version} — ${component.licenses[0].license.id ?? component.licenses[0].license.name}`),
    "",
  ].join("\n");
}

function renderOfflineReadme(runtimePackage, target, archiveName) {
  const launchCommand = target.os === "windows" ? ".\\memi.exe --version" : "./memi --version";
  return [
    `# Memi ${runtimePackage.version} offline bundle`,
    "",
    `Artifact: ${archiveName}`,
    `Target OS: ${target.os}`,
    `Target architecture: ${target.arch}`,
    "",
    "This archive contains a standalone CLI runtime and its required sidecars.",
    "Launching it does not install packages or download dependencies.",
    "Keep the extracted directory together so runtime assets remain discoverable.",
    "",
    "Verify the adjacent .sha256 file before extracting, then run:",
    "",
    "```text",
    launchCommand,
    "```",
    "",
    "Review offline-bundle.json, SHA256SUMS.txt, sbom.cdx.json, LICENSE, NOTICE,",
    "and THIRD_PARTY_NOTICES.txt before approving the artifact for internal use.",
    "",
  ].join("\n");
}

function packageNameFromLockPath(lockPath) {
  const marker = "node_modules/";
  const lastMarker = lockPath.lastIndexOf(marker);
  if (lastMarker === -1) return "";
  const remainder = lockPath.slice(lastMarker + marker.length);
  if (!remainder.startsWith("@")) return remainder.split("/")[0] ?? "";
  const [scope, name] = remainder.split("/");
  return scope && name ? `${scope}/${name}` : "";
}

function npmPurl(name, version) {
  const encodedName = name.startsWith("@")
    ? `${encodeURIComponent(name.slice(0, name.indexOf("/")))}${name.slice(name.indexOf("/"))}`
    : encodeURIComponent(name);
  return `pkg:npm/${encodedName}@${encodeURIComponent(version)}`;
}

function normalizeLicense(value) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object" && typeof value.type === "string" && value.type.trim()) {
    return value.type.trim();
  }
  return "NOASSERTION";
}

function spdxLicense(value) {
  return /^[A-Za-z0-9-.+]+$/.test(value) ? { id: value } : { name: value };
}

function integrityToCycloneDxHash(integrity) {
  if (typeof integrity !== "string") return null;
  const [algorithm, encoded] = integrity.split("-", 2);
  const cycloneDxAlgorithm = {
    sha256: "SHA-256",
    sha384: "SHA-384",
    sha512: "SHA-512",
  }[algorithm];
  if (!cycloneDxAlgorithm || !encoded) return null;
  try {
    return { alg: cycloneDxAlgorithm, content: Buffer.from(encoded, "base64").toString("hex") };
  } catch {
    return null;
  }
}

function requireContainedPath(parentPath, childPath) {
  const parent = resolve(parentPath);
  const candidate = resolve(parent, childPath);
  const childRelativePath = relative(parent, candidate);
  if (
    !childRelativePath ||
    childRelativePath === ".." ||
    childRelativePath.startsWith(`..${sep}`) ||
    resolve(parent, childRelativePath) !== candidate
  ) {
    throw new Error(`Offline bundle path escapes its root: ${childPath}`);
  }
  return candidate;
}

async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function writeCanonicalJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
