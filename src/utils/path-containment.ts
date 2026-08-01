import path from "node:path";

type PathImplementation = typeof path.posix;

const WINDOWS_DRIVE_ROOT = /^[A-Za-z]:[\\/]/;
const WINDOWS_UNC_ROOT = /^(?:\\\\|\/\/)[^\\/]+[\\/][^\\/]+/;

function pathImplementationFor(root: string): PathImplementation {
  if (WINDOWS_DRIVE_ROOT.test(root) || WINDOWS_UNC_ROOT.test(root)) {
    return path.win32;
  }
  if (root.startsWith("/")) {
    return path.posix;
  }
  return path;
}

/**
 * Test whether candidate is root itself or one of its descendants.
 *
 * `path.relative` supplies the platform semantics that prefix checks miss:
 * Windows drive letters and path segments are case-insensitive, both slash
 * styles are recognized, and another drive remains absolute (and therefore
 * outside). The explicit `..` segment check rejects traversal and sibling
 * prefixes without rejecting legitimate 8.3 path segments such as RUNNER~1.
 */
export function isPathWithin(candidate: string, root: string): boolean {
  const pathApi = pathImplementationFor(root);
  const resolvedRoot = pathApi.resolve(root);
  const resolvedCandidate = pathApi.resolve(candidate);
  const relativePath = pathApi.relative(resolvedRoot, resolvedCandidate);

  return relativePath === "" || (
    !pathApi.isAbsolute(relativePath)
    && relativePath !== ".."
    && !relativePath.startsWith(`..${pathApi.sep}`)
  );
}

/** Resolve an input against root and fail closed when it escapes root. */
export function resolvePathWithin(root: string, input: string): string {
  const pathApi = pathImplementationFor(root);
  const resolvedRoot = pathApi.resolve(root);
  const resolvedCandidate = pathApi.resolve(resolvedRoot, input);
  if (!isPathWithin(resolvedCandidate, resolvedRoot)) {
    throw new Error(`Path is outside allowed root: ${input}`);
  }
  return resolvedCandidate;
}
