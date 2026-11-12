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

import { isUtf8 } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
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
  return listTrackedEntries(dir, sha).map((entry) => entry.path);
}

/** A path whose bytes are not valid UTF-8, with `%` and every byte from 0x80
 *  up written as `%XX`. Directory and extension rules still see its shape;
 *  git's own `\351` quoting would not survive, because the selection policy
 *  rewrites `\` to `/`. Since `%` itself is encoded, two such paths never
 *  become the same string; a clash with a valid path is refused below. */
function percentEncodePathBytes(bytes) {
  let out = '';
  for (const byte of bytes) {
    out += byte >= 0x80 || byte === 0x25 ? `%${byte.toString(16).toUpperCase()}` : String.fromCharCode(byte);
  }
  return out;
}

/** Throw when a path that is not valid UTF-8 shares a name with a valid path:
 *  under its percent-encoded form, or under the U+FFFD form that `git log`
 *  and `git diff` output read as UTF-8 give it, where its history and
 *  deletions would be credited to the valid file. */
function refuseNameClashes(entries, lossyPaths, sha, dir) {
  const validPaths = new Set(entries.filter((entry) => !entry.pathNotUtf8).map((entry) => entry.path));
  for (const [path, lossyPath] of lossyPaths) {
    if (validPaths.has(lossyPath)) {
      throw new Error(`git ls-tree for ${sha} in ${dir}: ${path} is not valid UTF-8 and decodes with U+FFFD to the valid path ${lossyPath}, so git output read as UTF-8 cannot tell the two apart`);
    }
    if (validPaths.has(path)) {
      throw new Error(`git ls-tree for ${sha} in ${dir}: ${path} is not valid UTF-8 and its percent-encoded name is also a valid path`);
    }
  }
}

/** Fixed-tree entries with Git mode preserved so symlinks never become
 * regular files when a snapshot is materialized path-by-path. The output is
 * read as bytes: a path that is valid UTF-8 decodes exactly as decoding the
 * whole output did, and one that is not gets its percent-encoded form plus
 * `pathNotUtf8: true`, since no string names it to `git show <sha>:<path>`. */
export function listTrackedEntries(dir, sha) {
  const result = run(['ls-tree', '-r', '-z', sha], dir);
  if (result.status !== 0) {
    throw new Error(`git ls-tree failed for ${sha} in ${dir}: ${result.stderr?.toString('utf-8') || result.status}`);
  }
  const stdout = result.stdout;
  const entries = [];
  const lossyPaths = new Map(); // percent-encoded path -> its U+FFFD decoding
  for (let start = 0; start < stdout.length;) {
    const nul = stdout.indexOf(0, start);
    const end = nul === -1 ? stdout.length : nul;
    const record = stdout.subarray(start, end);
    start = end + 1;
    if (record.length === 0) continue;
    const tab = record.indexOf(0x09);
    const match = tab === -1 ? null : record.subarray(0, tab).toString('utf-8').match(/^(\d+)\s+(\S+)\s+([0-9a-f]+)$/);
    const pathBytes = record.subarray(tab + 1);
    if (!match || pathBytes.length === 0) throw new Error(`git ls-tree returned an invalid entry for ${sha} in ${dir}`);
    const [, mode, type, oid] = match;
    if (isUtf8(pathBytes)) {
      entries.push({ mode, type, oid, path: pathBytes.toString('utf-8') });
    } else {
      const path = percentEncodePathBytes(pathBytes);
      entries.push({ mode, type, oid, path, pathNotUtf8: true });
      lossyPaths.set(path, pathBytes.toString('utf-8'));
    }
  }
  refuseNameClashes(entries, lossyPaths, sha, dir);
  return entries;
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
