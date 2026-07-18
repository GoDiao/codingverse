// Cross-cutting B (v3): git-diff based change detection for diff-scoped pack.
//
// The blob-hash ParseCache answers "did THIS file's content change since I
// last parsed it" without any git binary. But `cv pack --changed / --since`
// asks a different question — "which files differ from HEAD / a given ref" —
// which is exactly what `git diff --name-only` answers. This helper shells out
// to git (via execFile, array args, no shell) and returns repo-relative POSIX
// paths, or null when the directory is not a git repo / git is unavailable so
// callers can fall back gracefully.

import { execFile } from "node:child_process";

function runGit(repoPath: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      "git",
      ["-C", repoPath, ...args],
      { maxBuffer: 32 * 1024 * 1024 },
      (err, stdout) => {
        if (err) resolve(null);
        else resolve(stdout);
      },
    );
  });
}

function parsePaths(stdout: string | null): string[] | null {
  if (stdout === null) return null;
  const seen = new Set<string>();
  for (const line of stdout.split("\n")) {
    const p = line.trim();
    if (!p) continue;
    // git already emits forward slashes on all platforms for diff output.
    seen.add(p);
  }
  return [...seen];
}

/**
 * Files changed in the working tree relative to HEAD: staged + unstaged +
 * untracked (but not ignored). Returns repo-relative paths, or null if this is
 * not a git repo / git is missing. An empty array means "clean tree".
 */
export async function changedFilesSinceHead(repoPath: string): Promise<string[] | null> {
  // Tracked changes (staged + unstaged) vs HEAD.
  const tracked = parsePaths(await runGit(repoPath, ["diff", "--name-only", "HEAD"]));
  if (tracked === null) {
    // Could be a repo with no commits yet — try diff against the empty tree.
    const noHead = parsePaths(await runGit(repoPath, ["diff", "--name-only"]));
    if (noHead === null) return null;
    const untrackedOnly = parsePaths(
      await runGit(repoPath, ["ls-files", "--others", "--exclude-standard"]),
    );
    return dedupe([...(noHead ?? []), ...(untrackedOnly ?? [])]);
  }
  // Untracked (new) files not yet added — these are "changed" for pack intent.
  const untracked = parsePaths(
    await runGit(repoPath, ["ls-files", "--others", "--exclude-standard"]),
  );
  return dedupe([...tracked, ...(untracked ?? [])]);
}

/**
 * Files that differ between `ref` and the working tree. `ref` is any git
 * revision (commit sha, tag, branch). Returns repo-relative paths, or null on
 * failure (bad ref / not a repo / no git).
 */
export async function changedFilesSince(repoPath: string, ref: string): Promise<string[] | null> {
  const out = await runGit(repoPath, ["diff", "--name-only", ref]);
  const tracked = parsePaths(out);
  if (tracked === null) return null;
  const untracked = parsePaths(
    await runGit(repoPath, ["ls-files", "--others", "--exclude-standard"]),
  );
  return dedupe([...tracked, ...(untracked ?? [])]);
}

function dedupe(paths: string[]): string[] {
  return [...new Set(paths)].sort((a, b) => a.localeCompare(b));
}
