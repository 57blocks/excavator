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
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { auditSemanticCacheFields } from '../../skills/excavator/semantic-language-audit.mjs';
import {
  commitSemanticCacheEntry,
  readSemanticCache,
} from '../../skills/excavator/semantic-cache.mjs';

// Exact cache identity frozen by acceptance-oracle.md. Planner expectations
// keep these fixture values explicit; the disk integration below separately
// imports the existing writer to exercise its real CAS gate.
const SEMANTIC_CACHE_VERSION = '2.0.0';
const CANONICAL_CONTENT_LANGUAGE = 'en';
const CLI_PATH = resolve(process.cwd(), 'skills/excavator/semantic-cache-reuse.mjs');

const plannerImport = await import('../../skills/excavator/semantic-cache-reuse.mjs')
  .then((module) => ({ module, error: null }))
  .catch((error) => ({ module: null, error }));

const SAME = 'export function save() { return 1; }\n';
const LOAD = 'export function load() { return 3; }\n';
const REMOVE = 'export function remove() { return 4; }\n';
const OUTSIDE = 'export function outside() { return 5; }\n';
const SHARED_0 = 'export class OwnerA { save() { return 0; } }\nexport class OwnerB { save() { return 2; } }\n';
const SHARED_1 = 'export class OwnerA { save() { return 1; } }\nexport class OwnerB { save() { return 2; } }\n';
const SHARED_2 = 'export class OwnerA { save() { return 10; } }\nexport class OwnerB { save() { return 2; } }\n';
const SHARED_3 = 'export class OwnerA { save() { return 20; } }\nexport class OwnerB { save() { return 2; } }\n';

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

function makeCliProject(fixture = makeFixture(), { cache = fixture.semanticCache } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'excavator-semantic-reuse-'));
  const dataDir = join(root, '.excavator');
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(
    join(dataDir, 'knowledge-graph.json'),
    JSON.stringify({ version: '1.0.0', nodes: fixture.nodes, edges: [] }, null, 2),
    'utf-8',
  );
  writeFileSync(
    join(dataDir, 'source-manifest.json'),
    JSON.stringify({ sourceRevision: 'directory:oracle', entries: fixture.manifestEntries }, null, 2),
    'utf-8',
  );
  if (cache !== null) {
    writeFileSync(join(dataDir, 'semantic-cache.json'), JSON.stringify(cache, null, 2), 'utf-8');
  }
  return root;
}

function snapshotFiles(root) {
  const snapshot = {};
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else snapshot[relative(root, path)] = readFileSync(path).toString('hex');
    }
  };
  visit(root);
  return snapshot;
}

function runCli(root, nodeIds) {
  return spawnSync(
    process.execPath,
    [CLI_PATH, root, ...nodeIds.flatMap((nodeId) => ['--node-id', nodeId])],
    { cwd: root, encoding: 'utf-8' },
  );
}

function runCliReadOnly(root, nodeIds) {
  const before = snapshotFiles(root);
  const result = runCli(root, nodeIds);
  expect(snapshotFiles(root), `CLI changed project files: ${result.stderr}`).toEqual(before);
  expect(
    Object.keys(before).some((path) => /semantic\.lock|\.tmp-|telemetry|lastUsedAt|hitCount/.test(path)),
  ).toBe(false);
  return result;
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

function writeIntegrationManifest(root, sharedSource) {
  const manifest = {
    sourceRevision: `directory:${H(sharedSource)}`,
    entries: [
      { path: PATH.A, contentHash: H(SAME) },
      { path: PATH.B, contentHash: H(SAME) },
      { path: PATH.S, contentHash: H(sharedSource) },
    ],
  };
  writeFileSync(
    join(root, '.excavator', 'source-manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf-8',
  );
  return manifest;
}

async function makeIntegrationProject() {
  const root = mkdtempSync(join(tmpdir(), 'excavator-semantic-reuse-integration-'));
  const dataDir = join(root, '.excavator');
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(root, PATH.A), SAME, 'utf-8');
  writeFileSync(join(root, PATH.B), SAME, 'utf-8');
  writeFileSync(join(root, PATH.S), SHARED_1, 'utf-8');

  const nodes = makeFixture().nodes.filter((node) => [ID.A, ID.B, ID.S, ID.T].includes(node.id));
  const graphRaw = JSON.stringify({
    version: '1.0.0',
    nodes: nodes.map((node) => ({ ...node, lineRange: { start: 1, end: node.filePath === PATH.S ? 2 : 1 } })),
    edges: [],
  }, null, 2);
  writeFileSync(join(dataDir, 'knowledge-graph.json'), graphRaw, 'utf-8');
  writeIntegrationManifest(root, SHARED_1);

  const seeds = [
    [ID.A, PATH.A, H(SAME), 'save returns one from the local source.'],
    [ID.B, PATH.B, H(SAME), 'save returns one from the local source.'],
    [ID.S, PATH.S, H(SHARED_1), 'OwnerA.save returns one from the shared source.'],
    [ID.T, PATH.T, H(SHARED_1), 'OwnerB.save returns two from the shared source.'],
  ];
  for (const [nodeId, filePath, semanticSourceHash, summary] of seeds) {
    const result = await commitSemanticCacheEntry({
      projectRoot: root,
      nodeId,
      filePath,
      fields: {
        summary,
        tags: ['local', 'value'],
        semanticSourceHash,
        model: 'integration-seed-model',
        generatedAt: '2026-09-01T00:00:00.000Z',
      },
    });
    if (!result.ok) throw new Error(`failed to seed ${nodeId}: ${JSON.stringify(result)}`);
  }
  if (readFileSync(join(dataDir, 'knowledge-graph.json'), 'utf-8') !== graphRaw) {
    throw new Error('semantic-cache seed changed knowledge-graph.json');
  }
  return { root, dataDir, nodes, graphRaw };
}

async function planFromIntegrationDisk(root, requestedNodeIds) {
  const dataDir = join(root, '.excavator');
  const graph = JSON.parse(readFileSync(join(dataDir, 'knowledge-graph.json'), 'utf-8'));
  const manifest = JSON.parse(readFileSync(join(dataDir, 'source-manifest.json'), 'utf-8'));
  const semanticCache = await readSemanticCache(root);
  return getPlanner()({
    requestedNodeIds,
    nodes: graph.nodes,
    manifestEntries: manifest.entries,
    semanticCache,
  });
}

async function executeIntegrationPlan({ root, plan, verifier, generator, writer, beforeWrite = null }) {
  const evidenceByNode = new Map();
  for (const item of [...plan.reuse, ...plan.generate]) {
    evidenceByNode.set(item.nodeId, await verifier(item));
  }

  const answers = [];
  const commits = [];
  for (const item of plan.generate) {
    const evidence = evidenceByNode.get(item.nodeId);
    if (!evidence?.fullLocalSourceVerified) {
      answers.push({ nodeId: item.nodeId, status: 'verification-failed' });
      continue;
    }
    const fields = await generator(item, evidence);
    if (beforeWrite) await beforeWrite(item, fields, evidence);
    const result = await writer({
      projectRoot: root,
      nodeId: item.nodeId,
      filePath: item.filePath,
      fields,
    });
    commits.push({ nodeId: item.nodeId, result });
    answers.push({
      nodeId: item.nodeId,
      summary: fields.summary,
      sourceHash: evidence.sourceHash,
      cacheStatus: result.status,
    });
  }
  return { answers, commits, evidenceByNode };
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
  it('handles empty input and preserves exact same-name identities in first-occurrence order', () => {
    const fixture = makeFixture();
    const planner = getPlanner();
    expect(planner({
      requestedNodeIds: [],
      nodes: fixture.nodes,
      manifestEntries: fixture.manifestEntries,
      semanticCache: fixture.semanticCache,
    })).toEqual({
      reuse: [], generate: [], unavailable: [],
      counts: { requested: 0, reuse: 0, generate: 0, unavailable: 0 },
    });

    fixture.semanticCache.entries[ID.S] = canonicalEntry(H(SHARED_1));
    fixture.semanticCache.entries[ID.T] = canonicalEntry(H(SHARED_1));
    const owners = planner({
      requestedNodeIds: [ID.T, ID.S, ID.T],
      nodes: fixture.nodes,
      manifestEntries: fixture.manifestEntries,
      semanticCache: fixture.semanticCache,
    });
    expect(owners.reuse.map((item) => item.nodeId)).toEqual([ID.T, ID.S]);
    expect(owners.counts).toEqual({ requested: 2, reuse: 2, generate: 0, unavailable: 0 });

    const sameContent = planner({
      requestedNodeIds: [ID.A, ID.B, ID.A],
      nodes: fixture.nodes,
      manifestEntries: fixture.manifestEntries,
      semanticCache: fixture.semanticCache,
    });
    expect(sameContent.reuse.map((item) => item.nodeId)).toEqual([ID.A, ID.B]);
    expect(sameContent.counts).toEqual({ requested: 2, reuse: 2, generate: 0, unavailable: 0 });
  });

  it('uses the shared canonical gate and keeps missing-entry precedence under bad cache identity', () => {
    const fixture = makeFixture();
    const planner = getPlanner();
    const invalidCaches = [
      (() => { const cache = clone(fixture.semanticCache); delete cache.contentLanguage; return cache; })(),
      { ...clone(fixture.semanticCache), contentLanguage: 'zh' },
      { ...clone(fixture.semanticCache), version: '1.0.0' },
    ];

    for (const semanticCache of invalidCaches) {
      const plan = planner({
        requestedNodeIds: [ID.A, ID.M],
        nodes: fixture.nodes,
        manifestEntries: fixture.manifestEntries,
        semanticCache,
      });
      expect(plan).toEqual({
        reuse: [],
        generate: [
          { nodeId: ID.A, filePath: PATH.A, currentContentHash: H(SAME), reason: 'noncanonical-language' },
          { nodeId: ID.M, filePath: PATH.M, currentContentHash: H(LOAD), reason: 'missing' },
        ],
        unavailable: [],
        counts: { requested: 2, reuse: 0, generate: 2, unavailable: 0 },
      });
    }
  });

  it('classifies malformed, unaudited, and post-audit-mutated entries as noncanonical', () => {
    const fixture = makeFixture();
    const planner = getPlanner();
    const base = fixture.semanticCache.entries[ID.A];
    const malformedEntries = [
      (() => { const entry = clone(base); delete entry.languageAudit; return entry; })(),
      {
        ...clone(base),
        languageAudit: { status: 'accepted', inspected: 2, accepted: [], rejected: [] },
      },
      { ...clone(base), summary: 'Returns a different local value.' },
      { ...clone(base), summary: { text: 'Returns a local value.' } },
    ];

    for (const entry of malformedEntries) {
      const semanticCache = clone(fixture.semanticCache);
      semanticCache.entries[ID.A] = entry;
      const plan = planner({
        requestedNodeIds: [ID.A],
        nodes: fixture.nodes,
        manifestEntries: fixture.manifestEntries,
        semanticCache,
      });
      expect(plan.generate).toEqual([{
        nodeId: ID.A,
        filePath: PATH.A,
        currentContentHash: H(SAME),
        reason: 'noncanonical-language',
      }]);
    }

    const staleAndUnaudited = clone(fixture.semanticCache);
    delete staleAndUnaudited.entries[ID.S].languageAudit;
    const precedence = planner({
      requestedNodeIds: [ID.S],
      nodes: fixture.nodes,
      manifestEntries: fixture.manifestEntries,
      semanticCache: staleAndUnaudited,
    });
    expect(precedence.generate[0].reason).toBe('noncanonical-language');
  });

  it('treats an entry without semanticSourceHash as missing', () => {
    const fixture = makeFixture();
    delete fixture.semanticCache.entries[ID.A].semanticSourceHash;
    const plan = getPlanner()({
      requestedNodeIds: [ID.A],
      nodes: fixture.nodes,
      manifestEntries: fixture.manifestEntries,
      semanticCache: fixture.semanticCache,
    });
    expect(plan.generate).toEqual([{
      nodeId: ID.A,
      filePath: PATH.A,
      currentContentHash: H(SAME),
      reason: 'missing',
    }]);
  });

  it('invalidates every requested node in one changed file and no unchanged-file node', () => {
    const fixture = makeFixture();
    fixture.semanticCache.entries[ID.S] = canonicalEntry(H(SHARED_1));
    fixture.semanticCache.entries[ID.T] = canonicalEntry(H(SHARED_1));
    fixture.manifestEntries.find((entry) => entry.path === PATH.S).contentHash = H(SHARED_2);
    const before = clone(fixture);
    const planner = getPlanner();

    const oneOwner = planner({
      requestedNodeIds: [ID.S, ID.B],
      nodes: fixture.nodes,
      manifestEntries: fixture.manifestEntries,
      semanticCache: fixture.semanticCache,
    });
    expect(oneOwner.reuse.map((item) => item.nodeId)).toEqual([ID.B]);
    expect(oneOwner.generate).toEqual([{
      nodeId: ID.S, filePath: PATH.S, currentContentHash: H(SHARED_2), reason: 'stale',
    }]);
    expect(oneOwner.counts).toEqual({ requested: 2, reuse: 1, generate: 1, unavailable: 0 });

    const bothOwners = planner({
      requestedNodeIds: [ID.T, ID.B, ID.S],
      nodes: fixture.nodes,
      manifestEntries: fixture.manifestEntries,
      semanticCache: fixture.semanticCache,
    });
    expect(bothOwners.reuse.map((item) => item.nodeId)).toEqual([ID.B]);
    expect(bothOwners.generate.map((item) => [item.nodeId, item.reason])).toEqual([
      [ID.T, 'stale'],
      [ID.S, 'stale'],
    ]);
    expect(fixture).toEqual(before);
  });

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

describe('semantic-cache reuse — disk integration through verification and existing CAS writer', () => {
  it('regenerates every needed node in one changed file, preserves unchanged entries, then fully reuses', async () => {
    const project = await makeIntegrationProject();
    const { root, dataDir, graphRaw } = project;
    const graphPath = join(dataDir, 'knowledge-graph.json');
    const cachePath = join(dataDir, 'semantic-cache.json');
    const graphSha = H(graphRaw);

    try {
      const cacheBeforeRaw = readFileSync(cachePath, 'utf-8');
      const cacheBefore = JSON.parse(cacheBeforeRaw);
      const entriesBefore = Object.fromEntries(
        Object.keys(cacheBefore.entries).map((nodeId) => [nodeId, entryBytes(cacheBefore, nodeId)]),
      );

      writeFileSync(join(root, PATH.S), SHARED_2, 'utf-8');
      writeIntegrationManifest(root, SHARED_2);
      const plan = await planFromIntegrationDisk(root, [ID.T, ID.B, ID.S, ID.T]);
      expect(plan).toEqual({
        reuse: [{
          nodeId: ID.B,
          filePath: PATH.B,
          reason: 'fresh',
          summary: 'save returns one from the local source.',
          tags: ['local', 'value'],
        }],
        generate: [
          { nodeId: ID.T, filePath: PATH.T, currentContentHash: H(SHARED_2), reason: 'stale' },
          { nodeId: ID.S, filePath: PATH.S, currentContentHash: H(SHARED_2), reason: 'stale' },
        ],
        unavailable: [],
        counts: { requested: 3, reuse: 1, generate: 2, unavailable: 0 },
      });

      const verifier = vi.fn(async (item) => {
        const sourceBytes = readFileSync(join(root, item.filePath));
        const source = sourceBytes.toString('utf-8');
        const manifest = JSON.parse(readFileSync(join(dataDir, 'source-manifest.json'), 'utf-8'));
        const manifestHash = manifest.entries.find((entry) => entry.path === item.filePath)?.contentHash;
        expect(H(sourceBytes)).toBe(manifestHash);
        return {
          fullLocalSourceVerified: true,
          source,
          sourceBytes: sourceBytes.length,
          sourceHash: manifestHash,
        };
      });
      const generator = vi.fn(async (item, evidence) => {
        const owner = item.nodeId === ID.S ? 'OwnerA' : 'OwnerB';
        const ownerLine = evidence.source.split('\n').find((line) => line.includes(`class ${owner}`));
        const returnValue = ownerLine?.match(/return (\d+)/)?.[1];
        expect(returnValue).toMatch(/^\d+$/);
        return {
          summary: `${owner}.save returns ${returnValue} from the verified local source.`,
          tags: [owner, 'save'],
          semanticSourceHash: item.currentContentHash,
          model: 'integration-generate-model',
          generatedAt: '2026-09-15T01:00:00.000Z',
        };
      });
      const writer = vi.fn((args) => commitSemanticCacheEntry(args));

      const execution = await executeIntegrationPlan({ root, plan, verifier, generator, writer });
      expect(verifier.mock.calls.map(([item]) => item.nodeId)).toEqual([ID.B, ID.T, ID.S]);
      expect(generator.mock.calls.map(([item]) => item.nodeId)).toEqual([ID.T, ID.S]);
      expect(writer.mock.calls.map(([args]) => args.nodeId)).toEqual([ID.T, ID.S]);
      expect(execution.commits.map(({ nodeId, result }) => [nodeId, result.ok, result.status])).toEqual([
        [ID.T, true, 'committed'],
        [ID.S, true, 'committed'],
      ]);
      expect(execution.answers.map(({ nodeId, cacheStatus }) => [nodeId, cacheStatus])).toEqual([
        [ID.T, 'committed'],
        [ID.S, 'committed'],
      ]);

      const cacheAfterRaw = readFileSync(cachePath, 'utf-8');
      const cacheAfter = JSON.parse(cacheAfterRaw);
      expect(cacheAfterRaw).not.toBe(cacheBeforeRaw);
      expect(H(cacheAfterRaw)).not.toBe(H(cacheBeforeRaw));
      expect(Object.keys(cacheAfter.entries).sort()).toEqual([ID.A, ID.B, ID.S, ID.T].sort());
      for (const nodeId of [ID.A, ID.B]) {
        expect(entryBytes(cacheAfter, nodeId), `${nodeId} must stay byte-identical`).toBe(entriesBefore[nodeId]);
      }
      for (const nodeId of [ID.T, ID.S]) {
        expect(entryBytes(cacheAfter, nodeId)).not.toBe(entriesBefore[nodeId]);
        expect(cacheAfter.entries[nodeId]).toMatchObject({
          semanticSourceHash: H(SHARED_2),
          model: 'integration-generate-model',
          generatedAt: '2026-09-15T01:00:00.000Z',
          languageAudit: { status: 'accepted', rejected: [] },
        });
      }
      expect(readFileSync(graphPath, 'utf-8')).toBe(graphRaw);
      expect(H(readFileSync(graphPath))).toBe(graphSha);
      expect(existsSync(join(dataDir, 'semantic.lock'))).toBe(false);

      const afterEntries = Object.fromEntries(
        Object.keys(cacheAfter.entries).map((nodeId) => [nodeId, entryBytes(cacheAfter, nodeId)]),
      );
      const stableCacheRaw = cacheAfterRaw;
      generator.mockClear();
      writer.mockClear();
      verifier.mockClear();
      const repeatPlan = await planFromIntegrationDisk(root, [ID.T, ID.B, ID.S, ID.T]);
      expect(repeatPlan.generate).toEqual([]);
      expect(repeatPlan.reuse.map((item) => item.nodeId)).toEqual([ID.T, ID.B, ID.S]);
      const repeat = await executeIntegrationPlan({ root, plan: repeatPlan, verifier, generator, writer });
      expect(repeat.evidenceByNode.size).toBe(3);
      expect(verifier.mock.calls.map(([item]) => item.nodeId)).toEqual([ID.T, ID.B, ID.S]);
      expect(generator).not.toHaveBeenCalled();
      expect(writer).not.toHaveBeenCalled();
      expect(readFileSync(cachePath, 'utf-8')).toBe(stableCacheRaw);
      expect(H(readFileSync(cachePath))).toBe(H(stableCacheRaw));
      const repeatedCache = JSON.parse(readFileSync(cachePath, 'utf-8'));
      for (const [nodeId, bytes] of Object.entries(afterEntries)) {
        expect(entryBytes(repeatedCache, nodeId)).toBe(bytes);
      }
      expect(readFileSync(graphPath, 'utf-8')).toBe(graphRaw);
      expect(H(readFileSync(graphPath))).toBe(graphSha);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns the verified answer summary when post-plan source drift makes the existing CAS reject', async () => {
    const project = await makeIntegrationProject();
    const { root, dataDir, graphRaw } = project;
    const graphPath = join(dataDir, 'knowledge-graph.json');
    const cachePath = join(dataDir, 'semantic-cache.json');
    const graphSha = H(graphRaw);

    try {
      writeFileSync(join(root, PATH.S), SHARED_2, 'utf-8');
      writeIntegrationManifest(root, SHARED_2);
      const plan = await planFromIntegrationDisk(root, [ID.S]);
      expect(plan.generate).toEqual([{
        nodeId: ID.S,
        filePath: PATH.S,
        currentContentHash: H(SHARED_2),
        reason: 'stale',
      }]);

      const cacheBeforeRaw = readFileSync(cachePath, 'utf-8');
      const cacheBefore = JSON.parse(cacheBeforeRaw);
      const entriesBefore = Object.fromEntries(
        Object.keys(cacheBefore.entries).map((nodeId) => [nodeId, entryBytes(cacheBefore, nodeId)]),
      );
      const verifier = vi.fn(async (item) => {
        const sourceBytes = readFileSync(join(root, item.filePath));
        expect(sourceBytes.toString('utf-8')).toBe(SHARED_2);
        expect(H(sourceBytes)).toBe(item.currentContentHash);
        return {
          fullLocalSourceVerified: true,
          source: sourceBytes.toString('utf-8'),
          sourceBytes: sourceBytes.length,
          sourceHash: H(sourceBytes),
        };
      });
      const generator = vi.fn(async (item, evidence) => {
        expect(evidence.source).toContain('return 10');
        return {
          summary: 'OwnerA.save returns 10 from the verified local source.',
          tags: ['OwnerA', 'save'],
          semanticSourceHash: item.currentContentHash,
          model: 'integration-drift-model',
          generatedAt: '2026-09-15T02:00:00.000Z',
        };
      });
      const writer = vi.fn((args) => commitSemanticCacheEntry(args));
      const beforeWrite = vi.fn(async () => {
        writeFileSync(join(root, PATH.S), SHARED_3, 'utf-8');
        writeIntegrationManifest(root, SHARED_3);
      });

      const execution = await executeIntegrationPlan({
        root, plan, verifier, generator, writer, beforeWrite,
      });
      expect(verifier).toHaveBeenCalledTimes(1);
      expect(generator.mock.calls.map(([item]) => item.nodeId)).toEqual([ID.S]);
      expect(writer.mock.calls.map(([args]) => args.nodeId)).toEqual([ID.S]);
      expect(beforeWrite).toHaveBeenCalledTimes(1);
      expect(execution.commits).toEqual([{
        nodeId: ID.S,
        result: { ok: false, status: 'stale-hash', currentSourceHash: H(SHARED_3) },
      }]);
      expect(execution.answers).toEqual([{
        nodeId: ID.S,
        summary: 'OwnerA.save returns 10 from the verified local source.',
        sourceHash: H(SHARED_2),
        cacheStatus: 'stale-hash',
      }]);

      expect(readFileSync(cachePath, 'utf-8')).toBe(cacheBeforeRaw);
      expect(H(readFileSync(cachePath))).toBe(H(cacheBeforeRaw));
      const cacheAfter = JSON.parse(readFileSync(cachePath, 'utf-8'));
      for (const [nodeId, bytes] of Object.entries(entriesBefore)) {
        expect(entryBytes(cacheAfter, nodeId)).toBe(bytes);
      }
      expect(readFileSync(graphPath, 'utf-8')).toBe(graphRaw);
      expect(H(readFileSync(graphPath))).toBe(graphSha);
      expect(existsSync(join(dataDir, 'semantic.lock'))).toBe(false);

      const replan = await planFromIntegrationDisk(root, [ID.S]);
      expect(replan.reuse).toEqual([]);
      expect(replan.generate).toEqual([{
        nodeId: ID.S,
        filePath: PATH.S,
        currentContentHash: H(SHARED_3),
        reason: 'stale',
      }]);
      expect(readFileSync(join(root, PATH.S), 'utf-8')).toBe(SHARED_3);
      expect(readFileSync(graphPath, 'utf-8')).toBe(graphRaw);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('/excavator-chat — reuse-before-generation runtime protocol', () => {
  it('plans the exact bounded need set before any semantic generation', () => {
    const skill = readFileSync(join(process.cwd(), 'skills/excavator-chat/SKILL.md'), 'utf-8');
    const mergeAt = skill.indexOf('Merge all four lists');
    const traverseAt = skill.indexOf('Pick ONE traversal primitive');
    const needSetAt = skill.indexOf('Freeze the bounded need set');
    const plannerAt = skill.indexOf('semantic-cache-reuse.mjs', needSetAt);
    const generationAt = skill.indexOf('`generate[]` is the only semantic generation loop');

    expect(mergeAt).toBeGreaterThan(-1);
    expect(traverseAt).toBeGreaterThan(mergeAt);
    expect(needSetAt).toBeGreaterThan(traverseAt);
    expect(plannerAt).toBeGreaterThan(needSetAt);
    expect(generationAt).toBeGreaterThan(plannerAt);
    expect(skill).toContain('select the exact node ids that this answer actually needs explained');
    expect(skill).toContain('deduplicate them by exact id in first-occurrence order');
    expect(skill).toContain('fixed before any semantic generation');
    expect(skill).not.toContain('For each node your answer actually needs to explain');
  });

  it('limits execution to generate, visibly degrades unavailable, and preserves all-fresh/overlap bytes', () => {
    const skill = readFileSync(join(process.cwd(), 'skills/excavator-chat/SKILL.md'), 'utf-8');
    expect(skill).toContain('`reuse[]` is seed/context only');
    expect(skill).toContain('Never send a reused node to the generator or semantic-cache writer');
    expect(skill).toContain('`generate[]` is the only semantic generation loop');
    expect(skill).toContain('full local source range');
    expect(skill).toContain('`unavailable[]` is a visible degraded result');
    expect(skill).toContain('never generate or write semantics for it');
    expect(skill).toContain('zero generator calls, zero semantic-cache writer calls');
    expect(skill).toContain('byte-identical `semantic-cache.json`');
    expect(skill).toContain('preserve every `reuse[]` intersection entry byte-for-byte');
    expect(skill).toContain('only the `generate[]` difference');
    expect(skill).toContain('Repeat this block only for one verified item from plan.generate');
  });

  it('keeps argv literal and preserves English-cache/current-evidence/final-language gates', () => {
    const skill = readFileSync(join(process.cwd(), 'skills/excavator-chat/SKILL.md'), 'utf-8');
    expect(skill).toContain("--node-id 'function:src/article.ts:favorite()'");
    expect(skill.match(/--node-id 'function:src\/article\.ts:favorite\(\)'/g)).toHaveLength(2);
    expect(skill).toContain('every needed id as a separate `--node-id` argument');
    expect(skill).toContain('Never concatenate ids into a command string, evaluate them as shell/code');
    expect(skill).toContain('write the model-owned `summary` and `tags` in **English**');
    expect(skill).toContain('semantic cache entry, summary, layer description, domain result, or English retrieval expression can select where to inspect, but is not evidence by itself');
    expect(skill).toContain('finalizeVerifiedAnswerLanguage($CHAT_REQUEST_STATE, { evidenceVerified: true })');
    expect(skill.indexOf('finalizeVerifiedAnswerLanguage')).toBeGreaterThan(
      skill.indexOf('Evidence verification gate'),
    );
    expect(skill).not.toMatch(/openspec\/changes/i);
  });
});

describe('semantic-cache reuse CLI — current disk inputs and zero writes', () => {
  it('preserves repeated and shell-shaped argv literally without importing a writer', () => {
    const fixture = makeFixture();
    const evilPath = 'src/space ;$(touch ORACLE_SHOULD_NOT_EXIST).ts';
    const evilId = `function:${evilPath}:save()`;
    fixture.nodes.push({ id: evilId, type: 'function', name: 'save', filePath: evilPath });
    fixture.manifestEntries.push({ path: evilPath, contentHash: H(SAME) });
    fixture.semanticCache.entries[evilId] = canonicalEntry(H(SAME));
    const root = makeCliProject(fixture);

    try {
      const first = runCliReadOnly(root, [evilId, evilId]);
      expect(first.status, first.stderr).toBe(0);
      const firstPlan = JSON.parse(first.stdout);
      expect(firstPlan.reuse).toEqual([{
        nodeId: evilId,
        filePath: evilPath,
        reason: 'fresh',
        summary: 'Returns a local value.',
        tags: ['value'],
      }]);
      expect(firstPlan.counts).toEqual({ requested: 1, reuse: 1, generate: 0, unavailable: 0 });
      expect(existsSync(join(root, 'ORACLE_SHOULD_NOT_EXIST'))).toBe(false);

      const second = runCliReadOnly(root, [evilId, evilId]);
      expect(second.status, second.stderr).toBe(0);
      expect(second.stdout).toBe(first.stdout);
      expect(readFileSync(CLI_PATH, 'utf-8')).not.toMatch(/\bcommitSemanticCacheEntry\b/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rereads graph and manifest on every invocation', () => {
    const fixture = makeFixture();
    const root = makeCliProject(fixture);
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, PATH.A), SAME, 'utf-8');
    writeFileSync(join(root, PATH.B), SAME, 'utf-8');

    try {
      const fresh = runCliReadOnly(root, [ID.A, ID.B]);
      expect(fresh.status, fresh.stderr).toBe(0);
      expect(JSON.parse(fresh.stdout).reuse.map((item) => item.nodeId)).toEqual([ID.A, ID.B]);

      const changedA = 'export function save() { return 99; }\n';
      writeFileSync(join(root, PATH.A), changedA, 'utf-8');
      const changedManifest = {
        sourceRevision: 'directory:oracle-2',
        entries: fixture.manifestEntries.map((entry) => (
          entry.path === PATH.A ? { ...entry, contentHash: H(changedA) } : entry
        )),
      };
      writeFileSync(
        join(root, '.excavator', 'source-manifest.json'),
        JSON.stringify(changedManifest, null, 2),
        'utf-8',
      );
      const stale = runCliReadOnly(root, [ID.A, ID.B]);
      expect(stale.status, stale.stderr).toBe(0);
      expect(JSON.parse(stale.stdout)).toMatchObject({
        reuse: [{ nodeId: ID.B, reason: 'fresh' }],
        generate: [{ nodeId: ID.A, currentContentHash: H(changedA), reason: 'stale' }],
      });

      const graphPath = join(root, '.excavator', 'knowledge-graph.json');
      const graph = JSON.parse(readFileSync(graphPath, 'utf-8'));
      writeFileSync(
        graphPath,
        JSON.stringify({ ...graph, nodes: graph.nodes.filter((node) => node.id !== ID.A) }, null, 2),
        'utf-8',
      );
      const unknown = runCliReadOnly(root, [ID.A]);
      expect(unknown.status, unknown.stderr).toBe(0);
      expect(JSON.parse(unknown.stdout).unavailable).toEqual([{
        nodeId: ID.A, filePath: null, reason: 'unknown-node',
      }]);

      writeFileSync(graphPath, JSON.stringify(graph, null, 2), 'utf-8');
      writeFileSync(
        join(root, '.excavator', 'source-manifest.json'),
        JSON.stringify({
          ...changedManifest,
          entries: changedManifest.entries.filter((entry) => entry.path !== PATH.A),
        }, null, 2),
        'utf-8',
      );
      const outside = runCliReadOnly(root, [ID.A]);
      expect(outside.status, outside.stderr).toBe(0);
      expect(JSON.parse(outside.stdout).unavailable).toEqual([{
        nodeId: ID.A, filePath: PATH.A, reason: 'path-not-in-manifest',
      }]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('treats missing or corrupt cache as empty without creating or rewriting it', () => {
    const fixture = makeFixture();
    for (const cacheState of ['missing', 'corrupt']) {
      const root = makeCliProject(fixture, { cache: null });
      const cachePath = join(root, '.excavator', 'semantic-cache.json');
      if (cacheState === 'corrupt') writeFileSync(cachePath, '{ not-json', 'utf-8');
      try {
        const result = runCliReadOnly(root, [ID.A]);
        expect(result.status, result.stderr).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual({
          reuse: [],
          generate: [{
            nodeId: ID.A,
            filePath: PATH.A,
            currentContentHash: H(SAME),
            reason: 'missing',
          }],
          unavailable: [],
          counts: { requested: 1, reuse: 0, generate: 1, unavailable: 0 },
        });
        expect(existsSync(cachePath)).toBe(cacheState === 'corrupt');
        if (cacheState === 'corrupt') expect(readFileSync(cachePath, 'utf-8')).toBe('{ not-json');
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });

  it('fails visibly and nonzero for missing, corrupt, or malformed required artifacts', () => {
    const cases = [
      {
        label: 'missing graph',
        alter: (root) => unlinkSync(join(root, '.excavator', 'knowledge-graph.json')),
        error: /knowledge-graph\.json not found/,
      },
      {
        label: 'corrupt graph',
        alter: (root) => writeFileSync(join(root, '.excavator', 'knowledge-graph.json'), '{ nope', 'utf-8'),
        error: /invalid knowledge-graph\.json/,
      },
      {
        label: 'missing manifest',
        alter: (root) => unlinkSync(join(root, '.excavator', 'source-manifest.json')),
        error: /source-manifest\.json not found/,
      },
      {
        label: 'malformed manifest',
        alter: (root) => writeFileSync(join(root, '.excavator', 'source-manifest.json'), '{}', 'utf-8'),
        error: /invalid source-manifest\.json: expected entries array/,
      },
    ];

    for (const fixtureCase of cases) {
      const root = makeCliProject();
      try {
        fixtureCase.alter(root);
        const result = runCliReadOnly(root, [ID.A]);
        expect(result.status, fixtureCase.label).not.toBe(0);
        expect(result.stdout, fixtureCase.label).toBe('');
        expect(result.stderr, fixtureCase.label).toMatch(fixtureCase.error);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });
});
