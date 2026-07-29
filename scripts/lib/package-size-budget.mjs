export function evaluatePackageSizeBudget(input, options) {
  const stats = typeof input === "number"
    ? { size: input, unpackedSize: undefined, files: undefined }
    : input;
  const {
    maxSizeBytes,
    maxUnpackedBytes,
    maxFiles,
    maxUtilization,
  } = options;
  const { size, unpackedSize, files } = stats;

  if (!Number.isInteger(size) || size < 0) {
    throw new Error("size must be a non-negative integer");
  }
  if (!Number.isInteger(maxSizeBytes) || maxSizeBytes <= 0) {
    throw new Error("maxSizeBytes must be a positive integer");
  }
  if (!Number.isFinite(maxUtilization) || maxUtilization <= 0 || maxUtilization >= 1) {
    throw new Error("maxUtilization must be greater than zero and less than one");
  }
  if (maxUnpackedBytes !== undefined && (!Number.isInteger(maxUnpackedBytes) || maxUnpackedBytes <= 0)) {
    throw new Error("maxUnpackedBytes must be a positive integer");
  }
  if (maxFiles !== undefined && (!Number.isInteger(maxFiles) || maxFiles <= 0)) {
    throw new Error("maxFiles must be a positive integer");
  }
  if (unpackedSize !== undefined && (!Number.isInteger(unpackedSize) || unpackedSize < 0)) {
    throw new Error("unpackedSize must be a non-negative integer");
  }
  if (files !== undefined && (!Number.isInteger(files) || files < 0)) {
    throw new Error("files must be a non-negative integer");
  }

  const maxAllowedSizeBytes = Math.floor(maxSizeBytes * maxUtilization);
  const utilization = Number((size / maxSizeBytes).toFixed(4));
  const headroomBytes = maxSizeBytes - size;
  const minHeadroomBytes = Math.ceil(maxSizeBytes * (1 - maxUtilization));
  const compressedPassed = size <= maxAllowedSizeBytes;
  const unpackedPassed = maxUnpackedBytes === undefined
    || unpackedSize === undefined
    || unpackedSize <= maxUnpackedBytes;
  const filesPassed = maxFiles === undefined || files === undefined || files <= maxFiles;
  const passed = compressedPassed && unpackedPassed && filesPassed;
  const reason = !compressedPassed
    ? `package size ${size} exceeds the ${Math.round(maxUtilization * 100)}% utilization gate for the ${maxSizeBytes}-byte hard budget`
    : !unpackedPassed
      ? `package unpacked size ${unpackedSize} exceeds the ${maxUnpackedBytes}-byte hard budget`
      : !filesPassed
        ? `package files ${files} exceeds the ${maxFiles}-file hard budget`
        : null;

  return {
    passed,
    size,
    unpackedSize,
    files,
    maxSizeBytes,
    maxUnpackedBytes,
    maxFiles,
    maxAllowedSizeBytes,
    maxUtilization,
    utilization,
    headroomBytes,
    minHeadroomBytes,
    reason,
  };
}
