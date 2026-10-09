// Group 4/5 (openspec: changes/product-serialization-ceiling, design D4/D5/D7)
// — staged publish + rollback, the shared headroom report, and the new
// timing self-report in lazy-analyze.mjs's `publish()`/`runLazyAnalysis`.
//
// Purpose-built synthetic fixtures only (AGENTS.md: no real-project source).
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { runLazyAnalysis, defaultPublishFs, cleanupStalePublishStagingDirs } from '../../skills/excavator/lazy-analyze.mjs';
import { SOURCE_INDEX_FILE } from '../../skills/excavator/source-index-store.mjs';
import { KNOWLEDGE_GRAPH_FILE } from '../../skills/excavator/knowledge-graph-store.mjs';

const FIXED_NOW = () => '2024-01-01T00:00:00.000Z';
const LATER_NOW = () => '2024-06-01T00:00:00.000Z';

const FINAL_PRODUCT_FILES = Object.freeze([KNOWLEDGE_GRAPH_FILE, 'fingerprints.json', SOURCE_INDEX_FILE, 'meta.json', 'source-manifest.json']);

function makeFixtureProject() {
  const root = mkdtempSync(join(tmpdir(), 'excavator-publish-staging-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'publish-staging-fixture' }, null, 2));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'a.ts'), "import { helper } from './b';\n\nexport function run(): void {\n  helper();\n}\n");
  writeFileSync(join(root, 'src', 'b.ts'), "export function helper(): void {\n  console.log('hi');\n}\n");
  return root;
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function hashAllFinalProducts(root) {
  const dir = join(root, '.excavator');
  const hashes = {};
  for (const name of FINAL_PRODUCT_FILES) hashes[name] = sha256File(join(dir, name));
  return hashes;
}

function stagingDirsIn(root) {
  return readdirSync(join(root, '.excavator')).filter((name) => name.startsWith('.publish-staging-'));
}

function changeSource(root) {
  writeFileSync(join(root, 'src', 'b.ts'), "export function helper(): void {\n  console.log('hi there');\n}\n");
}

/** A `publishFs` that throws for exactly one method, exactly when its
 *  argument at `pathArgIndex` ends with `filenameSuffix` — every other call
 *  (any other product, or the same product's OTHER method calls) goes
 *  through to the real implementation unchanged. */
function publishFsThatFailsOn(method, pathArgIndex, filenameSuffix, errorMessage) {
  return {
    ...defaultPublishFs,
    [method]: (...args) => {
      if (String(args[pathArgIndex]).endsWith(filenameSuffix)) {
        throw new Error(errorMessage ?? `simulated ${method} failure for ${filenameSuffix}`);
      }
      return defaultPublishFs[method](...args);
    },
  };
}

// ---------------------------------------------------------------------------
// Fault injection — Requirement "原子保存先于推进 manifest" / "写到一半的保存失败不留
// 半成品" / "替换阶段失败" (revision-sync spec), design D4's stage/replace/
// rollback sequence, and product-serialization's O4/O5 acceptance oracles.
// ---------------------------------------------------------------------------
describe('lazy-analyze publish() — staged publish, fault injection (design D4, O4/O5)', () => {
  let root;
  let baselineHashes;
  let baselineSerialization;

  beforeEach(async () => {
    root = makeFixtureProject();
    const baseline = await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    expect(baseline.saveError).toBeNull();
    expect(baseline.metaAdvanced).toBe(true);
    baselineHashes = hashAllFinalProducts(root);
    baselineSerialization = baseline.serialization;
  });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  const PRODUCTS = Object.freeze([
    { filename: KNOWLEDGE_GRAPH_FILE, stagingMethod: 'writeKnowledgeGraph' },
    { filename: 'fingerprints.json', stagingMethod: 'writeFile' },
    { filename: SOURCE_INDEX_FILE, stagingMethod: 'writeSourceIndex' },
    { filename: 'meta.json', stagingMethod: 'writeFile' },
    { filename: 'source-manifest.json', stagingMethod: 'writeFile' },
  ]);

  for (const { filename, stagingMethod } of PRODUCTS) {
    it(`STAGING failure for ${filename}: every final product stays byte-identical, no staging dir remains, metaAdvanced false, saveError named (O4)`, async () => {
      changeSource(root); // a real content change — proves rollback/no-op is not a trivial no-change coincidence
      const publishFs = publishFsThatFailsOn(stagingMethod, 0, filename);

      const result = await runLazyAnalysis({ projectRoot: root, now: LATER_NOW, publishFs });

      expect(result.metaAdvanced).toBe(false);
      expect(typeof result.saveError).toBe('string');
      expect(result.saveError).toContain(filename);
      expect(hashAllFinalProducts(root)).toEqual(baselineHashes);
      expect(stagingDirsIn(root)).toEqual([]);
    });
  }

  for (const { filename } of PRODUCTS) {
    it(`REPLACE failure for ${filename}: rolls back every already-completed replace step, byte-identical, no staging dir, metaAdvanced false, saveError named (O4)`, async () => {
      changeSource(root);
      const publishFs = publishFsThatFailsOn('rename', 1, filename);

      const result = await runLazyAnalysis({ projectRoot: root, now: LATER_NOW, publishFs });

      expect(result.metaAdvanced).toBe(false);
      expect(typeof result.saveError).toBe('string');
      expect(result.saveError).toContain(filename);
      expect(hashAllFinalProducts(root)).toEqual(baselineHashes);
      expect(stagingDirsIn(root)).toEqual([]);
    });
  }

  it('a hard-link failure during replace falls back to a plain copy; the publish still succeeds (design D4 step 2)', async () => {
    changeSource(root);
    let linkAttempts = 0;
    const publishFs = {
      ...defaultPublishFs,
      link: (...args) => { linkAttempts += 1; throw new Error('simulated: hard links unavailable on this filesystem'); },
    };

    const result = await runLazyAnalysis({ projectRoot: root, now: LATER_NOW, publishFs });

    expect(result.saveError).toBeNull();
    expect(result.metaAdvanced).toBe(true);
    expect(linkAttempts).toBe(FINAL_PRODUCT_FILES.length); // one attempt per product — every one already existed
    expect(hashAllFinalProducts(root)).not.toEqual(baselineHashes); // the run really did produce new content
  });

  // openspec: changes/knowledge-graph-line-store, design「验收」4 — the limit
  // now applies per record of a line-oriented product, not to the whole graph.
  it('a graph larger than the limit publishes when every record and every whole-document product fits', async () => {
    changeSource(root);
    const fits = Math.max(...baselineSerialization
      .filter((e) => e.measuredAs !== 'bytes')
      .map((e) => e.chars ?? e.maxRecordChars));
    const limit = fits + 200; // headroom for the one-line source change
    const graphChars = readFileSync(join(root, '.excavator', KNOWLEDGE_GRAPH_FILE), 'utf-8').length;
    expect(graphChars).toBeGreaterThan(limit); // precondition: the whole graph would NOT fit in one string

    const result = await runLazyAnalysis({ projectRoot: root, now: LATER_NOW, serializationLimit: limit });

    expect(result.saveError).toBeNull();
    expect(result.metaAdvanced).toBe(true);
    const graphEntry = result.serialization.find((e) => e.product === KNOWLEDGE_GRAPH_FILE);
    expect(graphEntry).toMatchObject({ measuredAs: 'max-record' });
    expect(graphEntry.maxRecordChars).toBeLessThanOrEqual(limit);
  });

  it('a single record longer than the limit fails as a named ProductTooLargeError; every final product stays byte-identical (O5)', async () => {
    // One function with a very long name makes one node record far longer
    // than any whole-document product of this fixture.
    const longName = `handle${'X'.repeat(3_000)}`;
    writeFileSync(join(root, 'src', 'b.ts'), `export function helper(): void {}\nexport function ${longName}(): void {}\n`);
    const fits = Math.max(...baselineSerialization
      .filter((e) => e.measuredAs !== 'bytes')
      .map((e) => e.chars ?? e.maxRecordChars));
    const limit = fits + 500;
    expect(limit).toBeLessThan(longName.length);

    let result = null;
    let thrown = null;
    try {
      result = await runLazyAnalysis({ projectRoot: root, now: LATER_NOW, serializationLimit: limit });
    } catch (error) {
      thrown = error;
    }
    const message = thrown?.message ?? result?.saveError ?? '';

    expect(result?.metaAdvanced ?? false).toBe(false);
    // The first per-record product to meet the long node record names it:
    // the facts digest, the intermediate projection or the graph itself.
    expect(message).toMatch(/"(facts-digest-record|fact-graph\.jsonl|knowledge-graph\.jsonl)" requires \d+ characters to serialize/);
    expect(message).toContain(`exceeds the runtime single-string limit of ${limit} characters`);
    expect(hashAllFinalProducts(root)).toEqual(baselineHashes);
    expect(stagingDirsIn(root)).toEqual([]);
  });

  it('recovery: a subsequent run WITHOUT the injected failure succeeds and advances normally', async () => {
    changeSource(root);
    const failed = await runLazyAnalysis({
      projectRoot: root, now: LATER_NOW, publishFs: publishFsThatFailsOn('rename', 1, 'meta.json'),
    });
    expect(failed.metaAdvanced).toBe(false);
    expect(hashAllFinalProducts(root)).toEqual(baselineHashes);

    const recovered = await runLazyAnalysis({ projectRoot: root, now: LATER_NOW });
    expect(recovered.saveError).toBeNull();
    expect(recovered.metaAdvanced).toBe(true);
    expect(hashAllFinalProducts(root)).not.toEqual(baselineHashes);
    expect(stagingDirsIn(root)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// cleanupStalePublishStagingDirs — design D4 step 3: the next publish cleans
// up same-prefix staging directories whose process no longer exists. Direct
// unit tests (no full runLazyAnalysis needed).
// ---------------------------------------------------------------------------
describe('cleanupStalePublishStagingDirs', () => {
  let dataDir;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'excavator-stale-staging-'));
  });
  afterEach(() => { rmSync(dataDir, { recursive: true, force: true }); });

  it('removes a staging directory whose pid is no longer running', () => {
    // An astronomically unlikely-to-exist pid — process.kill(deadPid, 0) is
    // expected to throw ESRCH on any real system.
    const deadPid = 999_999_999;
    const staleDir = join(dataDir, `.publish-staging-${deadPid}-abc123`);
    mkdirSync(staleDir);

    cleanupStalePublishStagingDirs(dataDir, defaultPublishFs);

    expect(existsSync(staleDir)).toBe(false);
  });

  it('leaves a staging directory whose pid IS still running untouched', () => {
    const liveDir = join(dataDir, `.publish-staging-${process.pid}-abc123`);
    mkdirSync(liveDir);

    cleanupStalePublishStagingDirs(dataDir, defaultPublishFs);

    expect(existsSync(liveDir)).toBe(true);
  });

  it('leaves a directory that does not match the naming scheme alone', () => {
    const unrelated = join(dataDir, 'intermediate');
    mkdirSync(unrelated);

    cleanupStalePublishStagingDirs(dataDir, defaultPublishFs);

    expect(existsSync(unrelated)).toBe(true);
  });

  it('does not throw when dataDir does not exist yet (first-ever run)', () => {
    rmSync(dataDir, { recursive: true, force: true });
    expect(() => cleanupStalePublishStagingDirs(dataDir, defaultPublishFs)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// result.serialization — design D5/product-serialization, task 4.3.
// ---------------------------------------------------------------------------
describe('runLazyAnalysis — result.serialization (task 4.3)', () => {
  let root;
  beforeEach(() => { root = makeFixtureProject(); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('reports every whole-document product this run serialized, plus child-script byte counts, sorted by percent descending', async () => {
    const result = await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });

    expect(result.saveError).toBeNull();
    expect(Array.isArray(result.serialization)).toBe(true);
    expect(result.serialization.length).toBeGreaterThan(0);

    const byProduct = new Map(result.serialization.map((e) => [e.product, e]));
    // The five final products this run publishes, plus lazy-analyze's own
    // intermediate writes, plus build-fact-graph's digest input, plus the
    // three child-script byte counts.
    for (const name of ['meta.json', 'source-manifest.json']) {
      expect(byProduct.get(name)).toMatchObject({ measuredAs: 'chars' });
      expect(typeof byProduct.get(name).chars).toBe('number');
    }
    // Line-oriented products report their longest record
    // (knowledge-graph-line-store, design D6).
    for (const name of [KNOWLEDGE_GRAPH_FILE, 'fact-graph.jsonl', SOURCE_INDEX_FILE, 'structure-all.jsonl']) {
      expect(byProduct.get(name)).toMatchObject({ measuredAs: 'max-record' });
      expect(typeof byProduct.get(name).maxRecordChars).toBe('number');
    }
    expect(byProduct.has('knowledge-graph.json')).toBe(false);
    for (const name of ['import-map.json', 'fingerprints.json']) {
      expect(byProduct.get(name)).toMatchObject({ measuredAs: 'bytes' });
      expect(typeof byProduct.get(name).bytes).toBe('number');
    }
    // The facts digest is hashed record by record (knowledge-graph-line-store,
    // design D3): its longest record is reported, and the joined text no
    // longer exists.
    expect(byProduct.get('facts-digest-record')).toMatchObject({ measuredAs: 'max-record' });
    expect(byProduct.has('facts-digest-input')).toBe(false);

    for (let i = 1; i < result.serialization.length; i++) {
      expect(result.serialization[i - 1].percentOfLimit).toBeGreaterThanOrEqual(result.serialization[i].percentOfLimit);
    }
  });
});

// ---------------------------------------------------------------------------
// Timings — design D7, task 5.1: snapshotResolve, snapshotMaterialize,
// manifestEntries, and a WALL-CLOCK total.
// ---------------------------------------------------------------------------
describe('runLazyAnalysis — timings (task 5.1)', () => {
  let root;
  beforeEach(() => { root = makeFixtureProject(); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('records snapshotResolve, snapshotMaterialize and manifestEntries, and total is wall-clock (>= the sum of every stage)', async () => {
    const result = await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });

    expect(result.saveError).toBeNull();
    for (const stage of ['snapshotResolve', 'snapshotMaterialize', 'manifestEntries']) {
      expect(typeof result.timings[stage]).toBe('number');
      expect(result.timings[stage]).toBeGreaterThanOrEqual(0);
    }
    // Existing stage names are all still present (design D7: existing stage
    // names are unchanged).
    for (const stage of ['scan', 'structureAll', 'importMap', 'factGraph', 'sourceIndex', 'validate', 'fingerprints', 'save']) {
      expect(typeof result.timings[stage]).toBe('number');
    }

    // `manifestEntries` is a NESTED sub-breakdown of `save` (design D7: the
    // save stage SHALL separately record the manifest's per-file content
    // hashing — save separately/additionally reports it, it is not a sibling
    // stage) — `save`'s own measured duration
    // already spans the `entries()` call inside it. Excluded here so the
    // "sum of stages" is a sum of MUTUALLY EXCLUSIVE intervals; including it
    // would double-count that overlap and could make the naive sum exceed
    // total on a fast run, which is exactly the bug this test would
    // otherwise be unable to distinguish from a real regression. Verified
    // against a real run's numbers before writing this exclusion.
    const sumOfStages = Object.entries(result.timings)
      .filter(([stage]) => stage !== 'total' && stage !== 'manifestEntries')
      .reduce((sum, [, ms]) => sum + ms, 0);
    // A small tolerance absorbs `Date.now()`'s 1ms-integer rounding across
    // ~10 separate stage measurements against `total`'s sub-millisecond
    // `performance.now()` basis — this is about clock-resolution slop, not
    // about hiding a real accounting error (the manifestEntries exclusion
    // above is the one substantive fix; this is a few ms of jitter margin).
    expect(result.timings.total).toBeGreaterThanOrEqual(sumOfStages - 5);
  });
});
