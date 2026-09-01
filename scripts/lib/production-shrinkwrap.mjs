export function buildProductionShrinkwrap(sourceLock) {
  if (!sourceLock || typeof sourceLock !== "object" || Array.isArray(sourceLock)) {
    throw new Error("source npm-shrinkwrap.json must be a JSON object");
  }
  if (sourceLock.lockfileVersion !== 3) {
    throw new Error("source npm-shrinkwrap.json must use lockfileVersion 3");
  }
  const sourcePackages = sourceLock.packages;
  const sourceRoot = sourcePackages?.[""];
  if (!sourceRoot || typeof sourceRoot !== "object") {
    throw new Error("source npm-shrinkwrap.json is missing its root package");
  }

  const includedPaths = new Set([""]);
  const queue = [""];
  while (queue.length > 0) {
    const lockPath = queue.shift();
    const packageEntry = sourcePackages[lockPath];
    for (const dependencyName of requiredDependencyNames(packageEntry)) {
      const dependencyPath = resolveLockedDependency(
        sourcePackages,
        lockPath,
        dependencyName,
      );
      if (!dependencyPath) {
        throw new Error(`cannot resolve ${dependencyName} from ${lockPath || "root"} in source npm-shrinkwrap.json`);
      }
      if (!includedPaths.has(dependencyPath)) {
        includedPaths.add(dependencyPath);
        queue.push(dependencyPath);
      }
    }
  }

  const rootPackage = cloneJson(sourceRoot);
  delete rootPackage.devDependencies;
  delete rootPackage.optionalDependencies;

  const packages = { "": rootPackage };
  for (const lockPath of [...includedPaths].filter(Boolean).sort()) {
    const packageEntry = sourcePackages[lockPath];
    if (
      packageEntry.dev === true
      || packageEntry.optional === true
      || packageEntry.devOptional === true
    ) {
      throw new Error(`production closure includes non-production package ${lockPath}`);
    }
    packages[lockPath] = cloneJson(packageEntry);
  }

  return {
    ...cloneJson(sourceLock),
    packages,
  };
}

function requiredDependencyNames(packageEntry) {
  const optionalNames = new Set(Object.keys(packageEntry.optionalDependencies ?? {}));
  const names = new Set(
    Object.keys(packageEntry.dependencies ?? {}).filter((name) => !optionalNames.has(name)),
  );
  for (const name of Object.keys(packageEntry.peerDependencies ?? {})) {
    if (packageEntry.peerDependenciesMeta?.[name]?.optional !== true) names.add(name);
  }
  return [...names].sort();
}

function resolveLockedDependency(packages, fromPath, dependencyName) {
  let cursor = fromPath;
  while (true) {
    const candidate = cursor
      ? `${cursor}/node_modules/${dependencyName}`
      : `node_modules/${dependencyName}`;
    if (packages[candidate]) return candidate;
    if (!cursor) return undefined;
    const parentMarker = cursor.lastIndexOf("/node_modules/");
    cursor = parentMarker < 0 ? "" : cursor.slice(0, parentMarker);
  }
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}
