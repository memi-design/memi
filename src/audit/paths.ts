export function canonicalAuditPath(value: string): string {
  return value.replaceAll("\\", "/");
}
