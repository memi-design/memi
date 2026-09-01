import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { assertConsumerGraph } from "./consumer-boundary.mjs";
import { buildProductionShrinkwrap } from "./production-shrinkwrap.mjs";

export const PRODUCTION_SHRINKWRAP_PATH = join(
  "release",
  "npm-shrinkwrap.production.json",
);

export async function stagePackage({ packageRoot, stageRoot, clean = true }) {
  const absolutePackageRoot = resolve(packageRoot);
  const absoluteStageRoot = resolve(stageRoot);
  if (absolutePackageRoot === absoluteStageRoot) {
    throw new Error("package stage must not overwrite the source package");
  }
  const allowedStageRoots = [
    resolve(absolutePackageRoot, ".dist"),
    resolve(tmpdir()),
  ];
  if (!allowedStageRoots.some((allowedRoot) => isWithin(allowedRoot, absoluteStageRoot))) {
    throw new Error("package stage must stay inside .dist or the system temporary directory");
  }
  if (clean) await rm(absoluteStageRoot, { recursive: true, force: true });
  await mkdir(absoluteStageRoot, { recursive: true });

  const packageJson = JSON.parse(
    await readFile(join(absolutePackageRoot, "package.json"), "utf8"),
  );
  const [sourceShrinkwrap, productionShrinkwrap] = await Promise.all([
    readFile(join(absolutePackageRoot, "npm-shrinkwrap.json"), "utf8").then(JSON.parse),
    readFile(join(absolutePackageRoot, PRODUCTION_SHRINKWRAP_PATH), "utf8").then(JSON.parse),
  ]);
  validateProductionShrinkwrap(packageJson, sourceShrinkwrap, productionShrinkwrap);

  const stagedPackageJson = {
    ...packageJson,
    scripts: undefined,
    devDependencies: undefined,
  };
  await writeFile(
    join(absoluteStageRoot, "package.json"),
    `${JSON.stringify(stagedPackageJson, null, 2)}\n`,
    "utf8",
  );
  for (const entry of packageJson.files ?? []) {
    if (entry === "npm-shrinkwrap.json") continue;
    await cp(
      join(absolutePackageRoot, entry),
      join(absoluteStageRoot, entry),
      { recursive: true },
    );
  }
  await cp(
    join(absolutePackageRoot, PRODUCTION_SHRINKWRAP_PATH),
    join(absoluteStageRoot, "npm-shrinkwrap.json"),
  );

  return {
    packageRoot: absolutePackageRoot,
    stageRoot: absoluteStageRoot,
    packageJson,
    productionPackages: assertConsumerGraph(productionShrinkwrap).packages,
  };
}

function isWithin(parent, child) {
  const path = relative(parent, child);
  return path !== "" && !path.startsWith("..") && !isAbsolute(path);
}

function validateProductionShrinkwrap(packageJson, sourceLock, lock) {
  const rootPackage = lock.packages?.[""];
  if (lock.name !== packageJson.name || rootPackage?.name !== packageJson.name) {
    throw new Error("production shrinkwrap package name does not match package.json");
  }
  if (lock.version !== packageJson.version || rootPackage?.version !== packageJson.version) {
    throw new Error("production shrinkwrap version does not match package.json");
  }
  if (rootPackage.devDependencies || rootPackage.optionalDependencies) {
    throw new Error("production shrinkwrap must not contain root development or optional dependencies");
  }
  const expectedLock = buildProductionShrinkwrap(sourceLock);
  if (JSON.stringify(lock) !== JSON.stringify(expectedLock)) {
    throw new Error("production shrinkwrap must be the deterministic subset of npm-shrinkwrap.json; run npm run build:production-shrinkwrap");
  }
  assertConsumerGraph(lock);
}
