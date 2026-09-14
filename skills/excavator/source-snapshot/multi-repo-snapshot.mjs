/**
 * multi-repo-snapshot.mjs
 *
 * SourceSnapshot adapter for a parent directory that is NOT itself a git
 * repository but contains one or more member git repositories (design
 * D2/D3). `revision` is `multi-repo:<sha256(sorted member-relative-path +
 * member HEAD)>` — a fixed formula that intentionally does NOT fold parent
 * (non-member) file content into the revision string; parent content still
 * flows into the analysis (and therefore into `factsDigest`) via
 * materialize(), it just isn't part of what makes this adapter's `revision`
 * change. See the source-snapshot proposal's Why for why `revision` is
 * scoped this way.
 *
 * Each member is read as a GitCommitSnapshot (HEAD-only, working tree
 * ignored). Parent non-member source is read as a DirectorySnapshot with
 * every member directory carved out via an ignore pattern, so the parent's
 * own consistency guard only ever concerns itself with genuinely
 * non-member content.
 */

import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { memberListDigest, diffEntries } from './manifest.mjs';
import { ignoreRulesFromDisk } from './ignore-rules.mjs';
import { isGitRepoRoot, headSha } from './git-utils.mjs';
import { GitCommitSnapshot } from './git-commit-snapshot.mjs';
import { DirectorySnapshot } from './directory-snapshot.mjs';

/**
 * Detect member git repositories directly under `root` (one level deep —
 * the shape every known multi-repo workspace in this project's corpus uses;
 * deeper nesting is not detected). `root` itself must already be known NOT
 * to be a git repo (checked by the caller, `resolveSourceSnapshot`) — D2's
 * detection order gives GitCommitSnapshot priority.
 *
 * A subdirectory with a `.git` entry but an unborn HEAD (zero commits) is
 * excluded and reported to stderr rather than silently dropped or treated
 * as a fatal error — the rest of the workspace is still analyzable.
 *
 * @param {string} root
 * @returns {Array<{id: string, dir: string, sha: string}>}
 */
export function findGitMembers(root) {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const members = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (ent.name === '.git' || ent.name === '.excavator') continue;
    const dir = join(root, ent.name);
    if (!existsSync(join(dir, '.git'))) continue;
    if (!isGitRepoRoot(dir)) continue;
    const sha = headSha(dir);
    if (sha === null) {
      process.stderr.write(
        `Warning: MultiRepoSnapshot: member "${ent.name}" has no commits (unborn HEAD) — excluded from analysis\n`,
      );
      continue;
    }
    members.push({ id: ent.name, dir, sha });
  }
  members.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return members;
}

export class MultiRepoSnapshot {
  /**
   * @param {string} root absolute path to the parent (non-git) directory
   * @param {Array<{id: string, dir: string, sha: string}>} members pre-detected via `findGitMembers`
   * @param {{ extraExcludePatterns?: string[] }} [options]
   */
  constructor(root, members, options = {}) {
    if (!members || members.length === 0) {
      throw new Error('MultiRepoSnapshot: at least one member repository is required');
    }
    this.kind = 'multi-repo';
    this.root = root;
    this.members = members;
    this._extraExcludePatterns = options.extraExcludePatterns ?? [];

    this.revision = `multi-repo:${memberListDigest(members.map((m) => ({ id: m.id, headSha: m.sha })))}`;
    // Parent's OWN effective ignore rules only (spec: "the parent's own effective ignore rules
    // SHALL enter selectionDigest") — member-directory carve-outs below are a
    // structural artifact of the adapter, not a user-configured rule, so they
    // deliberately do NOT feed this digest.
    this.selectionDigest = ignoreRulesFromDisk(root, this._extraExcludePatterns).digest;

    this._memberById = new Map(members.map((m) => [m.id, new GitCommitSnapshot(m.dir, m.sha, { extraExcludePatterns: this._extraExcludePatterns })]));
    this._parentSnapshot = new DirectorySnapshot(root, {
      extraExcludePatterns: [...this._extraExcludePatterns, ...members.map((m) => `${m.id}/`)],
    });
  }

  listFiles() {
    const files = [...this._parentSnapshot.listFiles()];
    for (const [id, member] of this._memberById) {
      for (const p of member.listFiles()) files.push(`${id}/${p}`);
    }
    return files.sort();
  }

  /** @param {string} path @returns {Buffer} */
  readFile(path) {
    const member = this._resolveMember(path);
    if (member) return member.snapshot.readFile(member.rest);
    return this._parentSnapshot.readFile(path);
  }

  /** @param {string[]} terms */
  search(terms) {
    const results = [...this._parentSnapshot.search(terms)];
    for (const [id, member] of this._memberById) {
      for (const r of member.search(terms)) results.push({ ...r, path: `${id}/${r.path}` });
    }
    return results;
  }

  entries() {
    const entries = [...this._parentSnapshot.entries()];
    for (const [id, member] of this._memberById) {
      for (const e of member.entries()) entries.push({ path: `${id}/${e.path}`, contentHash: e.contentHash });
    }
    return entries;
  }

  /** @param {{entries?: Array<{path:string,contentHash:string}>}} previousManifest */
  diff(previousManifest) {
    return diffEntries(previousManifest?.entries ?? [], this.entries());
  }

  /**
   * Lays out `temp/<memberId>/...` (each member's own `git archive HEAD`)
   * plus the parent's non-member files at the temp root.
   *
   * @returns {{ dir: string, drifted: boolean, driftedPaths: string[], cleanup: () => void }}
   */
  materialize() {
    const dest = mkdtempSync(join(tmpdir(), 'excavator-snapshot-multi-'));
    for (const [id, member] of this._memberById) {
      const memberMaterialized = member.materialize();
      const memberDest = join(dest, id);
      mkdirSync(memberDest, { recursive: true });
      cpSync(memberMaterialized.dir, memberDest, { recursive: true });
      memberMaterialized.cleanup();
    }
    const parentMaterialized = this._parentSnapshot.materialize();
    cpSync(parentMaterialized.dir, dest, { recursive: true });
    const drifted = parentMaterialized.drifted;
    const driftedPaths = parentMaterialized.driftedPaths;
    parentMaterialized.cleanup();
    return { dir: dest, drifted, driftedPaths, cleanup: () => rmSync(dest, { recursive: true, force: true }) };
  }

  /**
   * Members are fixed git trees (no drift possible within one run — see
   * GitCommitSnapshot's own rationale); only the parent's non-member
   * DirectorySnapshot content can drift, so the guard here re-checks only
   * `_parentSnapshot.revision` before publishing, retrying once on a parent
   * change and giving up (without ever calling `publish`) on a second one.
   *
   * @param {(materializedDir: string, snapshot: MultiRepoSnapshot) => Promise<any>|any} producer
   * @param {(product: any, snapshot: MultiRepoSnapshot) => Promise<void>|void} publish
   */
  async runGuarded(producer, publish) {
    let snapshot = this;
    const MAX_ATTEMPTS = 2;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const materialized = snapshot.materialize();

      if (materialized.drifted) {
        materialized.cleanup();
        if (attempt === MAX_ATTEMPTS) {
          return {
            ok: false,
            attempts: attempt,
            reason: `parent (non-member) source changed while materializing (drift on: ${materialized.driftedPaths.join(', ')})`,
          };
        }
        snapshot = new MultiRepoSnapshot(snapshot.root, snapshot.members, { extraExcludePatterns: snapshot._extraExcludePatterns });
        continue;
      }

      let product;
      try {
        product = await producer(materialized.dir, snapshot);
      } finally {
        materialized.cleanup();
      }

      const freshParentRevision = new DirectorySnapshot(snapshot.root, {
        extraExcludePatterns: [...snapshot._extraExcludePatterns, ...snapshot.members.map((m) => `${m.id}/`)],
      }).revision;
      if (freshParentRevision === snapshot._parentSnapshot.revision) {
        await publish(product, snapshot);
        return { ok: true, attempts: attempt, product, revision: snapshot.revision };
      }
      if (attempt === MAX_ATTEMPTS) {
        return {
          ok: false,
          attempts: attempt,
          reason: `parent (non-member) source changed during analysis (consistency guard failed after ${attempt} attempt(s))`,
        };
      }
      snapshot = new MultiRepoSnapshot(snapshot.root, snapshot.members, { extraExcludePatterns: snapshot._extraExcludePatterns });
    }
    throw new Error('MultiRepoSnapshot.runGuarded: exhausted attempts without returning');
  }

  /** @param {string} path @returns {{ id: string, snapshot: GitCommitSnapshot, rest: string }|null} */
  _resolveMember(path) {
    for (const [id, snapshot] of this._memberById) {
      const prefix = `${id}/`;
      if (path.startsWith(prefix)) return { id, snapshot, rest: path.slice(prefix.length) };
    }
    return null;
  }
}
