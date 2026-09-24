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

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as realBatchReader from './blob-batch.mjs';
import { diffEntries } from './manifest.mjs';
import {
  ignoreRulesFromContent,
  selectionLedger,
  selectionPrefixBytes,
} from './ignore-rules.mjs';
import { listTrackedEntries, showFileAt } from './git-utils.mjs';

const EXCAVATORIGNORE_PATH = '.excavatorignore';

export class GitCommitSnapshot {
  /**
   * @param {string} root absolute path to the repo's working-tree root
   * @param {string} sha full HEAD commit sha, already resolved by the caller
   * @param {{ extraExcludePatterns?: string[], batchReader?: typeof realBatchReader }} [options]
   *   `batchReader` defaults to the real `blob-batch.mjs` module; tests inject
   *   a spy/fake to observe exactly which paths reach each batch (design D3).
   */
  constructor(root, sha, options = {}) {
    this.kind = 'git';
    this.root = root;
    this.sha = sha;
    this.revision = `git:${sha}`;
    this._extraExcludePatterns = options.extraExcludePatterns ?? [];
    this._batchReader = options.batchReader ?? realBatchReader;

    const ignoreFileBuf = showFileAt(root, sha, EXCAVATORIGNORE_PATH);
    const rules = ignoreRulesFromContent(
      ignoreFileBuf ? ignoreFileBuf.toString('utf-8') : null,
      this._extraExcludePatterns,
    );
    this._selectionDescriptors = rules.descriptors;
    this.selectionDigest = rules.digest;

    const entries = listTrackedEntries(root, sha).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    this._oidByPath = new Map(entries.map((entry) => [entry.path, entry.oid]));

    // D3: compute each entry's initial decision and whether its header is
    // needed FIRST, fetch every needed header in batches (one `git cat-file
    // --batch` per BLOB_BATCH_SIZE headers, not one subprocess per file),
    // and only THEN run the decision loop below in the original order and
    // branches — batching only changes how a header's bytes are fetched,
    // never the decision logic itself.
    const preDecided = entries.map((entry) => {
      const initial = rules.policy.decide({ path: entry.path });
      const mayNeedHeader = entry.mode !== '120000'
        && entry.type === 'blob'
        && initial.kind !== 'sensitive'
        && !(initial.kind === 'filtered-by-defaults' && ['analysis-data', 'archive'].includes(initial.detail));
      return { entry, initial, mayNeedHeader };
    });
    const headerWantList = preDecided
      .filter((item) => item.mayNeedHeader)
      .map((item) => ({ oid: item.entry.oid, path: item.entry.path }));
    const prefixes = this._batchReader.readBlobPrefixes(root, headerWantList, selectionPrefixBytes);
    const prefixByPath = new Map(headerWantList.map((item, i) => [item.path, prefixes[i]]));

    const decisions = [];
    this._trackedPaths = [];
    this.processingSkips = [];
    for (const { entry, initial, mayNeedHeader } of preDecided) {
      const { path } = entry;
      if (entry.mode === '120000') {
        decisions.push(initial);
        if (initial.kind === 'selected') this.processingSkips.push({ path, reason: 'symlink' });
        continue;
      }
      if (entry.type !== 'blob') {
        decisions.push(initial);
        if (initial.kind === 'selected') this.processingSkips.push({ path, reason: 'read-failed' });
        continue;
      }
      const prefix = mayNeedHeader ? prefixByPath.get(path) ?? undefined : undefined;
      const decision = mayNeedHeader && prefix !== undefined
        ? rules.policy.decide({ path, contentPrefix: prefix })
        : initial;
      decisions.push(decision);
      if (decision.kind === 'selected') {
        if (mayNeedHeader && prefix === undefined) this.processingSkips.push({ path, reason: 'read-failed' });
        else this._trackedPaths.push(path);
      }
    }
    this.selection = selectionLedger(decisions);
    this._trackedPathSet = new Set(this._trackedPaths);
  }

  /** `{oid, path}` items for `paths`, in the given order, for a batch call. */
  _batchItems(paths) {
    return paths.map((path) => ({ oid: this._oidByPath.get(path), path }));
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
    if (!this._trackedPathSet.has(path)) {
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
    // Batch only the selected paths — a rejected path's content is never
    // requested from git, matching readFile()'s per-file behavior before
    // this change.
    return this._batchReader.searchBlobs(this.root, this._batchItems(this._trackedPaths), terms);
  }

  /** The `{path, contentHash}` entries for this revision, computed on
   *  demand (not needed for `revision`/`listFiles`, only for `diff()`). */
  entries() {
    const hashes = this._batchReader.hashBlobs(this.root, this._batchItems(this._trackedPaths));
    return this._trackedPaths.map((path, i) => ({ path, contentHash: hashes[i] }));
  }

  /** @param {{entries?: Array<{path:string,contentHash:string}>}} previousManifest */
  diff(previousManifest) {
    return diffEntries(previousManifest?.entries ?? [], this.entries());
  }

  /**
   * Write only selected paths from the fixed commit into a fresh directory.
   * Rejected paths are never requested from git and therefore never cross the
   * materialization boundary, even transiently.
   *
   * @returns {{ dir: string, cleanup: () => void }}
   */
  materialize() {
    const dest = mkdtempSync(join(tmpdir(), 'excavator-snapshot-git-'));
    this._batchReader.writeBlobs(this.root, this._batchItems(this._trackedPaths), dest);
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
