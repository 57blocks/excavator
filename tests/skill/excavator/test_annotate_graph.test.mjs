/**
 * annotate-graph.mjs — the audit of the model's graph against extractor facts.
 *
 * The load-bearing claim is that the model stays the author: annotate adds
 * fields, counts and marked supplement edges, and removes nothing. Every
 * scenario in openspec/changes/verifiable-statements/specs/facts-audit is
 * exercised here, plus graph-validation's "unevidenced edges stay visible".
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  annotate, matchImportLine, PIPELINE_VERSION,
} from '../../../skills/excavator/annotate-graph.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(__dirname, '../../../skills/excavator');
const SCAN = join(SKILL_DIR, 'scan-project.mjs');
const STRUCTURE_ALL = join(SKILL_DIR, 'structure-all.mjs');
const IMPORT_MAP = join(SKILL_DIR, 'extract-import-map.mjs');
const ANNOTATE = join(SKILL_DIR, 'annotate-graph.mjs');

const tempDirs = [];
afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop(), { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Hand-written fixtures: a small "UA-shaped" graph plus the extractor facts it
// is audited against. Written by hand (not by running the pipeline) so each
// disagreement under test is exactly one edit away from agreement.
// ---------------------------------------------------------------------------

function facts() {
  return {
    results: [
      {
        path: 'src/app.ts',
        language: 'typescript',
        fileCategory: 'code',
        status: 'parsed',
        functions: [{ name: 'run', startLine: 3, endLine: 5 }],
        classes: [],
        imports: [{ source: './helper', specifiers: ['helper'], line: 1 }],
        exports: [{ name: 'run', line: 3 }],
        callGraph: [{ caller: 'run', callee: 'helper', lineNumber: 4 }],
      },
      {
        path: 'src/helper.ts',
        language: 'typescript',
        fileCategory: 'code',
        status: 'parsed',
        functions: [{ name: 'helper', startLine: 1, endLine: 3 }],
        classes: [],
        exports: [{ name: 'helper', line: 1 }],
      },
      {
        path: 'web/index.html',
        language: 'html',
        fileCategory: 'markup',
        status: 'no-extractor',
      },
    ],
  };
}

function scanResult() {
  return {
    contentDigest: 'a'.repeat(64),
    files: [
      { path: 'src/app.ts', language: 'typescript', sizeLines: 6, fileCategory: 'code' },
      { path: 'src/helper.ts', language: 'typescript', sizeLines: 3, fileCategory: 'code' },
      { path: 'web/index.html', language: 'html', sizeLines: 1, fileCategory: 'markup' },
    ],
    skipped: [],
    coverage: { limits: { maxFileLines: 20000, maxFileBytes: 2097152 } },
  };
}

function importMapResult() {
  return {
    importMap: { 'src/app.ts': ['src/helper.ts'], 'src/helper.ts': [] },
    unresolved: {},
  };
}

/** A graph in the shape the existing pipeline produces: no attribution at all. */
function modelGraph(overrides = {}) {
  return {
    version: '1.0.0',
    project: {
      name: 'fixture',
      languages: ['typescript'],
      frameworks: [],
      description: 'synthetic',
      analyzedAt: '2026-09-11T00:00:00.000Z',
      gitCommitHash: null,
    },
    nodes: [
      { id: 'file:src/app.ts', type: 'file', name: 'app.ts', filePath: 'src/app.ts', summary: 'Entry', tags: ['entry'], complexity: 'simple' },
      { id: 'file:src/helper.ts', type: 'file', name: 'helper.ts', filePath: 'src/helper.ts', summary: 'Helper', tags: [], complexity: 'simple' },
      { id: 'function:src/app.ts:run', type: 'function', name: 'run', filePath: 'src/app.ts', lineRange: [3, 5], summary: 'Runs', tags: [], complexity: 'simple' },
      { id: 'function:src/helper.ts:helper', type: 'function', name: 'helper', filePath: 'src/helper.ts', lineRange: [1, 3], summary: 'Helps', tags: [], complexity: 'simple' },
    ],
    edges: [
      { source: 'file:src/app.ts', target: 'file:src/helper.ts', type: 'imports', direction: 'forward', weight: 0.7 },
      { source: 'file:src/app.ts', target: 'function:src/app.ts:run', type: 'contains', direction: 'forward', weight: 1 },
      { source: 'file:src/app.ts', target: 'function:src/app.ts:run', type: 'exports', direction: 'forward', weight: 0.8 },
      { source: 'function:src/app.ts:run', target: 'function:src/helper.ts:helper', type: 'calls', direction: 'forward', weight: 0.8 },
      { source: 'file:src/app.ts', target: 'file:src/helper.ts', type: 'depends_on', direction: 'forward', weight: 0.6, description: 'a judgement the readers cannot confirm' },
    ],
    layers: [{ id: 'l1', name: 'Core', description: 'Core', nodeIds: ['file:src/app.ts', 'file:src/helper.ts'] }],
    tour: [],
    ...overrides,
  };
}

function run(graph, opts = {}) {
  return annotate({
    graph,
    structure: facts(),
    scan: scanResult(),
    importMap: importMapResult(),
    ...opts,
  });
}

const edgeOf = (graph, type, source, target) =>
  graph.edges.find((e) => e.type === type && e.source === source && e.target === target);

const gapOf = (graph, kind, scope) =>
  graph.gaps.find((g) => g.kind === kind && (scope === undefined || g.scope === scope));

describe('annotate-graph — edge attribution', () => {
  it('marks each of the four structural edge types extracted, with the extractor line', () => {
    const { annotated } = run(modelGraph());

    expect(edgeOf(annotated, 'imports', 'file:src/app.ts', 'file:src/helper.ts')).toMatchObject({
      provenance: 'extracted',
      evidence: [{ file: 'src/app.ts', line: 1, source: 'import-map' }],
    });
    expect(edgeOf(annotated, 'contains', 'file:src/app.ts', 'function:src/app.ts:run')).toMatchObject({
      provenance: 'extracted',
      evidence: [{ file: 'src/app.ts', line: 3, source: 'tree-sitter' }],
    });
    expect(edgeOf(annotated, 'exports', 'file:src/app.ts', 'function:src/app.ts:run')).toMatchObject({
      provenance: 'extracted',
      evidence: [{ file: 'src/app.ts', line: 3, source: 'tree-sitter' }],
    });
    expect(edgeOf(annotated, 'calls', 'function:src/app.ts:run', 'function:src/helper.ts:helper')).toMatchObject({
      provenance: 'extracted',
      evidence: [{ file: 'src/app.ts', line: 4, source: 'tree-sitter' }],
    });
  });

  it('keeps an unsupported edge, marks it inferred, and counts it by type', () => {
    const { annotated, audit } = run(modelGraph());
    const judgement = edgeOf(annotated, 'depends_on', 'file:src/app.ts', 'file:src/helper.ts');

    expect(judgement.provenance).toBe('inferred');
    expect(judgement.description).toBe('a judgement the readers cannot confirm');
    expect(audit.counts.edgeAutoInferred).toEqual({ depends_on: 1 });
    expect(gapOf(annotated, 'edge-auto-inferred', 'depends_on').count).toBe(1);
  });

  it('gives every edge a provenance', () => {
    const { annotated } = run(modelGraph());
    expect(annotated.edges.every((e) => e.provenance === 'extracted' || e.provenance === 'inferred')).toBe(true);
  });

  it('confirms a model citation that agrees with the extractor', () => {
    const graph = modelGraph();
    edgeOf(graph, 'calls', 'function:src/app.ts:run', 'function:src/helper.ts:helper').evidence = [
      { file: 'src/app.ts', line: 4, source: 'model' },
    ];
    const { annotated, audit } = run(graph);
    const edge = edgeOf(annotated, 'calls', 'function:src/app.ts:run', 'function:src/helper.ts:helper');

    expect(edge.evidence).toEqual([{ file: 'src/app.ts', line: 4, source: 'model', verified: true }]);
    expect(audit.counts.evidenceVerified).toBe(1);
    expect(audit.counts.evidenceCorrected).toBe(0);
    expect(edge.verification).toBeUndefined();
  });

  it('appends the extractor line beside a disagreeing citation and counts both facts', () => {
    const graph = modelGraph();
    edgeOf(graph, 'calls', 'function:src/app.ts:run', 'function:src/helper.ts:helper').evidence = [
      { file: 'src/app.ts', line: 99, source: 'model' },
    ];
    const { annotated, audit } = run(graph);
    const edge = edgeOf(annotated, 'calls', 'function:src/app.ts:run', 'function:src/helper.ts:helper');

    // The model's own entry is still there — nothing it wrote is removed.
    expect(edge.evidence[0]).toEqual({ file: 'src/app.ts', line: 99, source: 'model' });
    expect(edge.evidence[1]).toEqual({ file: 'src/app.ts', line: 4, source: 'tree-sitter' });
    expect(edge.verification).toBe('contradicted');
    expect(audit.counts.evidenceCorrected).toBe(1);
    expect(audit.counts.edgeContradicted).toBe(1);
    expect(gapOf(annotated, 'evidence-corrected').count).toBe(1);
    expect(gapOf(annotated, 'edge-contradicted').count).toBe(1);
  });

  it('marks a model-claimed extracted edge with no record as unverified', () => {
    const graph = modelGraph();
    graph.edges.push({
      source: 'function:src/app.ts:run', target: 'function:src/helper.ts:helper',
      type: 'calls', direction: 'forward', weight: 0.8,
      provenance: 'extracted', evidence: [{ file: 'src/app.ts', line: 4, source: 'model' }],
    });
    // Same (type, source, target) as the real one, so it needs a distinct pair:
    graph.edges[graph.edges.length - 1].target = 'function:src/app.ts:run';

    const { annotated, audit } = run(graph);
    const selfCall = annotated.edges.find(
      (e) => e.type === 'calls' && e.target === 'function:src/app.ts:run',
    );
    expect(selfCall.provenance).toBe('extracted');
    expect(selfCall.verification).toBe('unverified');
    expect(audit.counts.edgeUnsupported).toBe(1);
    expect(gapOf(annotated, 'edge-unsupported').count).toBe(1);
  });

  it('does not compare inferred edges against expected records', () => {
    const graph = modelGraph();
    // A calls edge the model already marked inferred: no record exists for it,
    // and it must not be counted as auto-inferred (annotate did not decide it).
    graph.edges.push({
      source: 'function:src/helper.ts:helper', target: 'function:src/app.ts:run',
      type: 'calls', direction: 'forward', weight: 0.8, provenance: 'inferred', evidence: [],
    });
    const { annotated, audit } = run(graph);
    const edge = annotated.edges.find((e) => e.source === 'function:src/helper.ts:helper' && e.type === 'calls');

    expect(edge.provenance).toBe('inferred');
    expect(audit.counts.edgeUnsupported).toBe(0);
    expect(audit.counts.edgeAutoInferred.calls).toBeUndefined();
  });
});

describe('annotate-graph — audit counts (facts-audit scenarios)', () => {
  it('counts the three disagreement kinds one each', () => {
    // one import edge citing the wrong line, one extracted calls edge with no
    // call site, one import in the map with no edge
    const graph = modelGraph();
    edgeOf(graph, 'imports', 'file:src/app.ts', 'file:src/helper.ts').evidence = [
      { file: 'src/app.ts', line: 42, source: 'model' },
    ];
    graph.edges.push({
      source: 'function:src/helper.ts:helper', target: 'function:src/app.ts:run',
      type: 'calls', direction: 'forward', weight: 0.8, provenance: 'extracted', evidence: [],
    });
    const structure = facts();
    const importMap = importMapResult();
    importMap.importMap['src/helper.ts'] = ['src/app.ts'];
    structure.results[1].imports = [{ source: './app', specifiers: ['run'], line: 1 }];

    const { annotated, audit } = annotate({ graph, structure, scan: scanResult(), importMap, supplement: false });

    expect(audit.counts.edgeContradicted).toBe(1);
    expect(audit.counts.edgeUnsupported).toBe(1);
    // The scenario's third item: an import in the map with no edge. (The
    // fixture graph also omits helper.ts's own contains/exports records, which
    // are counted under their own scopes — that is the point of per-type
    // scoping, not a surprise.)
    expect(audit.counts.edgeMissing.imports).toBe(1);
    expect(gapOf(annotated, 'edge-missing', 'imports')).toMatchObject({ count: 1 });
    expect(gapOf(annotated, 'edge-missing', 'imports').samples[0]).toContain('src/helper.ts -> src/app.ts');
  });

  it('counts declarations with no node, naming them', () => {
    const structure = facts();
    structure.results[0].functions.push(
      { name: 'hidden', startLine: 7, endLine: 8 },
      { name: 'alsoHidden', startLine: 10, endLine: 11 },
    );
    const { annotated, audit } = annotate({
      graph: modelGraph(), structure, scan: scanResult(), importMap: importMapResult(), supplement: false,
    });

    expect(audit.counts.nodeMissing).toBe(2);
    expect(gapOf(annotated, 'node-missing').samples).toEqual([
      'src/app.ts:alsoHidden', 'src/app.ts:hidden',
    ]);
  });

  it('counts a code node no declaration supports', () => {
    const graph = modelGraph();
    graph.nodes.push({
      id: 'function:src/app.ts:invented', type: 'function', name: 'invented',
      filePath: 'src/app.ts', lineRange: [30, 31], summary: 'not in the source', tags: [], complexity: 'simple',
    });
    const { annotated, audit } = run(graph);

    expect(audit.counts.nodeUnsupported).toBe(1);
    expect(gapOf(annotated, 'node-unsupported').samples).toEqual(['src/app.ts:invented']);
  });

  it('records every owner on a node that stands for several declarations, without touching its id', () => {
    // The facts-audit Go scenario: two Save methods with different receivers,
    // one node in the model's graph.
    const structure = {
      results: [{
        path: 'store/save.go',
        language: 'go',
        fileCategory: 'code',
        status: 'parsed',
        functions: [
          { name: 'Save', owner: 'A', startLine: 5, endLine: 7 },
          { name: 'Save', owner: 'B', startLine: 9, endLine: 11 },
        ],
        classes: [],
      }],
    };
    const scan = {
      contentDigest: 'b'.repeat(64),
      files: [{ path: 'store/save.go', language: 'go', sizeLines: 12, fileCategory: 'code' }],
      skipped: [],
    };
    const graph = {
      version: '1.0.0',
      project: { name: 'g', languages: ['go'], frameworks: [], description: '', analyzedAt: 'x', gitCommitHash: null },
      nodes: [
        { id: 'file:store/save.go', type: 'file', name: 'save.go', filePath: 'store/save.go', summary: '', tags: [], complexity: 'simple' },
        { id: 'function:store/save.go:Save', type: 'function', name: 'Save', filePath: 'store/save.go', lineRange: [5, 7], summary: 'Saves', tags: [], complexity: 'simple' },
      ],
      edges: [],
      layers: [],
      tour: [],
    };

    const { annotated, audit } = annotate({ graph, structure, scan, importMap: { importMap: {}, unresolved: {} }, supplement: false });
    const node = annotated.nodes.find((n) => n.name === 'Save');

    expect(node.id).toBe('function:store/save.go:Save');
    expect(node.owners).toEqual(['A', 'B']);
    expect(audit.counts.identityCollision).toBe(1);
    expect(gapOf(annotated, 'identity-collision').count).toBe(1);
    expect(gapOf(annotated, 'identity-collision').samples[0]).toContain('store/save.go:Save@5,9');
  });

  it('still counts a collision when the extractors report no owner for that language', () => {
    const structure = facts();
    structure.results[0].functions.push({ name: 'run', startLine: 20, endLine: 22 });
    const { annotated, audit } = annotate({
      graph: modelGraph(), structure, scan: scanResult(), importMap: importMapResult(), supplement: false,
    });
    const node = annotated.nodes.find((n) => n.id === 'function:src/app.ts:run');

    expect(audit.counts.identityCollision).toBe(1);
    expect(node.owners).toBeUndefined();
    expect(gapOf(annotated, 'identity-collision').samples[0]).toContain('owners=<none reported>');
  });

  it('reports the shape audit findings as gaps', () => {
    const graph = modelGraph();
    graph.nodes.push({
      id: 'function:src/app.ts:unanchored', type: 'function', name: 'unanchored',
      filePath: 'src/app.ts', summary: '', tags: [], complexity: 'simple',
    });
    const { annotated } = run(graph);
    expect(gapOf(annotated, 'shape-issue', 'missing-line-anchor')).toMatchObject({ count: 1 });
  });

  it('does not compare files whose language has no reader', () => {
    const graph = modelGraph();
    graph.nodes.push({
      id: 'function:web/index.html:onclick', type: 'function', name: 'onclick',
      filePath: 'web/index.html', lineRange: [1, 1], summary: '', tags: [], complexity: 'simple',
    });
    const { audit } = run(graph);
    // "no reader for html" is not the same claim as "the model invented this".
    expect(audit.counts.nodeUnsupported).toBe(0);
    expect(audit.counts.notComparableNodes).toBe(1);
  });
});

describe('annotate-graph — node fields, ledger, digests', () => {
  it('adds owner and anchorSource without touching anything else', () => {
    const structure = facts();
    structure.results[0].functions[0].owner = 'Api';
    const { annotated } = annotate({
      graph: modelGraph(), structure, scan: scanResult(), importMap: importMapResult(),
    });

    const fn = annotated.nodes.find((n) => n.id === 'function:src/app.ts:run');
    expect(fn.owner).toBe('Api');
    expect(fn.anchorSource).toBe('tree-sitter');
    const file = annotated.nodes.find((n) => n.id === 'file:src/app.ts');
    expect(file.anchorSource).toBe('census');
  });

  it('adds the coverage ledger, the gap list and the digests', () => {
    const { annotated, audit } = run(modelGraph());

    expect(annotated.coverage.byLanguage.typescript).toMatchObject({ files: 2, parsed: 2 });
    expect(annotated.coverage.byLanguage.html).toMatchObject({ files: 1, parsed: 0 });
    expect(annotated.coverage.limits).toEqual({ maxFileLines: 20000, maxFileBytes: 2097152 });
    expect(audit.conservationViolations).toEqual([]);
    expect(gapOf(annotated, 'no-extractor', 'html')).toMatchObject({ count: 1 });

    expect(annotated.project.sourceDigest).toBe('a'.repeat(64));
    expect(annotated.project.factsDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(annotated.project.pipelineVersion).toBe(PIPELINE_VERSION);
  });

  it('keeps gaps the model or an earlier pass already recorded', () => {
    const graph = modelGraph({ gaps: [{ kind: 'earlier', scope: 'x', reason: 'kept', count: 1 }] });
    const { annotated } = run(graph);
    expect(gapOf(annotated, 'earlier')).toMatchObject({ reason: 'kept', count: 1 });
  });
});

describe('annotate-graph — supplement edges', () => {
  function graphMissingStructuralEdges() {
    const graph = modelGraph();
    graph.edges = graph.edges.filter((e) => e.type === 'depends_on');
    return graph;
  }

  it('appends the missing imports/exports/contains records, marked and evidenced', () => {
    const { annotated, audit } = run(graphMissingStructuralEdges());
    const added = annotated.edges.filter((e) => e.addedBy === 'excavator-annotate');

    expect(audit.counts.supplementAdded).toEqual({ contains: 2, exports: 2, imports: 1 });
    expect(added).toHaveLength(5);
    for (const edge of added) {
      expect(edge.provenance).toBe('extracted');
      expect(edge.evidence).toHaveLength(1);
      expect(edge.evidence[0].line).toBeGreaterThan(0);
      expect(['imports', 'exports', 'contains']).toContain(edge.type);
    }
    // never calls: an unresolved or ambiguous callee stays a gap
    expect(added.some((e) => e.type === 'calls')).toBe(false);
    expect(audit.counts.edgeMissing.calls).toBe(1);
  });

  it('adds nothing with --no-supplement, and still counts the same gaps', () => {
    const withSupplement = run(graphMissingStructuralEdges());
    const without = run(graphMissingStructuralEdges(), { supplement: false });

    expect(without.annotated.edges.some((e) => e.addedBy)).toBe(false);
    expect(without.audit.counts.supplementAdded).toEqual({});
    expect(without.audit.counts.edgeMissing).toEqual(withSupplement.audit.counts.edgeMissing);
  });

  it('does not invent a node to hang a supplement edge on', () => {
    const graph = graphMissingStructuralEdges();
    graph.nodes = graph.nodes.filter((n) => n.id !== 'file:src/helper.ts');
    graph.layers[0].nodeIds = ['file:src/app.ts'];
    const { annotated, audit } = run(graph);

    expect(annotated.nodes).toHaveLength(3);
    expect(annotated.edges.filter((e) => e.type === 'imports')).toHaveLength(0);
    expect(audit.counts.edgeMissing.imports).toBe(1);
  });
});

describe('annotate-graph — nothing the model wrote is removed or altered', () => {
  it('preserves every model node, edge and field', () => {
    const before = modelGraph();
    const { annotated } = run(modelGraph());

    expect(annotated.nodes).toHaveLength(before.nodes.length);
    expect(annotated.version).toBe(before.version);
    expect(annotated.layers).toEqual(before.layers);
    expect(annotated.tour).toEqual(before.tour);

    // Every field the model wrote is byte-identical; only additions appear.
    const added = new Set(['provenance', 'evidence', 'verification', 'owner', 'owners', 'anchorSource', 'addedBy']);
    for (const node of before.nodes) {
      const after = annotated.nodes.find((n) => n.id === node.id);
      for (const [key, value] of Object.entries(node)) expect(after[key]).toEqual(value);
      for (const key of Object.keys(after)) {
        if (!(key in node)) expect(added.has(key)).toBe(true);
      }
    }
    for (const edge of before.edges) {
      const after = edgeOf(annotated, edge.type, edge.source, edge.target);
      for (const [key, value] of Object.entries(edge)) expect(after[key]).toEqual(value);
      for (const key of Object.keys(after)) {
        if (!(key in edge)) expect(added.has(key)).toBe(true);
      }
    }
    for (const key of Object.keys(before.project)) {
      expect(annotated.project[key]).toEqual(before.project[key]);
    }
  });

  it('leaves the input object untouched (annotate works on a copy)', () => {
    const graph = modelGraph();
    const snapshot = JSON.stringify(graph);
    run(graph);
    expect(JSON.stringify(graph)).toBe(snapshot);
  });
});

describe('annotate-graph — determinism and the printed totals', () => {
  it('produces identical output on repeated runs', () => {
    const first = run(modelGraph());
    const second = run(modelGraph());
    const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
    expect(sha(second.annotated)).toBe(sha(first.annotated));
    expect(sha(second.audit)).toBe(sha(first.audit));
  });

  it('matches its printed totals to the gap counts in the graph (end to end)', () => {
    const root = mkdtempSync(join(tmpdir(), 'excavator-annotate-'));
    tempDirs.push(root);
    const inter = join(root, '.excavator', 'intermediate');
    mkdirSync(inter, { recursive: true });
    writeFileSync(join(inter, 'structure-all.json'), JSON.stringify(facts()));
    writeFileSync(join(inter, 'scan-result.json'), JSON.stringify(scanResult()));
    writeFileSync(join(inter, 'import-map.json'), JSON.stringify(importMapResult()));
    const graph = modelGraph();
    graph.edges = graph.edges.filter((e) => e.type !== 'imports');
    writeFileSync(join(inter, 'assembled-graph.json'), JSON.stringify(graph));

    const first = spawnSync('node', [ANNOTATE, root], { encoding: 'utf-8' });
    expect(first.status, first.stderr).toBe(0);
    const second = spawnSync('node', [ANNOTATE, root], { encoding: 'utf-8' });
    expect(second.status).toBe(0);

    const annotatedBytes = readFileSync(join(inter, 'annotated-graph.json'));
    const auditBytes = readFileSync(join(inter, 'audit.json'));
    const annotated = JSON.parse(annotatedBytes.toString());

    // the two runs agree byte for byte
    expect(second.stderr).toBe(first.stderr);
    const rerunAnnotated = readFileSync(join(inter, 'annotated-graph.json'));
    expect(createHash('sha256').update(rerunAnnotated).digest('hex')).toBe(
      createHash('sha256').update(annotatedBytes).digest('hex'),
    );

    // the printed numbers are the graph's numbers
    const printed = Object.fromEntries(
      [...first.stderr.matchAll(/([a-z-]+)=(\d+)/g)].map(([, k, v]) => [k, Number(v)]),
    );
    const gapTotal = (kind) => annotated.gaps
      .filter((g) => g.kind === kind)
      .reduce((sum, g) => sum + g.count, 0);

    expect(printed['edge-auto-inferred']).toBe(gapTotal('edge-auto-inferred'));
    expect(printed['edge-missing']).toBe(gapTotal('edge-missing'));
    expect(printed['identity-collision']).toBe(gapTotal('identity-collision'));
    expect(printed['node-missing']).toBe(gapTotal('node-missing'));
    // `edges=` is the model's edge count, before any supplement is appended.
    const audit = JSON.parse(auditBytes.toString());
    expect(printed.edges).toBe(audit.counts.edgesTotal);
    expect(annotated.edges.length).toBe(
      audit.counts.edgesTotal + Object.values(audit.counts.supplementAdded).reduce((a, b) => a + b, 0),
    );
  });
});

describe('annotate-graph — import line attribution', () => {
  it('matches by file name, then by directory name, then by uniqueness', () => {
    const imports = [
      { source: './helper', line: 1 },
      { source: 'pkg/store', line: 2 },
    ];
    expect(matchImportLine(imports, 'src/helper.ts')).toBe(1);
    expect(matchImportLine(imports, 'pkg/store/db.go')).toBe(2);
    expect(matchImportLine([{ source: 'x/y/z', line: 9 }], 'unrelated/file.ts')).toBe(9);
    expect(matchImportLine(imports, 'unrelated/file.ts')).toBeNull();
    expect(matchImportLine([], 'a.ts')).toBeNull();
  });

  it('counts an import it cannot attribute to a line instead of inventing one', () => {
    const structure = facts();
    // two import statements, neither naming the resolved target
    structure.results[0].imports = [
      { source: 'react', specifiers: ['React'], line: 1 },
      { source: 'lodash', specifiers: ['_'], line: 2 },
    ];
    const { annotated, audit } = annotate({
      graph: modelGraph(), structure, scan: scanResult(), importMap: importMapResult(),
    });
    const edge = edgeOf(annotated, 'imports', 'file:src/app.ts', 'file:src/helper.ts');

    expect(edge.provenance).toBe('extracted');
    expect(edge.evidence).toBeUndefined();
    expect(audit.counts.importLineUnmatched).toBe(1);
    expect(audit.counts.edgesExtractedWithoutLine).toBe(1);
    expect(gapOf(annotated, 'evidence-line-unmatched').count).toBe(1);
  });
});

describe('annotate-graph — over a real pipeline run', () => {
  it('annotates a graph built from real scan + structure-all + import-map output', () => {
    const root = mkdtempSync(join(tmpdir(), 'excavator-annotate-e2e-'));
    tempDirs.push(root);
    const write = (rel, content) => {
      const abs = join(root, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    };
    write('src/app.ts', "import { helper } from './helper';\n\nexport function run() {\n  return helper();\n}\n");
    write('src/helper.ts', 'export function helper() {\n  return 1;\n}\n');
    write('web/page.html', '<html></html>\n');
    spawnSync('git', ['init', '-q'], { cwd: root, encoding: 'utf-8' });

    const inter = join(root, '.excavator', 'intermediate');
    mkdirSync(inter, { recursive: true });
    const scanPath = join(inter, 'scan-result.json');
    expect(spawnSync('node', [SCAN, root, scanPath, '--exclude-analysis-data'], { encoding: 'utf-8' }).status).toBe(0);
    expect(spawnSync('node', [STRUCTURE_ALL, root], { encoding: 'utf-8' }).status).toBe(0);

    const scan = JSON.parse(readFileSync(scanPath, 'utf-8'));
    const importInput = join(inter, 'import-map-input.json');
    writeFileSync(importInput, JSON.stringify({ projectRoot: root, files: scan.files }));
    expect(spawnSync('node', [IMPORT_MAP, importInput, join(inter, 'import-map.json')], { encoding: 'utf-8' }).status).toBe(0);

    writeFileSync(join(inter, 'assembled-graph.json'), JSON.stringify(modelGraph()));
    const r = spawnSync('node', [ANNOTATE, root], { encoding: 'utf-8' });
    expect(r.status, r.stderr).toBe(0);

    const annotated = JSON.parse(readFileSync(join(inter, 'annotated-graph.json'), 'utf-8'));
    expect(annotated.edges.every((e) => e.provenance)).toBe(true);
    expect(edgeOf(annotated, 'imports', 'file:src/app.ts', 'file:src/helper.ts').evidence[0]).toEqual({
      file: 'src/app.ts', line: 1, source: 'import-map',
    });
    expect(annotated.coverage.byLanguage.html.skipped['no-extractor']).toBe(1);
    expect(annotated.project.sourceDigest).toMatch(/^[0-9a-f]{64}$/);
  }, 60_000);
});
