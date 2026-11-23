// openspec: changes/semantic-structure-digest, oracle O3 - the checked, one-time
// re-bind of a semantic graph written before it bound structureDigest. One test
// per outcome bucket, over a synthetic projection (no scan needed).
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { computeFactsDigest, computeStructureDigest } from '../../skills/excavator/build-fact-graph.mjs';
import {
  ADDITIVE_FACT_STREAMS,
  SEMANTIC_GRAPH_FILE,
  buildSemanticGraph,
  rebindSemanticGraph,
} from '../../skills/excavator/semantic-graph.mjs';

const NODES = [
  { id: 'file:a.ts', type: 'file', name: 'a.ts', filePath: 'a.ts' },
  { id: 'file:b.ts', type: 'file', name: 'b.ts', filePath: 'b.ts' },
];
const EDGES = [{ type: 'imports', source: 'file:a.ts', target: 'file:b.ts' }];
const BASE_COVERAGE = { files: 2, ignored: 0, byLanguage: { typescript: { files: 2, skipped: {} } } };
const ENTRY_COVERAGE = { entryPoints: { frameworks: { express: { entryPoints: 1 } } } };
const BASE_GAPS = [{ kind: 'calls-unresolved', scope: 'typescript', reason: 'x', count: 1 }];
const ENTRY_GAPS = [{ kind: 'entry-point-path-unresolved', scope: 'express', reason: 'y', count: 1 }];

/** A projection the way build-fact-graph returns it, with an entry point stream. */
function projectionOf({ nodes = NODES, edges = EDGES } = {}) {
  const coverage = { ...BASE_COVERAGE, ...ENTRY_COVERAGE };
  const gaps = [...BASE_GAPS, ...ENTRY_GAPS];
  const entryPoints = [{ record: 'entryPoint', path: '/x' }];
  return {
    nodes, edges, coverage, gaps, entryPoints,
    factsDigest: computeFactsDigest({ nodes, edges, coverage: BASE_COVERAGE_WITH_ENTRY(), gaps, entryPoints }),
    structureDigest: computeStructureDigest({ nodes, edges }),
  };
}
function BASE_COVERAGE_WITH_ENTRY() {
  return { ...BASE_COVERAGE, ...ENTRY_COVERAGE };
}
/** The digest before the additive streams existed, computed here independently. */
function preStreamDigest({ nodes = NODES, edges = EDGES } = {}) {
  return computeFactsDigest({ nodes, edges, coverage: BASE_COVERAGE, gaps: BASE_GAPS });
}

/** A valid current-shape semantic graph, then the digest key swapped to a legacy factDigest in place. */
function legacyGraph(factDigest) {
  const { semanticGraph } = buildSemanticGraph({
    structureDigest: 'placeholder',
    factNodeIds: new Set(NODES.map((n) => n.id)),
    layers: [{ id: 'layer:app', name: 'Application', description: 'Handles requests.', nodeIds: ['file:a.ts', 'file:b.ts'] }],
    generatedAt: '2024-01-01T00:00:00.000Z',
    model: 'test-model',
  });
  const out = {};
  for (const [key, value] of Object.entries(semanticGraph)) {
    if (key === 'structureDigest') out.factDigest = factDigest;
    else out[key] = value;
  }
  return out;
}

describe('rebindSemanticGraph', () => {
  let dataDir;
  let file;
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'rebind-'));
    file = join(dataDir, SEMANTIC_GRAPH_FILE);
  });
  afterEach(() => rmSync(dataDir, { recursive: true, force: true }));

  const put = (doc) => writeFileSync(file, typeof doc === 'string' ? doc : JSON.stringify(doc, null, 2));
  const bytes = () => readFileSync(file);

  it('names the additive streams in one table', () => {
    expect(ADDITIVE_FACT_STREAMS.map((s) => s.recordStream)).toEqual(['entryPoints']);
    expect(ADDITIVE_FACT_STREAMS[0].gapKinds).toContain('entry-point-path-unresolved');
  });

  it('rebounds through candidate 1: factDigest equals the current factsDigest', () => {
    const projection = projectionOf();
    const legacy = legacyGraph(projection.factsDigest);
    put(legacy);
    const result = rebindSemanticGraph({ dataDir, projection });
    expect(result.status).toBe('rebound');
    expect(result.reason).toMatch(/current factsDigest/);
    const written = JSON.parse(bytes().toString('utf-8'));
    expect(written).not.toHaveProperty('factDigest');
    expect(written.structureDigest).toBe(projection.structureDigest);
    expect(JSON.stringify(written.layers)).toBe(JSON.stringify(legacy.layers));
  });

  it('rebounds through candidate 2: factDigest is the digest before the additive streams', () => {
    const projection = projectionOf();
    expect(preStreamDigest()).not.toBe(projection.factsDigest);
    const legacy = legacyGraph(preStreamDigest());
    put(legacy);
    const result = rebindSemanticGraph({ dataDir, projection });
    expect(result.status).toBe('rebound');
    expect(result.reason).toMatch(/without the additive streams/);
    const written = JSON.parse(bytes().toString('utf-8'));
    expect(written).not.toHaveProperty('factDigest');
    expect(written.structureDigest).toBe(projection.structureDigest);
    expect(JSON.stringify(written.layers)).toBe(JSON.stringify(legacy.layers));
    // Every other key keeps its value, and the digest key keeps its position.
    const expectedKeys = Object.keys(legacy).map((k) => (k === 'factDigest' ? 'structureDigest' : k));
    expect(Object.keys(written)).toEqual(expectedKeys);
    for (const key of Object.keys(legacy)) {
      if (key !== 'factDigest') expect(written[key]).toEqual(legacy[key]);
    }
  });

  it('is unbound after a node change, and leaves the file byte-identical', () => {
    const changed = projectionOf({ nodes: [{ ...NODES[0], line: 9 }, NODES[1]] });
    put(legacyGraph(preStreamDigest()));
    const before = bytes();
    const result = rebindSemanticGraph({ dataDir, projection: changed });
    expect(result.status).toBe('unbound');
    expect(result.reason).toMatch(/cannot be shown to be unchanged/);
    expect(bytes().equals(before)).toBe(true);
  });

  it('is bound when structureDigest equals the graph\'s, without writing', () => {
    const projection = projectionOf();
    const { semanticGraph } = buildSemanticGraph({
      structureDigest: projection.structureDigest, factNodeIds: new Set(NODES.map((n) => n.id)), generatedAt: '2024-01-01T00:00:00.000Z',
    });
    put(semanticGraph);
    const before = bytes();
    expect(rebindSemanticGraph({ dataDir, projection }).status).toBe('bound');
    expect(bytes().equals(before)).toBe(true);
  });

  it('is stale when structureDigest differs from the graph\'s, without writing', () => {
    const projection = projectionOf();
    const { semanticGraph } = buildSemanticGraph({
      structureDigest: 'f'.repeat(64), factNodeIds: new Set(NODES.map((n) => n.id)), generatedAt: '2024-01-01T00:00:00.000Z',
    });
    put(semanticGraph);
    const before = bytes();
    expect(rebindSemanticGraph({ dataDir, projection }).status).toBe('stale');
    expect(bytes().equals(before)).toBe(true);
  });

  it('is absent when there is no semantic-graph.json', () => {
    expect(rebindSemanticGraph({ dataDir, projection: projectionOf() }).status).toBe('absent');
  });

  it('is unbound for unreadable JSON, never throws, and leaves the file byte-identical', () => {
    put('{ not json');
    const before = bytes();
    const result = rebindSemanticGraph({ dataDir, projection: projectionOf() });
    expect(result.status).toBe('unbound');
    expect(bytes().equals(before)).toBe(true);
  });

  it('is unbound when the file records neither digest', () => {
    const legacy = legacyGraph('x');
    delete legacy.factDigest;
    put(legacy);
    expect(rebindSemanticGraph({ dataDir, projection: projectionOf() }).status).toBe('unbound');
  });

  it('is unbound, file untouched, when the write is refused (unaudited language)', () => {
    const projection = projectionOf();
    const legacy = legacyGraph(projection.factsDigest);
    legacy.layers[0].description = String.fromCharCode(0x5904, 0x7406, 0x8bf7, 0x6c42, 0x3002);
    put(legacy);
    const before = bytes();
    const result = rebindSemanticGraph({ dataDir, projection });
    expect(result.status).toBe('unbound');
    expect(bytes().equals(before)).toBe(true);
  });
});
