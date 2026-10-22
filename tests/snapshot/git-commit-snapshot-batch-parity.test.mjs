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

// --- Tree paths whose bytes are not valid UTF-8. A tree path is raw bytes,
// but Node's argv is always UTF-8, so these fixtures stage every entry
// through `update-index -z --index-info` on stdin instead of `--cacheinfo`. ---

const REPLACEMENT_CHAR = String.fromCharCode(0xfffd);

/** Concatenate UTF-8 strings and raw byte arrays into one path. */
function pathBytes(...parts) {
  return Buffer.concat(parts.map((part) => (typeof part === 'string' ? Buffer.from(part, 'utf-8') : Buffer.from(part))));
}

function makeRawPathFixture(files) {
  const fixture = mkdtempSync(join(tmpdir(), 'excavator-raw-path-fixture-'));
  git(fixture, ['init', '-q']);
  const records = files.map(({ path, content }) => {
    const oid = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: fixture, input: content, encoding: 'utf-8' }).trim();
    return Buffer.concat([Buffer.from(`100644 ${oid}\t`), path, Buffer.from([0])]);
  });
  execFileSync('git', ['update-index', '-z', '--index-info'], { cwd: fixture, input: Buffer.concat(records) });
  git(fixture, ['commit', '-q', '-m', 'raw-path fixture']);
  return fixture;
}

/** `listTrackedEntries` as it was before tree paths were read as bytes:
 *  the whole output decoded as UTF-8, then split on NUL. */
function oldListTrackedEntries(dir, sha) {
  const stdout = execFileSync('git', ['ls-tree', '-r', '-z', sha], { cwd: dir, encoding: 'utf-8' });
  return stdout.split('\0').filter(Boolean).map((record) => {
    const match = record.match(/^(\d+)\s+(\S+)\s+([0-9a-f]+)\t([\s\S]+)$/);
    return { mode: match[1], type: match[2], oid: match[3], path: match[4] };
  });
}

/** A batch reader that records every path any batch is asked for. */
function recordingBatchReader(requested) {
  const record = (items) => requested.push(...items.map((item) => item.path));
  return {
    readBlobPrefixes(cwd, items, ...rest) { record(items); return realBatchReader.readBlobPrefixes(cwd, items, ...rest); },
    hashBlobs(cwd, items, ...rest) { record(items); return realBatchReader.hashBlobs(cwd, items, ...rest); },
    writeBlobs(cwd, items, ...rest) { record(items); return realBatchReader.writeBlobs(cwd, items, ...rest); },
    searchBlobs(cwd, items, ...rest) { record(items); return realBatchReader.searchBlobs(cwd, items, ...rest); },
  };
}

describe('GitCommitSnapshot — tree paths that are not valid UTF-8', () => {
  it('records such a path as a visible read-failed skip, never a listed file, as the per-file reference does', () => {
    const fixture = makeRawPathFixture([
      { path: pathBytes('src/app.ts'), content: 'export const app = 1;\n' },
      { path: pathBytes('src/caf', [0xe9], '.ts'), content: 'export const latin1 = 1;\n' }, // Latin-1 e-acute
      { path: pathBytes('node_modules/caf', [0xe9], '.js'), content: 'module.exports = 1;\n' },
    ]);
    try {
      const sha = headSha(fixture);
      const requested = [];
      const fresh = new GitCommitSnapshot(fixture, sha, { batchReader: recordingBatchReader(requested) });
      const old = oldResolve(fixture, sha);

      expect(fresh.listFiles()).toEqual(['src/app.ts']);
      expect(fresh.processingSkips).toEqual([{ path: 'src/caf%E9.ts', reason: 'read-failed' }]);
      for (const path of fresh.listFiles()) expect(() => fresh.readFile(path)).not.toThrow();
      // The ledger keeps the same path, so the skip names a selected
      // candidate (mergeSnapshotSelection requires it), and directory rules
      // still see the encoded path's directories.
      const kindByPath = new Map(fresh.selection.entries.map((entry) => [entry.path, entry.kind]));
      expect(kindByPath.get('src/caf%E9.ts')).toBe('selected');
      expect(kindByPath.get('node_modules/caf%E9.js')).toBe('filtered-by-defaults');

      expect(fresh.selection).toEqual(old.selection);
      expect(fresh.processingSkips).toEqual(old.processingSkips);
      expect(fresh.listFiles()).toEqual(old.trackedPaths);
      expect(fresh.entries()).toEqual(oldEntries(fixture, sha, old.trackedPaths));

      // Its content is never asked for, by path or by oid.
      fresh.materialize().cleanup();
      fresh.search(['export']);
      expect(new Set(requested)).toEqual(new Set(['src/app.ts']));
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('gives every such path its own record, even when their U+FFFD decodings or a literal `%` coincide', () => {
    const fixture = makeRawPathFixture([
      { path: pathBytes('src/app.ts'), content: 'export const app = 1;\n' },
      // Both decode to the same string with U+FFFD.
      { path: pathBytes('src/caf', [0xe9], '.ts'), content: 'export const acute = 1;\n' },
      { path: pathBytes('src/caf', [0xff], '.ts'), content: 'export const ff = 1;\n' },
      // These two become the same string unless `%` itself is encoded.
      { path: pathBytes('lib/x', [0xe9, 0xff], '.ts'), content: 'export const pair = 1;\n' },
      { path: pathBytes('lib/x%E9', [0xff], '.ts'), content: 'export const percent = 1;\n' },
    ]);
    try {
      const sha = headSha(fixture);
      const fresh = new GitCommitSnapshot(fixture, sha);
      const old = oldResolve(fixture, sha);

      expect(fresh.processingSkips).toEqual([
        { path: 'lib/x%25E9%FF.ts', reason: 'read-failed' },
        { path: 'lib/x%E9%FF.ts', reason: 'read-failed' },
        { path: 'src/caf%E9.ts', reason: 'read-failed' },
        { path: 'src/caf%FF.ts', reason: 'read-failed' },
      ]);
      expect(fresh.listFiles()).toEqual(['src/app.ts']);
      const selectionPaths = fresh.selection.entries.map((entry) => entry.path);
      expect(selectionPaths).toHaveLength(5);
      expect(new Set(selectionPaths).size).toBe(5);

      expect(fresh.selection).toEqual(old.selection);
      expect(fresh.processingSkips).toEqual(old.processingSkips);
      expect(fresh.listFiles()).toEqual(old.trackedPaths);
      expect(fresh.entries()).toEqual(oldEntries(fixture, sha, old.trackedPaths));
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  it('refuses a tree where such a path shares a name with a valid path', () => {
    const clashes = [
      // `git log` and `git diff` read as UTF-8 would credit the 0xe9 file's
      // history and deletion to this valid file.
      { valid: `src/caf${REPLACEMENT_CHAR}.ts`, message: /src\/caf%E9\.ts is not valid UTF-8 and decodes with U\+FFFD to the valid path/ },
      { valid: 'src/caf%E9.ts', message: /src\/caf%E9\.ts is not valid UTF-8 and its percent-encoded name is also a valid path/ },
    ];
    for (const { valid, message } of clashes) {
      const fixture = makeRawPathFixture([
        { path: pathBytes(valid), content: 'export const valid = 1;\n' },
        { path: pathBytes('src/caf', [0xe9], '.ts'), content: 'export const latin1 = 1;\n' },
      ]);
      try {
        expect(() => new GitCommitSnapshot(fixture, headSha(fixture))).toThrow(message);
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }
    }
  });

  it('reads valid UTF-8 tree paths exactly as decoding the whole output did', () => {
    const fixture = makeRawPathFixture([
      { path: pathBytes('plain.ts'), content: 'a\n' },
      { path: pathBytes('src/caf', [0xc3, 0xa9], '.ts'), content: 'b\n' }, // e-acute in UTF-8
      { path: pathBytes([0xef, 0xbb, 0xbf], 'bom.ts'), content: 'c\n' }, // leading byte-order mark
      { path: pathBytes(`src/caf${REPLACEMENT_CHAR}.ts`), content: 'd\n' },
      { path: pathBytes('quote"and\\backslash.ts'), content: 'e\n' },
      { path: pathBytes('tab\tand\nnewline.ts'), content: 'f\n' },
    ]);
    try {
      const sha = headSha(fixture);
      const entries = listTrackedEntries(fixture, sha);
      expect(entries).toHaveLength(6);
      expect(entries).toStrictEqual(oldListTrackedEntries(fixture, sha));
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
