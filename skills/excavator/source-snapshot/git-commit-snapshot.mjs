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

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { contentHash, manifestDigest, diffEntries } from './manifest.mjs';
import {
  ignoreRulesFromContent,
  selectionLedger,
  selectionPrefixBytes,
} from './ignore-rules.mjs';
import { listTrackedEntries, showFileAt, showFilePrefixAt } from './git-utils.mjs';

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
    this._selectionDescriptors = rules.descriptors;
    this.selectionDigest = rules.digest;

    const decisions = [];
    this._trackedPaths = [];
    this.processingSkips = [];
    for (const entry of listTrackedEntries(root, sha).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
      const { path } = entry;
      const initial = rules.policy.decide({ path });
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
      const mayNeedHeader = initial.kind !== 'sensitive'
        && !(initial.kind === 'filtered-by-defaults' && ['analysis-data', 'archive'].includes(initial.detail));
      const prefix = mayNeedHeader
        ? showFilePrefixAt(root, sha, path, selectionPrefixBytes) ?? undefined
        : undefined;
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
    const results = [];
    for (const path of this._trackedPaths) {
      const bytes = this.readFile(path);
      if (bytes.includes(0)) continue;
      const lines = bytes.toString('utf-8').split('\n');
      for (let index = 0; index < lines.length; index++) {
        for (const term of terms) {
          if (lines[index].includes(term)) {
            results.push({ path, line: index + 1, text: lines[index], term });
          }
        }
      }
    }
    return results;
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
   * Write only selected paths from the fixed commit into a fresh directory.
   * Rejected paths are never requested from git and therefore never cross the
   * materialization boundary, even transiently.
   *
   * @returns {{ dir: string, cleanup: () => void }}
   */
  materialize() {
    const dest = mkdtempSync(join(tmpdir(), 'excavator-snapshot-git-'));
    for (const path of this._trackedPaths) {
      const bytes = this.readFile(path);
      const destination = join(dest, path);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, bytes);
    }
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
