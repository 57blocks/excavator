/**
 * directory-snapshot.mjs
 *
 * SourceSnapshot adapter for a plain, non-git directory (design D2/D3/D7).
 * `revision` is `directory:<sha256 over the sorted {path,contentHash}
 * manifest>` — the only adapter whose revision is a function of file
 * CONTENT rather than a git commit, which is exactly why it is the only one
 * that needs the consistency guard: nothing stops the directory from
 * changing out from under an in-flight analysis run.
 *
 * `.excavator/` is always excluded (never `git init`, never auto-committed).
 */

import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, sep } from 'node:path';

import { contentHash, manifestDigest, diffEntries } from './manifest.mjs';
import { ignoreRulesFromDisk } from './ignore-rules.mjs';

/** Directory names never worth descending into — a pure walk-time
 *  optimization; the ignore filter would exclude their content anyway. */
const HARD_SKIP_DIRS = new Set(['node_modules', '.git', '.svn', '.hg', '__pycache__']);

function toPosix(p) {
  return p.split(sep).join('/');
}

function compareStableStrings(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Recursively list every regular file under `root`, project-relative POSIX,
 *  not yet filtered. Symlinks are never followed (same rationale as
 *  scan-project.mjs: avoids recursion bombs and repo-external reads). */
function walk(root) {
  const out = [];
  function step(absDir, relDir) {
    let entries;
    try {
      entries = readdirSync(absDir, { withFileTypes: true });
    } catch (err) {
      process.stderr.write(`Warning: DirectorySnapshot: ${relDir || '.'} — directory read failed (${err.message}) — subtree skipped\n`);
      return;
    }
    entries.sort((a, b) => compareStableStrings(a.name, b.name));
    for (const ent of entries) {
      const relPath = relDir ? `${relDir}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        if (HARD_SKIP_DIRS.has(ent.name)) continue;
        step(join(absDir, ent.name), relPath);
      } else if (ent.isFile()) {
        out.push(relPath);
      }
      // Symlinks intentionally skipped — never followed.
    }
  }
  step(root, '');
  return out;
}

/** Build the `{path, contentHash}` manifest entries for `root` under the
 *  effective ignore filter. Per-file read failures are skipped with a
 *  warning (never crash the whole snapshot over one unreadable file). */
function buildEntries(root, filter) {
  const entries = [];
  for (const relPath of walk(root).sort(compareStableStrings)) {
    if (filter.isIgnored(relPath)) continue;
    let stat;
    try {
      stat = lstatSync(join(root, relPath));
    } catch (err) {
      process.stderr.write(`Warning: DirectorySnapshot: ${relPath} — lstat failed (${err.message}) — file skipped\n`);
      continue;
    }
    if (stat.isSymbolicLink()) continue;
    let buf;
    try {
      buf = readFileSync(join(root, relPath));
    } catch (err) {
      process.stderr.write(`Warning: DirectorySnapshot: ${relPath} — read failed (${err.message}) — file skipped\n`);
      continue;
    }
    entries.push({ path: relPath, contentHash: contentHash(buf) });
  }
  return entries;
}

export class DirectorySnapshot {
  /**
   * @param {string} root absolute path to a real, non-git directory
   * @param {{ extraExcludePatterns?: string[] }} [options]
   */
  constructor(root, options = {}) {
    this.kind = 'directory';
    this.root = root;
    this._extraExcludePatterns = options.extraExcludePatterns ?? [];

    const rules = ignoreRulesFromDisk(root, this._extraExcludePatterns);
    this._filter = rules.filter;
    this.selectionDigest = rules.digest;

    this._entries = buildEntries(root, this._filter);
    this._entriesByPath = new Map(this._entries.map((e) => [e.path, e]));
    this.revision = `directory:${manifestDigest(this._entries)}`;
  }

  listFiles() {
    return this._entries.map((e) => e.path);
  }

  /**
   * Read one file's current content, verifying it still matches the hash
   * captured when this snapshot was constructed (D7's "read-time check").
   * Throws — never returns silently stale-looking content — on a hash
   * mismatch, a path outside this snapshot's listing, or a file that has
   * since disappeared.
   *
   * @param {string} path
   * @returns {Buffer}
   */
  readFile(path) {
    const entry = this._entriesByPath.get(path);
    if (!entry) {
      throw new Error(`DirectorySnapshot.readFile: ${path} is not part of this snapshot (${this.revision})`);
    }
    let buf;
    try {
      buf = readFileSync(join(this.root, path));
    } catch (err) {
      throw new Error(`DirectorySnapshot.readFile: ${path} could not be read (${err.message}) — source changed since the snapshot was resolved`);
    }
    const currentHash = contentHash(buf);
    if (currentHash !== entry.contentHash) {
      throw new Error(`DirectorySnapshot.readFile: ${path} content hash mismatch — source changed since the snapshot was resolved (revision ${this.revision})`);
    }
    return buf;
  }

  /** @param {string[]} terms @returns {Array<{path:string, line:number, text:string, term:string}>} */
  search(terms) {
    const results = [];
    for (const { path } of this._entries) {
      let buf;
      try {
        buf = this.readFile(path);
      } catch {
        continue; // drifted/unreadable during search — omit, don't abort the whole search.
      }
      if (buf.includes(0)) continue; // best-effort binary skip (a NUL byte anywhere in the buffer).
      const text = buf.toString('utf-8');
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        for (const term of terms) {
          if (lines[i].includes(term)) results.push({ path, line: i + 1, text: lines[i], term });
        }
      }
    }
    return results;
  }

  /** The `{path, contentHash}` entries this snapshot's revision was computed
   *  from — reused by `diff()` and by MultiRepoSnapshot for its parent
   *  (non-member) source. */
  entries() {
    return this._entries;
  }

  /** @param {{entries?: Array<{path:string,contentHash:string}>}} previousManifest */
  diff(previousManifest) {
    return diffEntries(previousManifest?.entries ?? [], this._entries);
  }

  /**
   * Copy this snapshot's current content into a fresh temp directory,
   * re-verifying each file's hash as it is copied (D7's read-time check).
   * A file that has changed or vanished since construction is recorded in
   * `driftedPaths` and simply not copied — the caller (`runGuarded`) decides
   * what to do with a drifted materialization; this method never throws for
   * that reason alone.
   *
   * @returns {{ dir: string, drifted: boolean, driftedPaths: string[], cleanup: () => void }}
   */
  materialize() {
    const dest = mkdtempSync(join(tmpdir(), 'excavator-snapshot-dir-'));
    const driftedPaths = [];
    for (const { path } of this._entries) {
      let buf;
      try {
        buf = this.readFile(path);
      } catch {
        driftedPaths.push(path);
        continue;
      }
      const destPath = join(dest, path);
      mkdirSync(dirname(destPath), { recursive: true });
      writeFileSync(destPath, buf);
    }
    return {
      dir: dest,
      drifted: driftedPaths.length > 0,
      driftedPaths,
      cleanup: () => rmSync(dest, { recursive: true, force: true }),
    };
  }

  /**
   * Run `producer(materializedDir, snapshot)` under the D7 consistency
   * guard, then `publish(product, snapshot)` — but ONLY if nothing about
   * `root` changed for the whole duration of `producer`:
   *
   *   1. materialize() (itself verifies each copied file's hash).
   *   2. if materialize already saw drift, skip straight to retry/fail
   *      (no point running the full producer against known-stale content).
   *   3. otherwise run `producer`, then re-resolve a FRESH DirectorySnapshot
   *      over the same root and compare its revision to the one captured
   *      before `producer` ran.
   *   4. unchanged -> call `publish(product, snapshot)`, return { ok: true }.
   *   5. changed -> discard the product (never call publish), retry once
   *      against the fresh snapshot.
   *   6. still changed on the retry -> return { ok: false, reason } WITHOUT
   *      ever calling publish — the caller keeps whatever it already had
   *      (old graph/revision) and must surface this as a visible failure.
   *
   * @param {(materializedDir: string, snapshot: DirectorySnapshot) => Promise<any>|any} producer
   * @param {(product: any, snapshot: DirectorySnapshot) => Promise<void>|void} publish
   * @returns {Promise<{ ok: boolean, attempts: number, product?: any, revision?: string, reason?: string }>}
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
            reason: `source changed while materializing (drift on: ${materialized.driftedPaths.join(', ')})`,
          };
        }
        snapshot = new DirectorySnapshot(snapshot.root, { extraExcludePatterns: snapshot._extraExcludePatterns });
        continue;
      }

      let product;
      try {
        product = await producer(materialized.dir, snapshot);
      } finally {
        materialized.cleanup();
      }

      const fresh = new DirectorySnapshot(snapshot.root, { extraExcludePatterns: snapshot._extraExcludePatterns });
      if (fresh.revision === snapshot.revision) {
        await publish(product, snapshot);
        return { ok: true, attempts: attempt, product, revision: snapshot.revision };
      }
      if (attempt === MAX_ATTEMPTS) {
        return {
          ok: false,
          attempts: attempt,
          reason: `source directory changed during analysis (consistency guard failed after ${attempt} attempt(s))`,
        };
      }
      snapshot = fresh;
    }
    // Unreachable — MAX_ATTEMPTS >= 1 and every branch above returns.
    throw new Error('DirectorySnapshot.runGuarded: exhausted attempts without returning');
  }
}
