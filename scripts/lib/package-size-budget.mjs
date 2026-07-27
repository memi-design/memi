export function evaluatePackageSizeBudget(size, options) {
  const { maxSizeBytes, maxUtilization } = options;
  if (!Number.isInteger(size) || size < 0) {
    throw new Error("size must be a non-negative integer");
  }
  if (!Number.isInteger(maxSizeBytes) || maxSizeBytes <= 0) {
    throw new Error("maxSizeBytes must be a positive integer");
  }
  if (!Number.isFinite(maxUtilization) || maxUtilization <= 0 || maxUtilization >= 1) {
    throw new Error("maxUtilization must be greater than zero and less than one");
  }

  const maxAllowedSizeBytes = Math.floor(maxSizeBytes * maxUtilization);
  const utilization = Number((size / maxSizeBytes).toFixed(4));
  const headroomBytes = maxSizeBytes - size;
  const minHeadroomBytes = Math.ceil(maxSizeBytes * (1 - maxUtilization));
  const passed = size <= maxAllowedSizeBytes;

  return {
    passed,
    size,
    maxSizeBytes,
    maxAllowedSizeBytes,
    maxUtilization,
    utilization,
    headroomBytes,
    minHeadroomBytes,
    reason: passed
      ? null
      : `package size ${size} exceeds the ${Math.round(maxUtilization * 100)}% utilization gate for the ${maxSizeBytes}-byte hard budget`,
  };
}
