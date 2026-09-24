// Group 5 (hybrid-retrieval) — wiring `source-index.jsonl` into the Lazy
// pipeline (openspec: changes/hybrid-retrieval, capability `source-index`,
// design D2; line-oriented persistence added by changes/product-
// serialization-ceiling, design D1/D3). Purpose-built synthetic fixtures
// only (AGENTS.md).
//
// This is a WIRING/artifact-level test: it proves lazy-analyze.mjs writes
// `source-index.jsonl` on a first run and syncFactGraph.mjs updates it on a
// subsequent sync, reusing the group-2/3 `buildSourceIndex`/`updateSourceIndex`
// helpers whose own chunking/BM25/incremental-reuse internals are already
// unit-tested in tests/retrieval/build-source-index.test.mjs (and the
// line-oriented store's own read/write round trip in
// tests/retrieval/source-index-store.test.mjs). The DECISION of which of
// buildSourceIndex/updateSourceIndex to call (`buildOrUpdateSourceIndex`) is
// separately unit-tested below with injected fakes, since a deterministic
// full rebuild and a correct incremental update are BY DESIGN
// indistinguishable from the resulting file's content alone (see that
// describe block's own comment).
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runLazyAnalysis } from '../../skills/excavator/lazy-analyze.mjs';
import { syncFactGraph, buildOrUpdateSourceIndex, readPreviousSourceIndex } from '../../skills/excavator/sync-fact-graph.mjs';
import { SOURCE_INDEX_FILE, readSourceIndex as readSourceIndexFile } from '../../skills/excavator/source-index-store.mjs';

const FIXED_NOW = () => '2024-01-01T00:00:00.000Z';
const LATER_NOW = () => '2024-06-01T00:00:00.000Z';

function makeFixtureProject() {
  const root = mkdtempSync(join(tmpdir(), 'excavator-source-index-pipeline-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'source-index-fixture' }, null, 2));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'a.ts'), "import { helper } from './b';\n\nexport function run(): void {\n  helper();\n}\n");
  writeFileSync(join(root, 'src', 'b.ts'), "export function helper(): void {\n  console.log('hi');\n}\n");
  writeFileSync(join(root, 'src', 'c.ts'), "export function standalone(): number {\n  return 42;\n}\n");
  return root;
}

function readSourceIndex(root) {
  return readSourceIndexFile(join(root, '.excavator', SOURCE_INDEX_FILE));
}

function readManifest(root) {
  return JSON.parse(readFileSync(join(root, '.excavator', 'source-manifest.json'), 'utf-8'));
}

function symbolsOf(index) {
  return index.chunks.map((c) => c.symbol).filter(Boolean).sort();
}

describe('source-index.jsonl — a Lazy first run writes it alongside the graph', () => {
  let root;
  beforeEach(() => { root = makeFixtureProject(); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('writes source-index.jsonl with chunks for every declared symbol, keyed by the same sourceRevision', async () => {
    const result = await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    expect(result.saveError).toBeNull();
    expect(existsSync(join(root, '.excavator', SOURCE_INDEX_FILE))).toBe(true);

    const index = readSourceIndex(root);
    const manifest = readManifest(root);
    expect(index.sourceRevision).toBe(manifest.sourceRevision);
    expect(index.sourceRevision).toBe(result.sourceRevision);
    expect(symbolsOf(index)).toEqual(['helper', 'run', 'standalone']);
    // A BM25-indexable identifier from the fixture's own source text made it
    // into the index (not merely the declaration names) — proves this is
    // the real buildSourceIndex output, not a stub.
    expect(Object.keys(index.postings)).toEqual(expect.arrayContaining(['helper', 'run', 'standalone']));
  });
});

describe('source-index.jsonl — a syncFactGraph on a changed file updates it', () => {
  let root;
  beforeEach(() => { root = makeFixtureProject(); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('adding a new symbol and modifying another is reflected; an untouched file\'s symbol survives', async () => {
    await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    const indexBefore = readSourceIndex(root);
    expect(symbolsOf(indexBefore)).toEqual(['helper', 'run', 'standalone']);

    // Modify a.ts (a new call site) and add a brand-new file/symbol; leave
    // c.ts (standalone) completely untouched.
    writeFileSync(
      join(root, 'src', 'a.ts'),
      "import { helper } from './b';\n\nexport function run(): void {\n  helper();\n  helper();\n}\n",
    );
    writeFileSync(join(root, 'src', 'd.ts'), 'export function extra(): void {\n  return;\n}\n');

    const syncResult = await syncFactGraph({ projectRoot: root, now: LATER_NOW });
    expect(syncResult.kind).toBe('synced');
    expect(syncResult.saveError).toBeNull();
    expect(syncResult.changed.modified).toEqual(['src/a.ts']);
    expect(syncResult.changed.added).toEqual(['src/d.ts']);

    const indexAfter = readSourceIndex(root);
    const manifestAfter = readManifest(root);
    expect(indexAfter.sourceRevision).toBe(manifestAfter.sourceRevision);
    expect(indexAfter.sourceRevision).not.toBe(indexBefore.sourceRevision);
    // The new symbol is present; the untouched symbol survived the sync.
    expect(symbolsOf(indexAfter)).toEqual(['extra', 'helper', 'run', 'standalone']);

    // The untouched file's chunk (standalone) is byte-identical to before —
    // reused, not silently mangled by the incremental path.
    const standaloneBefore = indexBefore.chunks.find((c) => c.symbol === 'standalone');
    const standaloneAfter = indexAfter.chunks.find((c) => c.symbol === 'standalone');
    expect(standaloneAfter).toEqual(standaloneBefore);
  });

  it('a project with no previously-persisted source-index.jsonl (Slice-C upgrade) falls back to a full rebuild instead of failing', async () => {
    await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    rmSync(join(root, '.excavator', SOURCE_INDEX_FILE)); // simulate "ran on an older lazy-analyze.mjs"

    writeFileSync(join(root, 'src', 'd.ts'), 'export function extra(): void {\n  return;\n}\n');
    const syncResult = await syncFactGraph({ projectRoot: root, now: LATER_NOW });

    expect(syncResult.kind).toBe('synced');
    expect(syncResult.saveError).toBeNull();
    expect(existsSync(join(root, '.excavator', SOURCE_INDEX_FILE))).toBe(true);
    expect(symbolsOf(readSourceIndex(root))).toEqual(['extra', 'helper', 'run', 'standalone']);
  });

  it('a leftover legacy source-index.json (pre-/2 pipeline) is never read as the previous index; sync still falls back to a full rebuild', async () => {
    await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    rmSync(join(root, '.excavator', SOURCE_INDEX_FILE));
    // Deliberately invalid content: if sync-fact-graph.mjs ever mistakenly
    // tried to parse the legacy file as the current line-oriented format,
    // this would throw instead of being silently ignored.
    writeFileSync(join(root, '.excavator', 'source-index.json'), 'not a jsonl file at all');

    writeFileSync(join(root, 'src', 'd.ts'), 'export function extra(): void {\n  return;\n}\n');
    const syncResult = await syncFactGraph({ projectRoot: root, now: LATER_NOW });

    expect(syncResult.kind).toBe('synced');
    expect(syncResult.saveError).toBeNull();
    expect(symbolsOf(readSourceIndex(root))).toEqual(['extra', 'helper', 'run', 'standalone']);
  });
});

// ---------------------------------------------------------------------------
// F1 fix (batch A acceptance): readPreviousSourceIndex must catch ANY read
// failure — not only SourceIndexFormatError — because this read runs BEFORE
// syncFactGraph's freshness-skip check. An unreadable/odd `.jsonl` (a
// directory left at that path, a permission error, ...) must not fail even a
// sync that should have been skipped entirely.
// ---------------------------------------------------------------------------
describe('readPreviousSourceIndex — catch-all, not just format errors (F1)', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'excavator-read-previous-index-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('a directory at the .jsonl path is treated as "no previous index" (returns null), not a crash', () => {
    const dirAsFile = join(dir, 'source-index.jsonl');
    mkdirSync(dirAsFile); // literal directory where a file is expected
    expect(() => readPreviousSourceIndex(dirAsFile)).not.toThrow();
    expect(readPreviousSourceIndex(dirAsFile)).toBeNull();
  });

  it('a permission-denied file is treated as "no previous index" (returns null), not a crash', () => {
    const path = join(dir, 'source-index.jsonl');
    writeFileSync(path, 'irrelevant — permissions make this unreadable regardless of content');
    chmodSync(path, 0o000);
    try {
      expect(readPreviousSourceIndex(path)).toBeNull();
    } finally {
      chmodSync(path, 0o644); // restore so afterEach's rmSync can clean up
    }
  });
});

describe('syncFactGraph — a directory at source-index.jsonl does not break a sync that should be SKIPPED (F1)', () => {
  let root;
  beforeEach(() => { root = makeFixtureProject(); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('freshness still matches (nothing else changed): sync skips cleanly instead of throwing on the unreadable index', async () => {
    await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    // Replace the just-written valid .jsonl with a literal directory —
    // nothing about the SOURCE changed, so the manifest's
    // sourceRevision/selectionDigest/pipelineVersion still match and this
    // sync should be a pure skip (source-manifest.json is not even touched),
    // never reaching the point where it would try to WRITE a new index over
    // this directory.
    rmSync(join(root, '.excavator', SOURCE_INDEX_FILE));
    mkdirSync(join(root, '.excavator', SOURCE_INDEX_FILE));

    const result = await syncFactGraph({ projectRoot: root, now: LATER_NOW });
    expect(result.kind).toBe('skipped');
    expect(result.saveError).toBeNull();
    // Untouched — proves this really was a skip, not a rebuild that happened
    // to succeed despite the directory.
    expect(existsSync(join(root, '.excavator', SOURCE_INDEX_FILE))).toBe(true);
    expect(statSync(join(root, '.excavator', SOURCE_INDEX_FILE)).isDirectory()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildOrUpdateSourceIndex — the pure decision function sync-fact-graph.mjs
// uses to choose between a full rebuild and an incremental update.
//
// A deterministic full rebuild and a correct incremental update produce
// IDENTICAL bytes for the same content (that equivalence is exactly what
// tests/revision-sync/sync-fact-graph.test.mjs already proves for the
// knowledge graph, and tests/retrieval/build-source-index.test.mjs proves
// for buildSourceIndex/updateSourceIndex directly) — so the WIRING decision
// of "which one gets called" is only observable by injecting fakes and
// checking which one ran, not by inspecting output content.
// ---------------------------------------------------------------------------
describe('buildOrUpdateSourceIndex — decides between a full build and an incremental update', () => {
  const scan = { files: [] };
  const structureAll = { results: [] };
  const readFile = () => '';
  const sourceRevision = 'directory:test';

  it('uses updateFn when there is BOTH a changed-file-set AND a previous index', () => {
    let buildCalls = 0;
    let updateCalls = 0;
    const previousIndex = { chunks: [], postings: {}, sourceRevision: 'directory:old' };
    const changed = { added: ['src/d.ts'], modified: [], removed: [] };

    const result = buildOrUpdateSourceIndex({
      changed, previousIndex, scan, structureAll, readFile, sourceRevision,
      buildFn: () => { buildCalls++; return { via: 'build' }; },
      updateFn: (args) => { updateCalls++; expect(args).toMatchObject({ previousIndex, changed, sourceRevision }); return { via: 'update' }; },
    });

    expect(result).toEqual({ via: 'update' });
    expect(updateCalls).toBe(1);
    expect(buildCalls).toBe(0);
  });

  it('falls back to buildFn when changed is null (first build / adapter-type change)', () => {
    let buildCalls = 0;
    let updateCalls = 0;

    const result = buildOrUpdateSourceIndex({
      changed: null, previousIndex: { chunks: [] }, scan, structureAll, readFile, sourceRevision,
      buildFn: () => { buildCalls++; return { via: 'build' }; },
      updateFn: () => { updateCalls++; return { via: 'update' }; },
    });

    expect(result).toEqual({ via: 'build' });
    expect(buildCalls).toBe(1);
    expect(updateCalls).toBe(0);
  });

  it('falls back to buildFn when there is a changed-file-set but NO previous index', () => {
    let buildCalls = 0;
    let updateCalls = 0;

    const result = buildOrUpdateSourceIndex({
      changed: { added: [], modified: ['src/a.ts'], removed: [] }, previousIndex: null,
      scan, structureAll, readFile, sourceRevision,
      buildFn: () => { buildCalls++; return { via: 'build' }; },
      updateFn: () => { updateCalls++; return { via: 'update' }; },
    });

    expect(result).toEqual({ via: 'build' });
    expect(buildCalls).toBe(1);
    expect(updateCalls).toBe(0);
  });
});
