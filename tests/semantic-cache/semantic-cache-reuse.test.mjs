// Frozen red oracle for openspec change `semantic-cache-reuse`, task 1.2.
//
// Minimal future production API:
//   planSemanticCacheReuse({
//     requestedNodeIds: string[],
//     nodes: Array<{ id: string, filePath?: string }>,
//     manifestEntries: Array<{ path: string, contentHash: string }>,
//     semanticCache: { version: string, contentLanguage?: string, entries: object },
//   }) -> {
//     reuse: Array<{ nodeId, filePath, reason: 'fresh', summary, tags }>,
//     generate: Array<{ nodeId, filePath, currentContentHash,
//                       reason: 'missing'|'stale'|'noncanonical-language' }>,
//     unavailable: Array<{ nodeId, filePath: string|null,
//                          reason: 'unknown-node'|'path-not-in-manifest' }>,
//     counts: { requested, reuse, generate, unavailable },
//   }
//
// The planner is synchronous, deterministic, read-only, and model/writer-free.
// It deduplicates by the first occurrence of each exact node id. The dynamic
// import is intentionally caught: instrument-control tests still execute while
// the missing production planner leaves product expectations red.
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { auditSemanticCacheFields } from '../../skills/excavator/semantic-language-audit.mjs';

// Exact cache identity frozen by acceptance-oracle.md. Avoid importing the
// writer module here: the red planner fixture must collect before core build
// output exists, and the future planner itself owns reuse of the read gate.
const SEMANTIC_CACHE_VERSION = '2.0.0';
const CANONICAL_CONTENT_LANGUAGE = 'en';

const plannerImport = await import('../../skills/excavator/semantic-cache-reuse.mjs')
  .then((module) => ({ module, error: null }))
  .catch((error) => ({ module: null, error }));

const SAME = 'export function save() { return 1; }\n';
const LOAD = 'export function load() { return 3; }\n';
const REMOVE = 'export function remove() { return 4; }\n';
const OUTSIDE = 'export function outside() { return 5; }\n';
const SHARED_0 = 'export class OwnerA { save() { return 0; } }\nexport class OwnerB { save() { return 2; } }\n';
const SHARED_1 = 'export class OwnerA { save() { return 1; } }\nexport class OwnerB { save() { return 2; } }\n';

const H = (text) => createHash('sha256').update(text).digest('hex');

const ID = Object.freeze({
  A: 'function:src/same-a.ts:save()',
  B: 'function:src/same-b.ts:save()',
  M: 'function:src/missing.ts:load()',
  S: 'method:src/shared.ts:OwnerA.save()',
  T: 'method:src/shared.ts:OwnerB.save()',
  N: 'function:src/noncanonical.ts:remove()',
  O: 'function:src/outside.ts:outside()',
  U: 'function:src/unknown.ts:unknown()',
});

const PATH = Object.freeze({
  A: 'src/same-a.ts',
  B: 'src/same-b.ts',
  M: 'src/missing.ts',
  S: 'src/shared.ts',
  T: 'src/shared.ts',
  N: 'src/noncanonical.ts',
  O: 'src/outside.ts',
});

const SOURCE_BY_PATH = Object.freeze({
  [PATH.A]: SAME,
  [PATH.B]: SAME,
  [PATH.M]: LOAD,
  [PATH.S]: SHARED_1,
  [PATH.N]: REMOVE,
  [PATH.O]: OUTSIDE,
});

function canonicalEntry(semanticSourceHash, overrides = {}) {
  const fields = {
    summary: 'Returns a local value.',
    tags: ['value'],
    semanticSourceHash,
    model: 'oracle-seed-model',
    generatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
  return { ...fields, languageAudit: auditSemanticCacheFields({ fields }) };
}

function makeFixture() {
  const noncanonical = canonicalEntry(H(REMOVE));
  noncanonical.summary = '移除条目。';

  return {
    requestedNodeIds: [ID.S, ID.A, ID.M, ID.A, ID.N, ID.U, ID.O, ID.B, ID.S, ID.B],
    nodes: [
      { id: ID.A, type: 'function', name: 'save', filePath: PATH.A, metadata: { owner: null } },
      { id: ID.B, type: 'function', name: 'save', filePath: PATH.B, metadata: { owner: null } },
      { id: ID.M, type: 'function', name: 'load', filePath: PATH.M, metadata: { owner: null } },
      { id: ID.S, type: 'method', name: 'save', filePath: PATH.S, metadata: { owner: 'OwnerA' } },
      { id: ID.T, type: 'method', name: 'save', filePath: PATH.T, metadata: { owner: 'OwnerB' } },
      { id: ID.N, type: 'function', name: 'remove', filePath: PATH.N, metadata: { owner: null } },
      { id: ID.O, type: 'function', name: 'outside', filePath: PATH.O, metadata: { owner: null } },
    ],
    manifestEntries: [
      { path: PATH.A, contentHash: H(SAME) },
      { path: PATH.B, contentHash: H(SAME) },
      { path: PATH.M, contentHash: H(LOAD) },
      { path: PATH.S, contentHash: H(SHARED_1) },
      { path: PATH.N, contentHash: H(REMOVE) },
    ],
    semanticCache: {
      version: SEMANTIC_CACHE_VERSION,
      contentLanguage: CANONICAL_CONTENT_LANGUAGE,
      entries: {
        [ID.A]: canonicalEntry(H(SAME)),
        [ID.B]: canonicalEntry(H(SAME)),
        [ID.S]: canonicalEntry(H(SHARED_0)),
        [ID.T]: canonicalEntry(H(SHARED_0)),
        [ID.N]: noncanonical,
        [ID.O]: canonicalEntry(H(OUTSIDE)),
        [ID.U]: canonicalEntry(H(SAME)),
      },
    },
  };
}

function expectedMatrix(fixture) {
  return {
    reuse: [
      { nodeId: ID.A, filePath: PATH.A, reason: 'fresh', summary: fixture.semanticCache.entries[ID.A].summary, tags: ['value'] },
      { nodeId: ID.B, filePath: PATH.B, reason: 'fresh', summary: fixture.semanticCache.entries[ID.B].summary, tags: ['value'] },
    ],
    generate: [
      { nodeId: ID.S, filePath: PATH.S, currentContentHash: H(SHARED_1), reason: 'stale' },
      { nodeId: ID.M, filePath: PATH.M, currentContentHash: H(LOAD), reason: 'missing' },
      { nodeId: ID.N, filePath: PATH.N, currentContentHash: H(REMOVE), reason: 'noncanonical-language' },
    ],
    unavailable: [
      { nodeId: ID.U, filePath: null, reason: 'unknown-node' },
      { nodeId: ID.O, filePath: PATH.O, reason: 'path-not-in-manifest' },
    ],
    counts: { requested: 7, reuse: 2, generate: 3, unavailable: 2 },
  };
}

function clone(value) {
  return structuredClone(value);
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function entryBytes(cache, nodeId) {
  return JSON.stringify(cache.entries[nodeId]);
}

function cacheBytes(cache, space = 2) {
  return JSON.stringify(cache, null, space);
}

function sha(value) {
  return H(typeof value === 'string' ? value : cacheBytes(value));
}

function assertPlan(plan, expected, uniqueRequestedNodeIds) {
  expect(plan).toEqual(expected);

  const allItems = [...plan.reuse, ...plan.generate, ...plan.unavailable];
  const allIds = allItems.map((item) => item.nodeId);
  for (const nodeId of uniqueRequestedNodeIds) {
    expect(allIds.filter((candidate) => candidate === nodeId), `${nodeId} must have exactly one terminal membership`).toHaveLength(1);
  }
  expect(new Set(allIds)).toEqual(new Set(uniqueRequestedNodeIds));
  expect(allIds).toHaveLength(uniqueRequestedNodeIds.length);
  expect(plan.counts.requested).toBe(
    plan.counts.reuse + plan.counts.generate + plan.counts.unavailable,
  );
}

function assertAllFreshEffects({
  generatorCalls,
  writerCalls,
  beforeCacheBytes,
  afterCacheBytes,
  beforeEntries,
  afterCache,
}) {
  expect(generatorCalls, 'all-fresh path must not call the generator').toEqual([]);
  expect(writerCalls, 'all-fresh path must not call the writer, including a no-op writer').toEqual([]);
  expect(afterCacheBytes, 'all-fresh cache bytes must remain identical').toBe(beforeCacheBytes);
  for (const [nodeId, bytes] of Object.entries(beforeEntries)) {
    expect(entryBytes(afterCache, nodeId), `${nodeId} provenance/content must remain byte-identical`).toBe(bytes);
  }
}

function assertClaimsSupported(claims, evidenceByNode) {
  for (const claim of claims) {
    const source = evidenceByNode.get(claim.nodeId) ?? '';
    expect(source.includes(claim.requiredSourceText), `unsupported cached claim: ${claim.text}`).toBe(true);
  }
}

function getPlanner() {
  expect(
    plannerImport.error,
    'missing production planner: add skills/excavator/semantic-cache-reuse.mjs exporting pure planSemanticCacheReuse',
  ).toBeNull();
  expect(plannerImport.module?.planSemanticCacheReuse).toBeTypeOf('function');
  return plannerImport.module.planSemanticCacheReuse;
}

async function executeSimulatedAnswer({
  plan,
  semanticCache,
  verifySource,
  generate,
  write,
  candidateClaims = [],
}) {
  const evidenceByNode = new Map();
  for (const item of [...plan.reuse, ...plan.generate]) {
    evidenceByNode.set(item.nodeId, await verifySource(item));
  }

  for (const item of plan.generate) {
    const fields = await generate(item, evidenceByNode.get(item.nodeId));
    await write(item, fields);
  }

  const verifiedClaims = candidateClaims.filter((claim) => (
    (evidenceByNode.get(claim.nodeId) ?? '').includes(claim.requiredSourceText)
  ));
  assertClaimsSupported(verifiedClaims, evidenceByNode);
  return { semanticCache, evidenceByNode, verifiedClaims };
}

describe('semantic-cache reuse — known-false controls prove the oracle can fail', () => {
  it('accepts every manufactured canonical seed before using it as fresh', () => {
    const fixture = makeFixture();
    for (const nodeId of [ID.A, ID.B, ID.S, ID.T, ID.O, ID.U]) {
      expect(fixture.semanticCache.entries[nodeId].languageAudit).toMatchObject({
        status: 'accepted',
        rejected: [],
      });
    }
  });

  it('rejects an omitted unknown node instead of accepting a hidden fourth state', () => {
    const fixture = makeFixture();
    const falsePlan = expectedMatrix(fixture);
    falsePlan.unavailable = falsePlan.unavailable.filter((item) => item.nodeId !== ID.U);
    falsePlan.counts.unavailable = 1;
    falsePlan.counts.requested = 6;

    expect(() => assertPlan(falsePlan, expectedMatrix(fixture), [ID.S, ID.A, ID.M, ID.N, ID.U, ID.O, ID.B])).toThrow();
  });

  it('rejects duplicate membership across terminal buckets', () => {
    const fixture = makeFixture();
    const falsePlan = expectedMatrix(fixture);
    falsePlan.generate.push({ nodeId: ID.A, filePath: PATH.A, currentContentHash: H(SAME), reason: 'missing' });
    falsePlan.counts.generate += 1;

    expect(() => assertPlan(falsePlan, expectedMatrix(fixture), [ID.S, ID.A, ID.M, ID.N, ID.U, ID.O, ID.B])).toThrow();
  });

  it('rejects a wrong stale reason', () => {
    const fixture = makeFixture();
    const falsePlan = expectedMatrix(fixture);
    falsePlan.generate[0].reason = 'missing';

    expect(() => assertPlan(falsePlan, expectedMatrix(fixture), [ID.S, ID.A, ID.M, ID.N, ID.U, ID.O, ID.B])).toThrow();
  });

  it('rejects identity collapse for same-content same-name nodes', () => {
    const fixture = makeFixture();
    const expected = {
      reuse: expectedMatrix(fixture).reuse,
      generate: [],
      unavailable: [],
      counts: { requested: 2, reuse: 2, generate: 0, unavailable: 0 },
    };
    const collapsed = {
      reuse: [expected.reuse[0]],
      generate: [],
      unavailable: [],
      counts: { requested: 1, reuse: 1, generate: 0, unavailable: 0 },
    };

    expect(() => assertPlan(collapsed, expected, [ID.A, ID.B])).toThrow();
  });

  it('rejects even one accidental generator call on an all-fresh path', () => {
    const fixture = makeFixture();
    const before = cacheBytes(fixture.semanticCache);
    expect(() => assertAllFreshEffects({
      generatorCalls: [ID.A],
      writerCalls: [],
      beforeCacheBytes: before,
      afterCacheBytes: before,
      beforeEntries: { [ID.A]: entryBytes(fixture.semanticCache, ID.A) },
      afterCache: fixture.semanticCache,
    })).toThrow();
  });

  it('rejects even one no-op writer call on an all-fresh path', () => {
    const fixture = makeFixture();
    const before = cacheBytes(fixture.semanticCache);
    const noOpWriter = vi.fn(() => ({ ok: false, status: 'lock-held' }));
    noOpWriter(ID.A);

    expect(() => assertAllFreshEffects({
      generatorCalls: [],
      writerCalls: noOpWriter.mock.calls.map(([nodeId]) => nodeId),
      beforeCacheBytes: before,
      afterCacheBytes: before,
      beforeEntries: { [ID.A]: entryBytes(fixture.semanticCache, ID.A) },
      afterCache: fixture.semanticCache,
    })).toThrow();
  });

  it('rejects provenance-only edits and whitespace-only cache rewrites', () => {
    const fixture = makeFixture();
    const before = cacheBytes(fixture.semanticCache);
    const beforeEntries = { [ID.A]: entryBytes(fixture.semanticCache, ID.A) };

    const provenanceEdit = clone(fixture.semanticCache);
    provenanceEdit.entries[ID.A].generatedAt = '2026-09-15T00:00:00.000Z';
    expect(() => assertAllFreshEffects({
      generatorCalls: [], writerCalls: [], beforeCacheBytes: before,
      afterCacheBytes: cacheBytes(provenanceEdit), beforeEntries, afterCache: provenanceEdit,
    })).toThrow();

    expect(() => assertAllFreshEffects({
      generatorCalls: [], writerCalls: [], beforeCacheBytes: before,
      afterCacheBytes: cacheBytes(fixture.semanticCache, 4), beforeEntries, afterCache: fixture.semanticCache,
    })).toThrow();
  });

  it('rejects an unsupported cached email claim against current source', () => {
    const claims = [{
      nodeId: ID.A,
      text: 'save sends an email before saving.',
      requiredSourceText: 'email',
    }];
    expect(() => assertClaimsSupported(claims, new Map([[ID.A, SAME]]))).toThrow();
  });
});

describe('semantic-cache reuse — future planner and simulated execution contract', () => {
  it('plans the exact duplicate/fresh/missing/stale/noncanonical/unavailable matrix', () => {
    const fixture = makeFixture();
    const plan = getPlanner()({
      requestedNodeIds: fixture.requestedNodeIds,
      nodes: fixture.nodes,
      manifestEntries: fixture.manifestEntries,
      semanticCache: fixture.semanticCache,
    });

    assertPlan(plan, expectedMatrix(fixture), [ID.S, ID.A, ID.M, ID.N, ID.U, ID.O, ID.B]);
    expect(plan.generate[0].currentContentHash).toBe(H(SHARED_1));
    expect(plan.reuse.some((item) => item.nodeId === ID.T)).toBe(false);
  });

  it('executes an all-fresh need set with verification but zero generation/write/rewrite', async () => {
    const fixture = makeFixture();
    const misleadingFields = {
      summary: 'Sends an email before saving.',
      tags: ['email', 'save'],
      semanticSourceHash: H(SAME),
      model: 'oracle-misleading-model',
      generatedAt: '2026-09-02T00:00:00.000Z',
    };
    fixture.semanticCache.entries[ID.A] = {
      ...misleadingFields,
      languageAudit: auditSemanticCacheFields({ fields: misleadingFields }),
    };
    const beforeCacheBytes = cacheBytes(fixture.semanticCache);
    const beforeSha = sha(beforeCacheBytes);
    const beforeEntries = Object.fromEntries(
      Object.keys(fixture.semanticCache.entries).map((nodeId) => [nodeId, entryBytes(fixture.semanticCache, nodeId)]),
    );

    const plan = getPlanner()({
      requestedNodeIds: [ID.B, ID.A, ID.B],
      nodes: fixture.nodes,
      manifestEntries: fixture.manifestEntries,
      semanticCache: fixture.semanticCache,
    });
    expect(plan).toEqual({
      reuse: [
        { nodeId: ID.B, filePath: PATH.B, reason: 'fresh', summary: 'Returns a local value.', tags: ['value'] },
        { nodeId: ID.A, filePath: PATH.A, reason: 'fresh', summary: misleadingFields.summary, tags: misleadingFields.tags },
      ],
      generate: [],
      unavailable: [],
      counts: { requested: 2, reuse: 2, generate: 0, unavailable: 0 },
    });

    const events = [];
    const generator = vi.fn();
    const writer = vi.fn();
    const result = await executeSimulatedAnswer({
      plan,
      semanticCache: fixture.semanticCache,
      verifySource: async (item) => {
        events.push(`verify:${item.nodeId}`);
        return SOURCE_BY_PATH[item.filePath];
      },
      generate: generator,
      write: writer,
      candidateClaims: [
        { nodeId: ID.A, text: 'save sends an email.', requiredSourceText: 'email' },
        { nodeId: ID.A, text: 'save returns 1.', requiredSourceText: 'return 1' },
      ],
    });

    expect(events).toEqual([`verify:${ID.B}`, `verify:${ID.A}`]);
    expect(result.verifiedClaims.map((claim) => claim.text)).toEqual(['save returns 1.']);
    assertAllFreshEffects({
      generatorCalls: generator.mock.calls,
      writerCalls: writer.mock.calls,
      beforeCacheBytes,
      afterCacheBytes: cacheBytes(fixture.semanticCache),
      beforeEntries,
      afterCache: fixture.semanticCache,
    });
    expect(sha(cacheBytes(fixture.semanticCache))).toBe(beforeSha);
  });

  it('generates only the overlap difference, preserves the intersection, then fully reuses', async () => {
    const fixture = makeFixture();
    fixture.semanticCache.entries = {
      [ID.A]: canonicalEntry(H(SAME)),
      [ID.B]: canonicalEntry(H(SAME)),
      [ID.T]: canonicalEntry(H(SHARED_1)),
    };
    const preserved = Object.fromEntries(
      [ID.A, ID.B, ID.T].map((nodeId) => [nodeId, entryBytes(fixture.semanticCache, nodeId)]),
    );
    const beforeSha = sha(fixture.semanticCache);
    const generator = vi.fn(async (item) => ({
      summary: 'Loads a local value.',
      tags: ['value'],
      semanticSourceHash: item.currentContentHash,
      model: 'oracle-generated-model',
      generatedAt: '2026-09-15T00:00:00.000Z',
    }));
    const writer = vi.fn(async (item, fields) => {
      fixture.semanticCache.entries[item.nodeId] = {
        ...fields,
        languageAudit: auditSemanticCacheFields({ fields }),
      };
      return { ok: true, status: 'committed' };
    });

    const firstPlan = getPlanner()({
      requestedNodeIds: [ID.B, ID.M, ID.A, ID.M],
      nodes: fixture.nodes,
      manifestEntries: fixture.manifestEntries,
      semanticCache: fixture.semanticCache,
    });
    expect(firstPlan).toEqual({
      reuse: [
        { nodeId: ID.B, filePath: PATH.B, reason: 'fresh', summary: 'Returns a local value.', tags: ['value'] },
        { nodeId: ID.A, filePath: PATH.A, reason: 'fresh', summary: 'Returns a local value.', tags: ['value'] },
      ],
      generate: [{ nodeId: ID.M, filePath: PATH.M, currentContentHash: H(LOAD), reason: 'missing' }],
      unavailable: [],
      counts: { requested: 3, reuse: 2, generate: 1, unavailable: 0 },
    });

    await executeSimulatedAnswer({
      plan: firstPlan,
      semanticCache: fixture.semanticCache,
      verifySource: async (item) => SOURCE_BY_PATH[item.filePath],
      generate: generator,
      write: writer,
    });

    expect(generator.mock.calls.map(([item]) => item.nodeId)).toEqual([ID.M]);
    expect(writer.mock.calls.map(([item]) => item.nodeId)).toEqual([ID.M]);
    expect(Object.keys(fixture.semanticCache.entries)).toEqual([ID.A, ID.B, ID.T, ID.M]);
    for (const nodeId of [ID.A, ID.B, ID.T]) {
      expect(entryBytes(fixture.semanticCache, nodeId)).toBe(preserved[nodeId]);
    }
    expect(sha(fixture.semanticCache)).not.toBe(beforeSha);

    generator.mockClear();
    writer.mockClear();
    const stableSha = sha(fixture.semanticCache);
    const repeatPlan = getPlanner()({
      requestedNodeIds: [ID.B, ID.M, ID.A, ID.M],
      nodes: fixture.nodes,
      manifestEntries: fixture.manifestEntries,
      semanticCache: fixture.semanticCache,
    });
    expect(repeatPlan.generate).toEqual([]);
    expect(repeatPlan.reuse.map((item) => item.nodeId)).toEqual([ID.B, ID.M, ID.A]);
    expect(repeatPlan.reuse.find((item) => item.nodeId === ID.M)).toMatchObject({
      reason: 'fresh',
      summary: 'Loads a local value.',
      tags: ['value'],
    });
    await executeSimulatedAnswer({
      plan: repeatPlan,
      semanticCache: fixture.semanticCache,
      verifySource: async (item) => SOURCE_BY_PATH[item.filePath],
      generate: generator,
      write: writer,
    });
    expect(generator).not.toHaveBeenCalled();
    expect(writer).not.toHaveBeenCalled();
    expect(sha(fixture.semanticCache)).toBe(stableSha);
  });

  it('is stable under storage reordering and never mutates deeply frozen inputs', () => {
    const fixture = makeFixture();
    const input = deepFreeze({
      requestedNodeIds: clone(fixture.requestedNodeIds),
      nodes: clone(fixture.nodes),
      manifestEntries: clone(fixture.manifestEntries),
      semanticCache: clone(fixture.semanticCache),
    });
    const before = clone(input);
    const planner = getPlanner();
    const first = planner(input);
    expect(input).toEqual(before);

    const reordered = deepFreeze({
      requestedNodeIds: clone(fixture.requestedNodeIds),
      nodes: clone(fixture.nodes).reverse(),
      manifestEntries: clone(fixture.manifestEntries).reverse(),
      semanticCache: {
        ...clone(fixture.semanticCache),
        entries: Object.fromEntries(Object.entries(clone(fixture.semanticCache.entries)).reverse()),
      },
    });
    const reorderedBefore = clone(reordered);
    const second = planner(reordered);

    expect(second).toEqual(first);
    expect(reordered).toEqual(reorderedBefore);
  });
});
