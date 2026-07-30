/**
 * Git scope resolution for PR-scoped audits — resolves the changed-file set
 * against a merge base so gates blame only what a PR touched.
 *
 * Failure here is a HARD ERROR, never a silent empty scope: an audit that
 * silently scopes to zero files would pass every gate while checking nothing.
 * The runtime note: whole-tree stats are still computed for threshold
 * validity, so scoped runs are about NOISE reduction (only your files gate),
 * not proportional speedup.
 */

import { execFile } from "node:child_process";

export interface GitScopeOptions {
  projectRoot: string;
  /** Base ref to diff against (e.g. origin/main). Merge-base semantics via triple-dot. */
  base: string;
  /** Also include uncommitted working-tree changes. Default true. */
  includeWorkingTree?: boolean;
}

export interface GitScope {
  base: string;
  mergeBase: string;
  /** Repo-relative changed file paths (deduped, sorted). */
  files: string[];
}

function git(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`git ${args.slice(0, 2).join(" ")} failed: ${String(stderr ?? "").trim() || error.message}`));
        return;
      }
      resolve(stdout);
    });
  });
}

/**
 * Resolve changed files vs the merge base of HEAD and `base`.
 *
 * Shallow-clone note: if the base ref is unknown (common with fetch-depth: 1
 * in CI), this throws with a fix hint instead of returning an empty scope.
 */
export async function resolveGitScope(options: GitScopeOptions): Promise<GitScope> {
  const { projectRoot, base } = options;

  let mergeBase: string;
  try {
    mergeBase = (await git(["merge-base", "HEAD", base], projectRoot)).trim();
  } catch (err) {
    throw new Error(
      `Cannot resolve merge base against "${base}": ${(err as Error).message}\n` +
      `  If this is a shallow CI clone, fetch enough history first (e.g. actions/checkout with fetch-depth: 0, ` +
      `or \`git fetch --no-tags origin ${base.replace(/^origin\//, "")}\`).`,
    );
  }

  const committed = await git(["diff", "--name-only", `${mergeBase}...HEAD`], projectRoot);
  const files = new Set(committed.split("\n").map((line) => line.trim()).filter(Boolean));

  if (options.includeWorkingTree !== false) {
    const working = await git(["diff", "--name-only", "HEAD"], projectRoot);
    for (const line of working.split("\n")) {
      const trimmed = line.trim();
      if (trimmed) files.add(trimmed);
    }
    const untracked = await git(["ls-files", "--others", "--exclude-standard"], projectRoot);
    for (const line of untracked.split("\n")) {
      const trimmed = line.trim();
      if (trimmed) files.add(trimmed);
    }
  }

  return { base, mergeBase, files: [...files].sort() };
}

/**
 * One-hop dependent expansion: add files that import any scoped file
 * (the TurboSnap move — a change to Button.tsx also puts every file that
 * imports Button.tsx in scope). Pure function over the already-built graph.
 */
export function expandScopeWithDependents(
  scopeFiles: string[],
  graphFiles: Array<{ path: string; importedBy: string[] }>,
): string[] {
  const scope = new Set(scopeFiles);
  const originalScope = new Set(scopeFiles);
  for (const file of graphFiles) {
    if (!originalScope.has(file.path)) continue;
    for (const dependent of file.importedBy) scope.add(dependent);
  }
  return [...scope].sort();
}
