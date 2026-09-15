// Group 4 — on-demand semantic-cache mechanics (openspec: changes/
// hybrid-retrieval, specs/semantic-cache/spec.md). This module calls NO
// model — summary/tags CONTENT is injected by the test, exactly as chat
// would inject it in production (design D5). Purpose-built synthetic
// project fixtures only (AGENTS.md: no real-project source).
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync,
  renameSync, openSync, writeSync, closeSync, unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import {
  freshnessOf,
  isFresh,
  lookupSemanticCacheEntry,
  readSemanticCache,
  currentSourceHashFor,
  validateCacheableFields,
  commitSemanticCacheEntry,
  CACHEABLE_FIELDS,
} from '../../skills/excavator/semantic-cache.mjs';

const NODE_ID = 'function:src/orderService.ts:createOrder()';
const FILE_PATH = 'src/orderService.ts';
const HASH_V1 = 'sha256:v1-aaaaaaaa';
const HASH_V2 = 'sha256:v2-bbbbbbbb';

function makeProject() {
  const root = mkdtempSync(join(tmpdir(), 'excavator-semantic-cache-'));
  mkdirSync(join(root, '.excavator'), { recursive: true });
  return root;
}

function writeManifest(root, entries) {
  writeFileSync(
    join(root, '.excavator', 'source-manifest.json'),
    JSON.stringify({ sourceRevision: 'directory:test', selectionDigest: 'sd1', pipelineVersion: 'lazy-fact-graph/1', entries }, null, 2),
    'utf-8',
  );
}

function readCacheFileRaw(root) {
  const path = join(root, '.excavator', 'semantic-cache.json');
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf-8')) : null;
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function validFields(overrides = {}) {
  return {
    summary: 'Creates a new order for the given user from validated cart items.',
    tags: ['order', 'creation'],
    semanticSourceHash: HASH_V1,
    model: 'test-model-1',
    generatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('semantic-cache — cacheable write then reuse on second lookup', () => {
  let root;
  beforeEach(() => { root = makeProject(); writeManifest(root, [{ path: FILE_PATH, contentHash: HASH_V1 }]); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('a committed entry is read back and reused (isFresh true) on a second lookup', async () => {
    const result = await commitSemanticCacheEntry({
      projectRoot: root, nodeId: NODE_ID, filePath: FILE_PATH, fields: validFields(),
    });
    expect(result).toEqual({ ok: true, status: 'committed' });

    // Second, independent read (simulating a later question about the same node).
    const cache = await readSemanticCache(root);
    const entry = lookupSemanticCacheEntry(cache, NODE_ID);
    expect(entry).toMatchObject({ summary: validFields().summary, semanticSourceHash: HASH_V1 });

    const currentHash = await currentSourceHashFor(root, FILE_PATH);
    expect(currentHash).toBe(HASH_V1);
    expect(isFresh(entry, currentHash)).toBe(true);
    expect(freshnessOf(entry, currentHash)).toBe('fresh');
  });

  it('a missing entry is reported as "missing", not silently treated as stale or fresh', () => {
    expect(freshnessOf(null, HASH_V1)).toBe('missing');
    expect(freshnessOf(undefined, HASH_V1)).toBe('missing');
    expect(isFresh(null, HASH_V1)).toBe(false);
  });
});

describe('semantic-cache — canonical-language oracle (red before implementation)', () => {
  let root;
  beforeEach(() => { root = makeProject(); writeManifest(root, [{ path: FILE_PATH, contentHash: HASH_V1 }]); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('the deterministic writer rejects Chinese model prose without creating a cache', async () => {
    const result = await commitSemanticCacheEntry({
      projectRoot: root,
      nodeId: NODE_ID,
      filePath: FILE_PATH,
      fields: validFields({
        summary: '在写入订单前验证请求。',
        tags: ['order', '验证'],
      }),
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe('noncanonical-language');
    expect(existsSync(join(root, '.excavator', 'semantic-cache.json'))).toBe(false);
  });

  it('freshness requires a cache-level English marker in addition to a matching source hash', () => {
    const entry = validFields();

    expect(freshnessOf(entry, HASH_V1, 'en')).toBe('fresh');
    expect(freshnessOf(entry, HASH_V1, undefined)).toBe('noncanonical-language');
    expect(freshnessOf(entry, HASH_V1, 'zh')).toBe('noncanonical-language');
    expect(isFresh(entry, HASH_V1, undefined)).toBe(false);
  });

  it('an accepted English write stamps the cache-level marker itself', async () => {
    const result = await commitSemanticCacheEntry({
      projectRoot: root, nodeId: NODE_ID, filePath: FILE_PATH, fields: validFields(),
    });

    expect(result).toEqual({ ok: true, status: 'committed' });
    expect(readCacheFileRaw(root)).toMatchObject({ contentLanguage: 'en' });
  });
});

describe('semantic-cache — a file\'s source-hash change invalidates its entry', () => {
  let root;
  beforeEach(() => { root = makeProject(); writeManifest(root, [{ path: FILE_PATH, contentHash: HASH_V1 }]); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('freshnessOf reports "stale" once the manifest hash has moved on', async () => {
    await commitSemanticCacheEntry({ projectRoot: root, nodeId: NODE_ID, filePath: FILE_PATH, fields: validFields() });
    const cache = await readSemanticCache(root);
    const entry = lookupSemanticCacheEntry(cache, NODE_ID);

    // The file changed — the manifest now reports a different content hash.
    writeManifest(root, [{ path: FILE_PATH, contentHash: HASH_V2 }]);
    const currentHash = await currentSourceHashFor(root, FILE_PATH);

    expect(freshnessOf(entry, currentHash)).toBe('stale');
    expect(isFresh(entry, currentHash)).toBe(false);
  });
});

describe('semantic-cache — verify the instrument: a concurrent stale-hash write is rejected by CAS', () => {
  let root;
  beforeEach(() => { root = makeProject(); writeManifest(root, [{ path: FILE_PATH, contentHash: HASH_V1 }]); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('a write whose semanticSourceHash no longer matches the manifest is rejected, leaving the cache unchanged', async () => {
    const first = await commitSemanticCacheEntry({
      projectRoot: root, nodeId: NODE_ID, filePath: FILE_PATH, fields: validFields(),
    });
    expect(first.ok).toBe(true);
    const cacheAfterFirstCommit = readCacheFileRaw(root);

    // INJECT a competing newer hash: the manifest now reports HASH_V2 for
    // this file, as if a concurrent sync/edit had landed between the second
    // writer reading the source (at HASH_V1) and now trying to commit.
    writeManifest(root, [{ path: FILE_PATH, contentHash: HASH_V2 }]);

    const stale = await commitSemanticCacheEntry({
      projectRoot: root,
      nodeId: NODE_ID,
      filePath: FILE_PATH,
      fields: validFields({ summary: 'A DIFFERENT summary computed against the stale content.' }),
    });

    expect(stale).toEqual({ ok: false, status: 'stale-hash', currentSourceHash: HASH_V2 });
    // The instrument: prove the rejected write changed NOTHING on disk — the
    // cache file is byte-identical to right after the first, accepted commit.
    expect(readCacheFileRaw(root)).toEqual(cacheAfterFirstCommit);
  });

  it('positive control: the SAME hash (no concurrent change) commits successfully', async () => {
    const result = await commitSemanticCacheEntry({
      projectRoot: root, nodeId: NODE_ID, filePath: FILE_PATH, fields: validFields(),
    });
    expect(result).toEqual({ ok: true, status: 'committed' });
  });
});

describe('semantic-cache — field whitelist', () => {
  let root;
  beforeEach(() => { root = makeProject(); writeManifest(root, [{ path: FILE_PATH, contentHash: HASH_V1 }]); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('validateCacheableFields accepts exactly the documented field set', () => {
    expect(validateCacheableFields(validFields())).toEqual({ ok: true, rejectedFields: [] });
    // `verification` (openspec: changes/full-semantic-isolation) is an
    // additive extension: the Summary-Verifier's verdict about THIS entry's
    // own summary, redirected here instead of onto a knowledge-graph node.
    expect(CACHEABLE_FIELDS).toEqual(['summary', 'tags', 'semanticSourceHash', 'model', 'generatedAt', 'verification']);
  });

  it('rejects a disallowed field (a cross-file conclusion) and writes nothing', async () => {
    const fields = validFields({ crossFileConclusion: 'this service is called by the checkout flow' });

    const result = await commitSemanticCacheEntry({ projectRoot: root, nodeId: NODE_ID, filePath: FILE_PATH, fields });

    expect(result).toEqual({ ok: false, status: 'rejected-fields', rejectedFields: ['crossFileConclusion'] });
    expect(existsSync(join(root, '.excavator', 'semantic-cache.json'))).toBe(false);
  });

  it('rejects answer text disguised as a field', async () => {
    const fields = validFields({ answer: 'Here is the full answer to your question...' });
    const result = await commitSemanticCacheEntry({ projectRoot: root, nodeId: NODE_ID, filePath: FILE_PATH, fields });
    expect(result.ok).toBe(false);
    expect(result.status).toBe('rejected-fields');
    expect(result.rejectedFields).toEqual(['answer']);
  });
});

describe('semantic-cache — the fact layer is never touched', () => {
  let root;
  beforeEach(() => { root = makeProject(); writeManifest(root, [{ path: FILE_PATH, contentHash: HASH_V1 }]); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('a semantic write leaves knowledge-graph.json byte-identical', async () => {
    const graphContent = JSON.stringify({ version: '1.0.0', nodes: [{ id: NODE_ID, type: 'function' }], edges: [] }, null, 2);
    writeFileSync(join(root, '.excavator', 'knowledge-graph.json'), graphContent, 'utf-8');
    const shaBefore = sha256(readFileSync(join(root, '.excavator', 'knowledge-graph.json')));

    const result = await commitSemanticCacheEntry({ projectRoot: root, nodeId: NODE_ID, filePath: FILE_PATH, fields: validFields() });
    expect(result.ok).toBe(true);

    const shaAfter = sha256(readFileSync(join(root, '.excavator', 'knowledge-graph.json')));
    expect(shaAfter).toBe(shaBefore);
    expect(readFileSync(join(root, '.excavator', 'knowledge-graph.json'), 'utf-8')).toBe(graphContent);
  });
});

describe('semantic-cache — a write failure returns a status and does not throw', () => {
  let root;
  beforeEach(() => { root = makeProject(); writeManifest(root, [{ path: FILE_PATH, contentHash: HASH_V1 }]); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('an injected I/O error during the atomic write is caught and reported as "io-error"', async () => {
    const failingFsImpl = {
      // A fresh lock acquisition uses openSync/writeSync/closeSync, not
      // writeFileSync, so only the atomic cache write is broken here.
      openSync, writeSync, closeSync, unlinkSync, renameSync,
      existsSync: (...args) => existsSync(...args),
      mkdirSync: (...args) => mkdirSync(...args),
      readFileSync: (...args) => readFileSync(...args),
      writeFileSync: () => { throw new Error('simulated disk full'); },
    };

    let thrown = null;
    let result;
    try {
      result = await commitSemanticCacheEntry({
        projectRoot: root, nodeId: NODE_ID, filePath: FILE_PATH, fields: validFields(), fsImpl: failingFsImpl,
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeNull();
    expect(result.ok).toBe(false);
    expect(result.status).toBe('io-error');
    expect(result.error).toMatch(/simulated disk full/);
    // Nothing was left half-written.
    expect(existsSync(join(root, '.excavator', 'semantic-cache.json'))).toBe(false);
    // The lock must have been released despite the failure (no stray lock left).
    expect(existsSync(join(root, '.excavator', 'semantic.lock'))).toBe(false);
  });
});

describe('semantic-cache — lock: a live holder rejects a write; a stale holder is stolen (TTL)', () => {
  let root;
  beforeEach(() => { root = makeProject(); writeManifest(root, [{ path: FILE_PATH, contentHash: HASH_V1 }]); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('a live (recent) lock rejects a concurrent write and leaves the cache untouched', async () => {
    const lockPath = join(root, '.excavator', 'semantic.lock');
    const nowMs = 1_700_000_000_000;
    writeFileSync(lockPath, JSON.stringify({ pid: 999999, host: 'other-host', acquiredAt: new Date(nowMs).toISOString() }), 'utf-8');

    const result = await commitSemanticCacheEntry({
      projectRoot: root, nodeId: NODE_ID, filePath: FILE_PATH, fields: validFields(),
      now: () => nowMs + 1000, // 1s later — well within the default 30s TTL
    });

    expect(result).toEqual({ ok: false, status: 'lock-held' });
    expect(existsSync(join(root, '.excavator', 'semantic-cache.json'))).toBe(false);
    // The other holder's lock is left exactly as it was — never released or
    // stolen by a rejected acquisition attempt.
    expect(JSON.parse(readFileSync(lockPath, 'utf-8'))).toEqual({ pid: 999999, host: 'other-host', acquiredAt: new Date(nowMs).toISOString() });
  });

  it('a stale (past-TTL) lock is stolen and the write succeeds', async () => {
    const lockPath = join(root, '.excavator', 'semantic.lock');
    const staleAcquiredAtMs = 1_700_000_000_000;
    writeFileSync(lockPath, JSON.stringify({ pid: 999999, host: 'crashed-host', acquiredAt: new Date(staleAcquiredAtMs).toISOString() }), 'utf-8');

    const result = await commitSemanticCacheEntry({
      projectRoot: root, nodeId: NODE_ID, filePath: FILE_PATH, fields: validFields(),
      now: () => staleAcquiredAtMs + 60_000, // 60s later — past the default 30s TTL
      ttlMs: 30_000,
    });

    expect(result).toEqual({ ok: true, status: 'committed' });
    // The lock is released again once the commit completes.
    expect(existsSync(lockPath)).toBe(false);
    const cache = await readSemanticCache(root);
    expect(lookupSemanticCacheEntry(cache, NODE_ID)).toMatchObject({ semanticSourceHash: HASH_V1 });
  });
});

describe('semantic-cache — concurrent writes to DIFFERENT nodes both survive (no lost update)', () => {
  let root;
  const OTHER_NODE_ID = 'function:src/paymentHandler.ts:retryPayment()';
  const OTHER_FILE_PATH = 'src/paymentHandler.ts';

  beforeEach(() => {
    root = makeProject();
    writeManifest(root, [
      { path: FILE_PATH, contentHash: HASH_V1 },
      { path: OTHER_FILE_PATH, contentHash: HASH_V2 },
    ]);
  });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('committing a second node\'s entry does not clobber the first', async () => {
    const first = await commitSemanticCacheEntry({ projectRoot: root, nodeId: NODE_ID, filePath: FILE_PATH, fields: validFields() });
    expect(first.ok).toBe(true);

    const second = await commitSemanticCacheEntry({
      projectRoot: root, nodeId: OTHER_NODE_ID, filePath: OTHER_FILE_PATH,
      fields: validFields({ summary: 'Retries a failed payment attempt.', semanticSourceHash: HASH_V2 }),
    });
    expect(second.ok).toBe(true);

    const cache = await readSemanticCache(root);
    expect(lookupSemanticCacheEntry(cache, NODE_ID)).toMatchObject({ semanticSourceHash: HASH_V1 });
    expect(lookupSemanticCacheEntry(cache, OTHER_NODE_ID)).toMatchObject({ semanticSourceHash: HASH_V2 });
  });
});

describe('semantic-cache — freshness without a manifest entry is honestly "not generated"/unresolvable', () => {
  it('currentSourceHashFor returns null when there is no source-manifest.json at all', async () => {
    const root = makeProject();
    try {
      expect(await currentSourceHashFor(root, FILE_PATH)).toBeNull();
      const result = await commitSemanticCacheEntry({ projectRoot: root, nodeId: NODE_ID, filePath: FILE_PATH, fields: validFields() });
      expect(result).toEqual({ ok: false, status: 'manifest-missing' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('currentSourceHashFor returns null for a path absent from an existing manifest', async () => {
    const root = makeProject();
    try {
      writeManifest(root, [{ path: 'src/unrelated.ts', contentHash: HASH_V1 }]);
      expect(await currentSourceHashFor(root, FILE_PATH)).toBeNull();
      const result = await commitSemanticCacheEntry({ projectRoot: root, nodeId: NODE_ID, filePath: FILE_PATH, fields: validFields() });
      expect(result).toEqual({ ok: false, status: 'path-not-in-manifest' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
