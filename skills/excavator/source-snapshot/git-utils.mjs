/**
 * git-utils.mjs
 *
 * Low-level git plumbing shared by GitCommitSnapshot (a repo root) and
 * MultiRepoSnapshot (each member repo). Every function here is a thin,
 * read-only wrapper around a single `git` invocation — no working-tree
 * mutation, no `git init`, no commits. All of it operates against a fixed
 * revision (HEAD by default via the caller passing an already-resolved sha),
 * never the working tree, so staged/unstaged/untracked content never leaks
 * through these functions.
 */

import { spawnSync } from 'node:child_process';
import { realpathSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const MAX_BUFFER = 1024 * 1024 * 1024; // 1GB — matches the ceiling other bundled scripts use for big repos.

function run(args, cwd, opts = {}) {
  return spawnSync('git', args, { cwd, maxBuffer: MAX_BUFFER, ...opts });
}

/** Resolve a directory's realpath, or return it unchanged if it doesn't (yet) exist. */
function safeRealpath(dir) {
  try {
    return realpathSync(dir);
  } catch {
    return resolve(dir);
  }
}

/**
 * True when `dir` is itself the ROOT of a git working tree (not merely
 * nested inside one). Checked via presence of `.git` directly inside `dir`
 * (dir or file — worktrees/submodules use a `.git` file) AND git agreeing
 * that `dir`'s toplevel is `dir` itself, so a plain subdirectory of some
 * unrelated ANCESTOR repository is never mistaken for a repo root.
 *
 * @param {string} dir
 * @returns {boolean}
 */
export function isGitRepoRoot(dir) {
  const toplevel = run(['rev-parse', '--show-toplevel'], dir, { encoding: 'utf-8' });
  if (toplevel.status !== 0 || !toplevel.stdout) return false;
  const reportedRoot = safeRealpath(toplevel.stdout.trim());
  return reportedRoot === safeRealpath(dir);
}

/**
 * Full HEAD commit sha for the repo rooted at `dir`, or null when there is
 * no HEAD to resolve (not a repo, or a repo with zero commits — "unborn
 * HEAD"). Never reads the index or working tree.
 *
 * @param {string} dir
 * @returns {string|null}
 */
export function headSha(dir) {
  const result = run(['rev-parse', 'HEAD'], dir, { encoding: 'utf-8' });
  if (result.status !== 0) return null;
  const sha = result.stdout.trim();
  return sha.length > 0 ? sha : null;
}

/**
 * Every path git tracks at `sha`, project-relative POSIX, NUL-terminated
 * output so no byte of a path is ever lossy (mirrors scan-project.mjs's own
 * `-z` use of `git ls-files` for the same reason).
 *
 * @param {string} dir
 * @param {string} sha
 * @returns {string[]}
 */
export function listTrackedFiles(dir, sha) {
  const result = run(['ls-tree', '-r', '-z', '--name-only', sha], dir, { encoding: 'utf-8' });
  if (result.status !== 0) {
    throw new Error(`git ls-tree failed for ${sha} in ${dir}: ${result.stderr || result.status}`);
  }
  return result.stdout.split('\0').filter(Boolean);
}

/**
 * Read one path's raw bytes as committed at `sha`, or null if that path does
 * not exist at that revision. Encoding is left unset (raw Buffer) so binary
 * content round-trips exactly.
 *
 * @param {string} dir
 * @param {string} sha
 * @param {string} path project-relative POSIX path
 * @returns {Buffer|null}
 */
export function showFileAt(dir, sha, path) {
  const result = run(['show', `${sha}:${path}`], dir);
  if (result.status !== 0) return null;
  return result.stdout;
}

/**
 * Fixed-string, line-numbered search over the tree at `sha` for each term in
 * `terms`. Best-effort per term: a term git can't search (or that matches
 * nothing — git grep exits 1 for "no matches", which is not an error) never
 * aborts the whole search.
 *
 * @param {string} dir
 * @param {string} sha
 * @param {string[]} terms
 * @returns {Array<{path: string, line: number, text: string, term: string}>}
 */
export function grepAt(dir, sha, terms) {
  const results = [];
  for (const term of terms) {
    const result = run(['grep', '-n', '-I', '--fixed-strings', '-e', term, sha], dir, { encoding: 'utf-8' });
    if (result.status !== 0 && result.status !== 1) continue; // real error on this term — skip, keep going.
    if (!result.stdout) continue;
    for (const line of result.stdout.split('\n')) {
      if (!line) continue;
      // `git grep <rev>` output: "<rev>:<path>:<lineno>:<text>"
      const match = line.match(/^[^:]+:([^:]+):(\d+):(.*)$/);
      if (match) results.push({ path: match[1], line: Number(match[2]), text: match[3], term });
    }
  }
  return results;
}

/**
 * Materialize the tree at `sha` into `destDir` via `git archive | tar -x`
 * (plan-approved: build-free, read-only against the source repo). `destDir`
 * is created if needed; existing content is not cleared (callers pass a
 * fresh mkdtemp'd directory).
 *
 * @param {string} repoDir
 * @param {string} sha
 * @param {string} destDir
 */
export function archiveToDir(repoDir, sha, destDir) {
  mkdirSync(destDir, { recursive: true });
  const archive = spawnSync('git', ['archive', sha], { cwd: repoDir, maxBuffer: MAX_BUFFER });
  if (archive.status !== 0) {
    throw new Error(`git archive failed for ${sha} in ${repoDir}: ${archive.stderr?.toString('utf-8') || archive.status}`);
  }
  const extract = spawnSync('tar', ['-x', '-C', destDir], { input: archive.stdout, maxBuffer: MAX_BUFFER });
  if (extract.status !== 0) {
    throw new Error(`tar extraction failed into ${destDir}: ${extract.stderr?.toString('utf-8') || extract.status}`);
  }
}
