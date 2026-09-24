// SourceSnapshot / snapshot-resolve-performance — GitCommitSnapshot batch parity
// (openspec: changes/snapshot-resolve-performance, capability `source-snapshot`,
// design D3/D4, tasks 2.1/2.2).
//
// Purpose-built synthetic git fixture only (AGENTS.md: no real-project
// source). This file keeps an "old" reference implementation of
// GitCommitSnapshot's pre-batching semantics (per-file `git show` for every
// header AND every read), built ONLY from primitives this change left
// untouched (`showFileAt`, `listTrackedEntries`, `ignoreRulesFromContent`,
// `selectionLedger`, `selectionPrefixBytes`), and compares it against the
// real (now-batched) `GitCommitSnapshot` field by field. It also uses the
// constructor's injectable `batchReader` option to assert that no
// non-selected path ever reaches the hash/write/search batches (O3).
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';

import { GitCommitSnapshot } from '../../skills/excavator/source-snapshot/git-commit-snapshot.mjs';
import { listTrackedEntries, showFileAt } from '../../skills/excavator/source-snapshot/git-utils.mjs';
import { ignoreRulesFromContent, selectionLedger, selectionPrefixBytes } from '../../skills/excavator/source-snapshot/ignore-rules.mjs';
import * as realBatchReader from '../../skills/excavator/source-snapshot/blob-batch.mjs';

function git(root, args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: root, encoding: 'utf-8' });
}

function headSha(root) {
  return git(root, ['rev-parse', 'HEAD']).trim();
}

/**
 * The FAKE_KEY_CANARY marker below never leaves this synthetic fixture: it
 * is a made-up header string, not a real credential, and only exists to
 * prove the sensitive/header path still keeps it out of every read surface.
 */
function makeFixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), 'excavator-batch-parity-fixture-'));
  git(root, ['init', '-q']);
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'app.ts'), 'export const app = 1;\n');
  writeFileSync(join(root, 'README.md'), '# fixture\n');
  writeFileSync(join(root, 'secret.pem'), '-----BEGIN CERTIFICATE-----\nFAKE\n-----END CERTIFICATE-----\n');
  writeFileSync(join(root, 'header-secret.txt'), '-----BEGIN PRIVATE KEY-----\nFAKE_KEY_CANARY\n');
  writeFileSync(join(root, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])); // default-filtered by extension
  symlinkSync('src/app.ts', join(root, 'linked.ts'));
  git(root, ['add', '-A']);
  // A gitlink (submodule) tree entry: type "commit", never "blob" — the
  // cheapest way to get a real non-blob entry into `git ls-tree` without an
  // actual nested repository.
  git(root, ['update-index', '--add', '--cacheinfo', '160000,0000000000000000000000000000000000000001,gitlink/fake-submodule']);
  git(root, ['commit', '-q', '-m', 'batch-parity fixture']);
  return root;
}

function walkFiles(root) {
  const paths = [];
  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = join(current, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) paths.push(relative(root, absolute).split(sep).join('/'));
    }
  }
  walk(root);
  return paths.sort();
}

// --- "old" reference implementation: pre-batching semantics, built only
// from primitives this change left untouched. ---

function oldShowFilePrefixAt(root, sha, path, maxBytes) {
  const full = showFileAt(root, sha, path);
  if (full === null) return null;
  return full.subarray(0, maxBytes);
}

function oldResolve(root, sha) {
  const ignoreFileBuf = showFileAt(root, sha, '.excavatorignore');
  const rules = ignoreRulesFromContent(ignoreFileBuf ? ignoreFileBuf.toString('utf-8') : null, []);

  const decisions = [];
  const trackedPaths = [];
  const processingSkips = [];
  for (const entry of listTrackedEntries(root, sha).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    const { path } = entry;
    const initial = rules.policy.decide({ path });
    if (entry.mode === '120000') {
      decisions.push(initial);
      if (initial.kind === 'selected') processingSkips.push({ path, reason: 'symlink' });
      continue;
    }
    if (entry.type !== 'blob') {
      decisions.push(initial);
      if (initial.kind === 'selected') processingSkips.push({ path, reason: 'read-failed' });
      continue;
    }
    const mayNeedHeader = initial.kind !== 'sensitive'
      && !(initial.kind === 'filtered-by-defaults' && ['analysis-data', 'archive'].includes(initial.detail));
    const prefix = mayNeedHeader ? oldShowFilePrefixAt(root, sha, path, selectionPrefixBytes) ?? undefined : undefined;
    const decision = mayNeedHeader && prefix !== undefined
      ? rules.policy.decide({ path, contentPrefix: prefix })
      : initial;
    decisions.push(decision);
    if (decision.kind === 'selected') {
      if (mayNeedHeader && prefix === undefined) processingSkips.push({ path, reason: 'read-failed' });
      else trackedPaths.push(path);
    }
  }
  const selection = selectionLedger(decisions);
  return { selection, processingSkips, trackedPaths, selectionDigest: rules.digest };
}

function oldReadFile(root, sha, trackedPaths, path) {
  if (!trackedPaths.includes(path)) {
    throw new Error(`old readFile: ${path} is not part of this snapshot (git:${sha})`);
  }
  const buf = showFileAt(root, sha, path);
  if (buf === null) throw new Error(`old readFile: ${path} not found at git:${sha}`);
  return buf;
}

function oldEntries(root, sha, trackedPaths) {
  return trackedPaths.map((path) => {
    const bytes = oldReadFile(root, sha, trackedPaths, path);
    return { path, contentHash: createHash('sha256').update(bytes).digest('hex') };
  });
}

function oldMaterialize(root, sha, trackedPaths, dest) {
  for (const path of trackedPaths) {
    const bytes = oldReadFile(root, sha, trackedPaths, path);
    const destination = join(dest, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, bytes);
  }
}

function oldSearch(root, sha, trackedPaths, terms) {
  const results = [];
  for (const path of trackedPaths) {
    const bytes = oldReadFile(root, sha, trackedPaths, path);
    if (bytes.includes(0)) continue;
    const lines = bytes.toString('utf-8').split('\n');
    for (let index = 0; index < lines.length; index++) {
      for (const term of terms) {
        if (lines[index].includes(term)) results.push({ path, line: index + 1, text: lines[index], term });
      }
    }
  }
  return results;
}

let root;

beforeEach(() => {
  root = makeFixtureRoot();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('GitCommitSnapshot batch parity (design D4/O1/O2/O3)', () => {
  it('matches the old per-file reference on selection ledger, processingSkips, listFiles and selectionDigest', () => {
    const sha = headSha(root);
    const old = oldResolve(root, sha);
    const fresh = new GitCommitSnapshot(root, sha);

    expect(fresh.selection).toEqual(old.selection);
    expect(fresh.processingSkips).toEqual(old.processingSkips);
    expect(fresh.listFiles()).toEqual(old.trackedPaths);
    expect(fresh.selectionDigest).toBe(old.selectionDigest);

    // Sanity: the fixture actually exercises every bucket this test claims to.
    expect(fresh.processingSkips).toContainEqual({ path: 'linked.ts', reason: 'symlink' });
    expect(fresh.processingSkips).toContainEqual({ path: 'gitlink/fake-submodule', reason: 'read-failed' });
    expect(fresh.selection.sensitive).toBe(2); // secret.pem (extension) + header-secret.txt (header)
    expect(fresh.selection.filteredByDefaults).toBeGreaterThanOrEqual(1); // image.png
    expect(fresh.listFiles()).toEqual(expect.arrayContaining(['src/app.ts', 'README.md']));
    expect(fresh.listFiles()).not.toContain('secret.pem');
    expect(fresh.listFiles()).not.toContain('header-secret.txt');
  });

  it('matches the old reference on entries() (content hashes)', () => {
    const sha = headSha(root);
    const old = oldResolve(root, sha);
    const fresh = new GitCommitSnapshot(root, sha);

    const oldEntryList = oldEntries(root, sha, old.trackedPaths);
    expect(fresh.entries()).toEqual(oldEntryList);
  });

  it('matches the old reference on materialize() byte-for-byte, including the file set', () => {
    const sha = headSha(root);
    const old = oldResolve(root, sha);
    const fresh = new GitCommitSnapshot(root, sha);

    const oldDest = mkdtempSync(join(tmpdir(), 'excavator-batch-parity-old-mat-'));
    const materialized = fresh.materialize();
    try {
      oldMaterialize(root, sha, old.trackedPaths, oldDest);
      expect(walkFiles(materialized.dir)).toEqual(walkFiles(oldDest));
      for (const path of walkFiles(oldDest)) {
        expect(readFileSync(join(materialized.dir, path))).toEqual(readFileSync(join(oldDest, path)));
      }
      // Never materializes the fake key/canary bytes, and never the symlink
      // or the gitlink path (they are processing skips, not tracked paths).
      expect(walkFiles(materialized.dir)).not.toContain('secret.pem');
      expect(walkFiles(materialized.dir)).not.toContain('header-secret.txt');
      expect(walkFiles(materialized.dir)).not.toContain('linked.ts');
      expect(walkFiles(materialized.dir)).not.toContain('gitlink/fake-submodule');
    } finally {
      materialized.cleanup();
      rmSync(oldDest, { recursive: true, force: true });
    }
  });

  it('matches the old reference on search() results and order', () => {
    const sha = headSha(root);
    const old = oldResolve(root, sha);
    const fresh = new GitCommitSnapshot(root, sha);
    const terms = ['export', 'fixture', 'FAKE_KEY_CANARY'];

    const oldResults = oldSearch(root, sha, old.trackedPaths, terms);
    expect(oldResults.length).toBeGreaterThan(0); // sanity: fixture exercises real hits
    expect(fresh.search(terms)).toEqual(oldResults);
    // The sensitive file's canary text is never findable through search().
    expect(fresh.search(['FAKE_KEY_CANARY'])).toEqual([]);
  });

  it('never sends a non-selected path into the hash, write, or search batches (O3)', () => {
    const sha = headSha(root);
    const observed = { hash: [], write: [], search: [] };
    const spyReader = {
      readBlobPrefixes: (...args) => realBatchReader.readBlobPrefixes(...args),
      hashBlobs(cwd, items, opts) {
        observed.hash.push(...items.map((i) => i.path));
        return realBatchReader.hashBlobs(cwd, items, opts);
      },
      writeBlobs(cwd, items, dest, opts) {
        observed.write.push(...items.map((i) => i.path));
        return realBatchReader.writeBlobs(cwd, items, dest, opts);
      },
      searchBlobs(cwd, items, terms, opts) {
        observed.search.push(...items.map((i) => i.path));
        return realBatchReader.searchBlobs(cwd, items, terms, opts);
      },
    };

    const snapshot = new GitCommitSnapshot(root, sha, { batchReader: spyReader });
    snapshot.entries();
    snapshot.materialize().cleanup();
    snapshot.search(['export']);

    const selected = new Set(snapshot.listFiles());
    const nonSelected = ['secret.pem', 'header-secret.txt', 'image.png', 'linked.ts', 'gitlink/fake-submodule'];
    for (const kind of ['hash', 'write', 'search']) {
      expect(observed[kind].length).toBeGreaterThan(0); // sanity: batches were actually exercised
      for (const path of observed[kind]) expect(selected.has(path)).toBe(true);
      for (const path of nonSelected) expect(observed[kind]).not.toContain(path);
    }
  });

  it('the header-prefetch batch (readBlobPrefixes) never receives the sensitive-by-extension or analysis-data/archive paths', () => {
    const sha = headSha(root);
    const observedPrefixPaths = [];
    const spyReader = {
      readBlobPrefixes(cwd, items, prefixBytes, opts) {
        observedPrefixPaths.push(...items.map((i) => i.path));
        return realBatchReader.readBlobPrefixes(cwd, items, prefixBytes, opts);
      },
      hashBlobs: (...args) => realBatchReader.hashBlobs(...args),
      writeBlobs: (...args) => realBatchReader.writeBlobs(...args),
      searchBlobs: (...args) => realBatchReader.searchBlobs(...args),
    };

    new GitCommitSnapshot(root, sha, { batchReader: spyReader });

    // secret.pem is sensitive by EXTENSION (no header read needed at all);
    // the symlink and gitlink entries never reach the blob layer either.
    expect(observedPrefixPaths).not.toContain('secret.pem');
    expect(observedPrefixPaths).not.toContain('linked.ts');
    expect(observedPrefixPaths).not.toContain('gitlink/fake-submodule');
    // header-secret.txt DOES need a header read (that's how its sensitivity
    // is detected in the first place), and ordinary files do too.
    expect(observedPrefixPaths).toContain('header-secret.txt');
    expect(observedPrefixPaths).toContain('src/app.ts');
  });
});
