// Slice D (full-semantic-isolation) / Task groups 1-2 — semantic-graph.json:
// the deterministic write module for architecture layers + cross-node
// relations as an OVERLAY on top of the fact graph. Pure-function unit tests
// over synthetic fact node ids (via the same node-identity authority
// build-fact-graph.mjs uses) — no scan/tree-sitter needed for this layer.
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { deriveNodeId } from '../../skills/excavator/node-identity.mjs';
import {
  buildSemanticGraph,
  resolveArchitectureAction,
  collectFactNodeIds,
  mergeExtraGapsIntoExisting,
  readSemanticGraph,
  writeSemanticGraph,
  SEMANTIC_GRAPH_VERSION,
  SEMANTIC_GRAPH_CONTENT_LANGUAGE,
} from '../../skills/excavator/semantic-graph.mjs';

const fileNodeId = (path) => deriveNodeId({ type: 'file', path });

describe('semantic-graph.mjs — buildSemanticGraph', () => {
  const factNodeIds = new Set([
    fileNodeId('src/a.ts'),
    fileNodeId('src/b.ts'),
    fileNodeId('src/c.ts'),
  ]);

  it('keeps a layer whose nodeIds are all real fact node ids, untouched', () => {
    const layer = {
      id: 'layer:app', name: 'App', description: 'application code',
      nodeIds: [fileNodeId('src/b.ts'), fileNodeId('src/a.ts')],
    };
    const { semanticGraph, gaps } = buildSemanticGraph({
      factDigest: 'abc123', factNodeIds, layers: [layer], generatedAt: '2024-01-01T00:00:00.000Z',
    });
    expect(semanticGraph.version).toBe(SEMANTIC_GRAPH_VERSION);
    expect(semanticGraph.contentLanguage).toBe(SEMANTIC_GRAPH_CONTENT_LANGUAGE);
    expect(semanticGraph.factDigest).toBe('abc123');
    expect(semanticGraph.layers).toHaveLength(1);
    // sorted, but both entries are real ids that survive verbatim.
    expect(new Set(semanticGraph.layers[0].nodeIds)).toEqual(new Set(layer.nodeIds));
    expect(gaps).toEqual([]);
  });

  it('drops an unmappable layer nodeId from the layer and records a semantic gap — not a fact anchor', () => {
    const layer = {
      id: 'layer:app', name: 'App', description: 'application code',
      nodeIds: [fileNodeId('src/a.ts'), 'file:src/does-not-exist.ts'],
    };
    const { semanticGraph, gaps } = buildSemanticGraph({ factDigest: 'abc123', factNodeIds, layers: [layer] });

    expect(semanticGraph.layers).toHaveLength(1);
    expect(semanticGraph.layers[0].nodeIds).toEqual([fileNodeId('src/a.ts')]);
    expect(semanticGraph.layers[0].nodeIds).not.toContain('file:src/does-not-exist.ts');

    const gap = gaps.find((g) => g.kind === 'layer-nodeId-unmappable');
    expect(gap).toBeDefined();
    expect(gap.count).toBe(1);
    expect(gap.samples).toContain('file:src/does-not-exist.ts');
  });

  it('drops a layer missing a required field entirely, as a gap', () => {
    const badLayer = { id: 'layer:x', nodeIds: [] }; // no name/description
    const { semanticGraph, gaps } = buildSemanticGraph({ factDigest: 'd1', factNodeIds, layers: [badLayer] });
    expect(semanticGraph.layers).toEqual([]);
    expect(gaps.some((g) => g.kind === 'layer-invalid')).toBe(true);
  });

  it('keeps a relation whose endpoints are both real fact node ids', () => {
    const relation = {
      id: 'relation:1', type: 'depends_on',
      source: fileNodeId('src/a.ts'), target: fileNodeId('src/b.ts'),
      description: 'a uses b', evidence: [{ file: 'src/a.ts', line: 1 }],
    };
    const { semanticGraph, gaps } = buildSemanticGraph({ factDigest: 'd1', factNodeIds, relations: [relation] });
    expect(semanticGraph.relations).toHaveLength(1);
    expect(semanticGraph.relations[0].source).toBe(fileNodeId('src/a.ts'));
    expect(semanticGraph.relations[0].target).toBe(fileNodeId('src/b.ts'));
    expect(semanticGraph.relations[0].provenance).toBe('model');
    expect(gaps).toEqual([]);
  });

  it('audits the final sorted relation positions so a valid graph remains writable', () => {
    const { semanticGraph, gaps } = buildSemanticGraph({
      factDigest: 'd1',
      factNodeIds,
      relations: [
        {
          id: 'relation:z', type: 'calls',
          source: fileNodeId('src/a.ts'), target: fileNodeId('src/b.ts'),
          description: 'Calls the service.',
        },
        {
          id: 'relation:a', type: 'calls',
          source: fileNodeId('src/a.ts'), target: fileNodeId('src/b.ts'),
        },
      ],
    });

    expect(gaps).toEqual([]);
    expect(semanticGraph.relations.map((relation) => relation.id)).toEqual([
      'relation:a', 'relation:z',
    ]);
    expect(semanticGraph.languageAudit.accepted.map((entry) => entry.fieldPath))
      .toContain('relations[1].description');
    expect(() => writeSemanticGraph('/virtual', semanticGraph, {
      fsImpl: { mkdirSync() {}, writeFileSync() {}, renameSync() {} },
    })).not.toThrow();
  });

  it('records a dropped invalid relation as a structural gap without auditing its discarded prose', () => {
    const { semanticGraph, gaps, languageAudit } = buildSemanticGraph({
      factDigest: 'd1',
      factNodeIds,
      relations: [{
        id: 'relation:invalid', type: 'calls',
        source: fileNodeId('src/a.ts'), target: 'file:src/ghost.ts',
        description: '这段文字不会被保存。',
      }],
    });

    expect(semanticGraph).not.toBeNull();
    expect(semanticGraph.relations).toEqual([]);
    expect(languageAudit).toMatchObject({ status: 'accepted', inspected: 0 });
    expect(gaps.some((gap) => gap.kind === 'relation-endpoint-unmappable')).toBe(true);
  });

  it('drops a relation whole when either endpoint is unmappable, as a gap — never a dangling reference', () => {
    const relation = {
      id: 'relation:1', type: 'depends_on',
      source: fileNodeId('src/a.ts'), target: 'file:src/ghost.ts',
    };
    const { semanticGraph, gaps } = buildSemanticGraph({ factDigest: 'd1', factNodeIds, relations: [relation] });
    expect(semanticGraph.relations).toEqual([]);
    const gap = gaps.find((g) => g.kind === 'relation-endpoint-unmappable');
    expect(gap).toBeDefined();
    expect(gap.samples[0]).toContain('file:src/ghost.ts');
  });

  it('merges caller-supplied extraGaps (e.g. from node-patch application) into the same gaps array', () => {
    const extraGaps = [{ kind: 'semantic-patch-unmappable-node', scope: 'src/x.ts', reason: 'x', count: 1, samples: ['function:src/x.ts:ghost'] }];
    const { semanticGraph } = buildSemanticGraph({ factDigest: 'd1', factNodeIds, extraGaps });
    expect(semanticGraph.gaps.some((g) => g.kind === 'semantic-patch-unmappable-node')).toBe(true);
  });

  it('throws without a factDigest — the overlay must always be keyed', () => {
    expect(() => buildSemanticGraph({ factNodeIds })).toThrow(/factDigest/);
  });

  it('rejects a Chinese model-owned field with visible conserved buckets', () => {
    const { semanticGraph, gaps, languageAudit } = buildSemanticGraph({
      factDigest: 'd1',
      factNodeIds,
      layers: [{
        id: 'layer:app', name: 'Application', description: '处理请假请求。',
        nodeIds: [fileNodeId('src/a.ts')],
      }],
    });

    expect(semanticGraph).toBeNull();
    expect(gaps).toEqual([expect.objectContaining({
      kind: 'noncanonical-language', scope: 'semantic-graph', count: 1,
    })]);
    expect(languageAudit.rejected).toEqual([
      expect.objectContaining({ fieldPath: 'layers[0].description', reason: 'noncanonical-language' }),
    ]);
    expect(languageAudit.inspected).toBe(languageAudit.accepted.length + languageAudit.rejected.length);
  });

  it('accepts and preserves an exact non-English fact-node name quoted in model prose', () => {
    const nonEnglishId = 'function:src/leave.ts:提交请假';
    const layer = {
      id: 'layer:leave', name: 'Leave',
      description: 'Calls 提交请假 after validation.', nodeIds: [nonEnglishId],
    };
    const { semanticGraph, languageAudit } = buildSemanticGraph({
      factDigest: 'd1',
      factNodeIds: new Set([nonEnglishId]),
      factGraph: {
        project: { name: 'fixture', languages: ['typescript'], frameworks: [] },
        nodes: [{ id: nonEnglishId, name: '提交请假', filePath: 'src/leave.ts' }],
      },
      layers: [layer],
    });

    expect(semanticGraph.layers[0].description).toBe(layer.description);
    expect(languageAudit.status).toBe('accepted');
    expect(languageAudit.accepted).toContainEqual(expect.objectContaining({
      fieldPath: 'layers[0].description', maskedSourceSpans: ['提交请假'],
      valueDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    }));
  });

  it('ignores model-declared source spans and rejects the candidate', () => {
    const { semanticGraph, languageAudit } = buildSemanticGraph({
      factDigest: 'd1',
      factNodeIds,
      layers: [{
        id: 'layer:leave', name: 'Leave',
        description: 'Calls 提交请假 after validation.',
        nodeIds: [fileNodeId('src/a.ts')],
        sourceOwnedSpans: ['提交请假'],
      }],
    });

    expect(semanticGraph).toBeNull();
    expect(languageAudit.rejected[0]).toMatchObject({
      fieldPath: 'layers[0].description', unverifiedSpans: ['提交请假'],
    });
  });
});

describe('semantic-graph.mjs — resolveArchitectureAction (factDigest gate)', () => {
  const current = (factDigest) => ({
    version: SEMANTIC_GRAPH_VERSION,
    contentLanguage: SEMANTIC_GRAPH_CONTENT_LANGUAGE,
    languageAudit: { status: 'accepted', inspected: 0, accepted: [], rejected: [] },
    factDigest,
  });

  it('reports rebuild when there is no existing semantic-graph.json', () => {
    const { action, status } = resolveArchitectureAction({ currentFactDigest: 'abc', existing: null });
    expect(action).toBe('rebuild');
    expect(status).toBe('missing');
  });

  it('reports reuse when factDigest is unchanged', () => {
    const { action, status, reason } = resolveArchitectureAction({
      currentFactDigest: 'abc', existing: current('abc'),
    });
    expect(action).toBe('reuse');
    expect(status).toBe('fresh');
    expect(reason).toMatch(/unchanged/);
  });

  it('rebuilds when prose changes after its accepted audit was created', () => {
    const { semanticGraph } = buildSemanticGraph({
      factDigest: 'abc',
      factNodeIds: new Set(['file:a.ts']),
      layers: [{
        id: 'layer:app', name: 'Application', description: 'Handles requests.',
        nodeIds: ['file:a.ts'],
      }],
    });
    semanticGraph.layers[0].description = '处理请求。';

    expect(resolveArchitectureAction({ currentFactDigest: 'abc', existing: semanticGraph }))
      .toMatchObject({ action: 'rebuild', status: 'noncanonical-language' });
  });

  it('reports rebuild when factDigest changed', () => {
    const { action, status } = resolveArchitectureAction({
      currentFactDigest: 'def', existing: current('abc'),
    });
    expect(action).toBe('rebuild');
    expect(status).toBe('stale');
  });

  it.each([
    ['missing marker', { version: SEMANTIC_GRAPH_VERSION, factDigest: 'abc' }],
    ['non-English marker', { version: SEMANTIC_GRAPH_VERSION, contentLanguage: 'zh', factDigest: 'abc' }],
    ['old schema', { version: '1.0.0', contentLanguage: SEMANTIC_GRAPH_CONTENT_LANGUAGE, factDigest: 'abc' }],
    ['missing field audit', { version: SEMANTIC_GRAPH_VERSION, contentLanguage: SEMANTIC_GRAPH_CONTENT_LANGUAGE, factDigest: 'abc' }],
  ])('reports visible noncanonical-language for %s', (_label, existing) => {
    const result = resolveArchitectureAction({ currentFactDigest: 'abc', existing });
    expect(result).toMatchObject({ action: 'rebuild', status: 'noncanonical-language' });
    expect(result.reason).toContain('noncanonical-language');
  });
});

describe('semantic-graph.mjs — mergeExtraGapsIntoExisting (reuse branch does not swallow a fresh gap)', () => {
  it('replaces prior patch-origin gaps with fresh ones while keeping layer/relation gaps from the last real build', () => {
    const existing = {
      version: SEMANTIC_GRAPH_VERSION,
      contentLanguage: SEMANTIC_GRAPH_CONTENT_LANGUAGE,
      factDigest: 'abc',
      layers: [{ id: 'layer:app', name: 'App', description: 'd', nodeIds: ['file:a.ts'] }],
      relations: [],
      gaps: [
        { kind: 'layer-nodeId-unmappable', scope: 'layer:app', reason: 'r', count: 1, samples: ['file:ghost.ts'] },
        { kind: 'semantic-patch-unmappable-node', scope: 'a.ts', reason: 'stale patch gap', count: 1, samples: ['function:a.ts:old-ghost'] },
      ],
      model: 'test',
      generatedAt: '2024-01-01T00:00:00.000Z',
    };
    const freshExtraGaps = [
      { kind: 'semantic-patch-unmappable-node', scope: 'b.ts', reason: 'new stale patch gap', count: 1, samples: ['function:b.ts:new-ghost'] },
    ];

    const merged = mergeExtraGapsIntoExisting(existing, freshExtraGaps);

    // Structural (layer-/relation-) gaps from the real build survive verbatim.
    expect(merged.gaps.some((g) => g.kind === 'layer-nodeId-unmappable')).toBe(true);
    // The OLD patch-origin gap is replaced, not accumulated forever.
    expect(merged.gaps.some((g) => g.samples?.includes('function:a.ts:old-ghost'))).toBe(false);
    // The NEW patch-origin gap is present.
    expect(merged.gaps.some((g) => g.samples?.includes('function:b.ts:new-ghost'))).toBe(true);
    // layers/relations/factDigest are untouched — this is a gaps-only refresh.
    expect(merged.layers).toEqual(existing.layers);
    expect(merged.factDigest).toBe('abc');
  });
});

describe('semantic-graph.mjs — collectFactNodeIds / read / write round trip', () => {
  let root;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'semantic-graph-fixture-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('collects every node id from a knowledge graph', () => {
    const kg = { nodes: [{ id: 'file:a.ts' }, { id: 'function:a.ts:foo' }] };
    const ids = collectFactNodeIds(kg);
    expect(ids.has('file:a.ts')).toBe(true);
    expect(ids.has('function:a.ts:foo')).toBe(true);
    expect(ids.has('file:ghost.ts')).toBe(false);
  });

  it('write then read returns the same document; missing file reads as null', () => {
    expect(readSemanticGraph(root)).toBeNull();
    const { semanticGraph } = buildSemanticGraph({ factDigest: 'zzz', factNodeIds: new Set(['file:a.ts']) });
    const outPath = writeSemanticGraph(root, semanticGraph);
    expect(existsSync(outPath)).toBe(true);
    expect(readSemanticGraph(root)).toEqual(semanticGraph);
    expect(JSON.parse(readFileSync(outPath, 'utf-8')).factDigest).toBe('zzz');
    expect(JSON.parse(readFileSync(outPath, 'utf-8')).contentLanguage).toBe('en');
  });

  it('refuses an unaudited graph without overwriting the current product', () => {
    const { semanticGraph } = buildSemanticGraph({ factDigest: 'old', factNodeIds: new Set() });
    const outPath = writeSemanticGraph(root, semanticGraph);
    const before = readFileSync(outPath, 'utf-8');

    expect(() => writeSemanticGraph(root, {
      version: SEMANTIC_GRAPH_VERSION,
      contentLanguage: SEMANTIC_GRAPH_CONTENT_LANGUAGE,
      factDigest: 'new', layers: [], relations: [], gaps: [],
    })).toThrow(/refusing to write/);
    expect(readFileSync(outPath, 'utf-8')).toBe(before);
  });
});
