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

/** Fixed-tree entries with Git mode preserved so symlinks never become
 * regular files when a snapshot is materialized path-by-path. */
export function listTrackedEntries(dir, sha) {
  const result = run(['ls-tree', '-r', '-z', sha], dir, { encoding: 'utf-8' });
  if (result.status !== 0) {
    throw new Error(`git ls-tree failed for ${sha} in ${dir}: ${result.stderr || result.status}`);
  }
  return result.stdout.split('\0').filter(Boolean).map((record) => {
    const match = record.match(/^(\d+)\s+(\S+)\s+([0-9a-f]+)\t([\s\S]+)$/);
    if (!match) throw new Error(`git ls-tree returned an invalid entry for ${sha} in ${dir}`);
    return { mode: match[1], type: match[2], oid: match[3], path: match[4] };
  });
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
 * Read at most `maxBytes` from one committed blob. A short-lived helper owns
 * the streaming git process and stops it once the prefix is full, so the
 * caller never materializes or buffers the rest of a potentially sensitive
 * blob merely to inspect its header.
 */
export function showFilePrefixAt(dir, sha, path, maxBytes) {
  const helper = String.raw`
const { spawn } = require('node:child_process');
const [cwd, spec, rawLimit] = process.argv.slice(1);
const limit = Number(rawLimit);
const child = spawn('git', ['show', '--no-textconv', spec], { cwd, stdio: ['ignore', 'pipe', 'ignore'] });
const chunks = [];
let remaining = limit;
let settled = false;
function finish(code) {
  if (settled) return;
  settled = true;
  if (code !== 0) process.exit(code);
  process.stdout.write(Buffer.concat(chunks), () => process.exit(0));
}
child.on('error', () => finish(2));
child.stdout.on('readable', () => {
  while (remaining > 0) {
    const chunk = child.stdout.read(remaining);
    if (chunk === null) break;
    chunks.push(chunk);
    remaining -= chunk.length;
  }
  if (remaining === 0) {
    child.kill();
    finish(0);
  }
});
child.on('close', (code) => finish(code === 0 ? 0 : 2));
`;
  const result = spawnSync(
    process.execPath,
    ['-e', helper, dir, `${sha}:${path}`, String(maxBytes)],
    { maxBuffer: maxBytes + 1024 },
  );
  if (result.status !== 0) return null;
  return result.stdout;
}
