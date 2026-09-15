/**
 * git-commit-snapshot.mjs
 *
 * SourceSnapshot adapter for a git repository, HEAD-only (design D2/D3).
 * `revision` is `git:<full-head-sha>`. Every read goes through `git show`/
 * `git ls-tree`/`git grep` AT that fixed sha — staged, unstaged and
 * untracked content is never consulted, so a dirty working tree cannot
 * change what gets analyzed as long as HEAD itself does not move.
 *
 * No consistency guard is needed here (unlike DirectorySnapshot): a single
 * `sha` names an immutable tree forever; nothing can drift out from under an
 * in-flight analysis run within one process invocation.
 */

import { mkdtempSync, rmSync, readdirSync, rmSync as rmPath } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { contentHash, manifestDigest, diffEntries } from './manifest.mjs';
import { ignoreRulesFromContent } from './ignore-rules.mjs';
import { listTrackedFiles, showFileAt, grepAt, archiveToDir } from './git-utils.mjs';

const EXCAVATORIGNORE_PATH = '.excavatorignore';

export class GitCommitSnapshot {
  /**
   * @param {string} root absolute path to the repo's working-tree root
   * @param {string} sha full HEAD commit sha, already resolved by the caller
   * @param {{ extraExcludePatterns?: string[] }} [options]
   */
  constructor(root, sha, options = {}) {
    this.kind = 'git';
    this.root = root;
    this.sha = sha;
    this.revision = `git:${sha}`;
    this._extraExcludePatterns = options.extraExcludePatterns ?? [];

    const ignoreFileBuf = showFileAt(root, sha, EXCAVATORIGNORE_PATH);
    const rules = ignoreRulesFromContent(
      ignoreFileBuf ? ignoreFileBuf.toString('utf-8') : null,
      this._extraExcludePatterns,
    );
    this._filter = rules.filter;
    this.selectionDigest = rules.digest;

    this._trackedPaths = listTrackedFiles(root, sha).filter((p) => !this._filter.isIgnored(p));
    this._trackedPaths.sort();
  }

  /** Terminal notice required by the "HEAD-only" contract — printed by
   *  `resolveSourceSnapshot` when this becomes the top-level snapshot. */
  get noticeLine() {
    return `Analyzing git:${this.sha.slice(0, 7)}; uncommitted changes ignored`;
  }

  listFiles() {
    return [...this._trackedPaths];
  }

  /** @param {string} path @returns {Buffer} */
  readFile(path) {
    if (!this._trackedPaths.includes(path)) {
      throw new Error(`GitCommitSnapshot.readFile: ${path} is not part of this snapshot (${this.revision})`);
    }
    const buf = showFileAt(this.root, this.sha, path);
    if (buf === null) {
      throw new Error(`GitCommitSnapshot.readFile: ${path} not found at ${this.revision}`);
    }
    return buf;
  }

  /** @param {string[]} terms */
  search(terms) {
    const tracked = new Set(this._trackedPaths);
    return grepAt(this.root, this.sha, terms).filter((r) => tracked.has(r.path));
  }

  /** The `{path, contentHash}` entries for this revision, computed on
   *  demand (not needed for `revision`/`listFiles`, only for `diff()`). */
  entries() {
    return this._trackedPaths.map((path) => ({ path, contentHash: contentHash(this.readFile(path)) }));
  }

  /** @param {{entries?: Array<{path:string,contentHash:string}>}} previousManifest */
  diff(previousManifest) {
    return diffEntries(previousManifest?.entries ?? [], this.entries());
  }

  /**
   * `git archive <sha> | tar -x` into a fresh temp directory — HEAD-only by
   * construction, no staged/unstaged/untracked content can appear. Ignored
   * paths (selection rules) are removed by simply never asking for them:
   * the archive itself is filtered down to `this._trackedPaths` by
   * re-extracting only into paths this snapshot lists... in practice it is
   * simplest and still correct to archive the WHOLE tree and then delete
   * ignored paths that made it in, so that is what happens here.
   *
   * @returns {{ dir: string, cleanup: () => void }}
   */
  materialize() {
    const dest = mkdtempSync(join(tmpdir(), 'excavator-snapshot-git-'));
    archiveToDir(this.root, this.sha, dest);
    pruneToTracked(dest, this._trackedPaths);
    return { dir: dest, cleanup: () => rmSync(dest, { recursive: true, force: true }) };
  }

  /**
   * No drift is possible for a fixed sha, so this is a trivial one-shot
   * wrapper: materialize, run `producer`, then unconditionally `publish`.
   * Kept the same shape as `DirectorySnapshot.runGuarded` so callers (e.g.
   * lazy-analyze.mjs) can treat every adapter kind identically.
   *
   * @param {(materializedDir: string, snapshot: GitCommitSnapshot) => Promise<any>|any} producer
   * @param {(product: any, snapshot: GitCommitSnapshot) => Promise<void>|void} publish
   */
  async runGuarded(producer, publish) {
    const materialized = this.materialize();
    let product;
    try {
      product = await producer(materialized.dir, this);
    } finally {
      materialized.cleanup();
    }
    await publish(product, this);
    return { ok: true, attempts: 1, product, revision: this.revision };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Remove from `dir` (recursively) any file whose project-relative POSIX
 *  path is not in `keepPaths`, and any directory left empty as a result.
 *  Used because `git archive` has no per-path exclude flag we can drive
 *  from an arbitrary `IgnoreFilter`. */
function pruneToTracked(dir, keepPaths) {
  const keep = new Set(keepPaths);
  function walk(absDir, relDir) {
    let entries;
    try {
      entries = readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const relPath = relDir ? `${relDir}/${ent.name}` : ent.name;
      const absPath = join(absDir, ent.name);
      if (ent.isDirectory()) {
        walk(absPath, relPath);
        try {
          if (readdirSync(absPath).length === 0) rmPath(absPath, { recursive: true, force: true });
        } catch {
          // ignore — best-effort cleanup of now-empty directories.
        }
      } else if (ent.isFile() && !keep.has(relPath)) {
        rmPath(absPath, { force: true });
      }
    }
  }
  walk(dir, '');
}
