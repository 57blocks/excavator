// openspec: changes/knowledge-graph-line-store, capability `fact-graph`
// (design D1/D2) — line-oriented persistence for the knowledge graph. Owns the
// READ/WRITE round trip: strict deep equality for the Lazy, pre-v2 and Full
// graph shapes, key order and byte determinism, multi-byte block boundaries,
// the per-record size limit, and every named validation failure.
// Purpose-built synthetic fixtures only (AGENTS.md).
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { isDeepStrictEqual } from 'node:util';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  KNOWLEDGE_GRAPH_FILE,
  LEGACY_KNOWLEDGE_GRAPH_FILE,
  KNOWLEDGE_GRAPH_FORMAT,
  KnowledgeGraphFormatError,
  writeKnowledgeGraph,
  writeKnowledgeGraphAtomic,
  readKnowledgeGraph,
  readKnowledgeGraphHeader,
} from '../../skills/excavator/knowledge-graph-store.mjs';
import { ProductTooLargeError } from '../../skills/excavator/product-serialization.mjs';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function lazyGraph() {
  return {
    version: '1.0.0',
    project: {
      name: 'demo', languages: ['typescript'], frameworks: [], description: '',
      analyzedAt: '2026-10-09T00:00:00.000Z', gitCommitHash: 'abc', factsDigest: 'f'.repeat(64),
      pipelineVersion: 'lazy-fact-graph/3',
    },
    nodes: [
      { id: 'file:src/a.ts', type: 'file', name: 'a.ts', filePath: 'src/a.ts', summary: '', tags: [], complexity: 'simple' },
      {
        id: 'function:src/a.ts:run', type: 'function', name: 'run', filePath: 'src/a.ts', lineRange: [1, 4],
        // CJK plus an astral emoji (a surrogate pair), so a tiny read block
        // splits a multi-byte UTF-8 sequence.
        summary: '处理订单 😀 — creates an order', tags: [], complexity: 'simple',
      },
    ],
    edges: [
      {
        source: 'file:src/a.ts', target: 'function:src/a.ts:run', type: 'contains', direction: 'forward', weight: 1,
        evidence: [{ file: 'src/a.ts', line: 1, endLine: 4, source: 'tree-sitter' }], provenance: 'extracted',
      },
    ],
    layers: [],
    tour: [],
    coverage: { files: 1, byLanguage: { typescript: { files: 1, parsed: 1, zeroSymbol: 0, skipped: {}, kinds: { function: 1 } } }, ignored: 0 },
    gaps: [{ kind: 'calls-unresolved', scope: 'typescript', reason: 'r', count: 1, samples: ['src/a.ts:2 -> x.y'] }],
  };
}

/** The pre-v2 shape: no `coverage` and no `gaps` keys at all. */
function preV2Graph() {
  const graph = lazyGraph();
  delete graph.coverage;
  delete graph.gaps;
  return graph;
}

/** A Full graph: extra top-level fields, layers and a tour. */
function fullGraph() {
  return {
    version: '1.0.0',
    kind: 'codebase',
    contentLanguage: 'en',
    languageAudit: { checked: 2, english: 2 },
    ...lazyGraph(),
    layers: [{ id: 'layer:core', name: 'Core', description: 'core logic', nodeIds: ['function:src/a.ts:run'] }],
    tour: [{ order: 1, title: 'Start here', description: 'entry', nodeIds: ['file:src/a.ts'] }],
  };
}

let dir;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'kg-store-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const lines = (path) => readFileSync(path, 'utf-8').split('\n').filter((line) => line.length > 0);

// ---------------------------------------------------------------------------

describe('exported constants', () => {
  it('names the current and legacy file, and the header format tag', () => {
    expect(KNOWLEDGE_GRAPH_FILE).toBe('knowledge-graph.jsonl');
    expect(LEGACY_KNOWLEDGE_GRAPH_FILE).toBe('knowledge-graph.json');
    expect(KNOWLEDGE_GRAPH_FORMAT).toBe('excavator-knowledge-graph-lines/1');
  });
});

describe('writeKnowledgeGraph + readKnowledgeGraph — lossless round trip', () => {
  it('the comparator sees a known one-field difference before we trust it', () => {
    const a = lazyGraph();
    const b = lazyGraph();
    b.edges[0].evidence[0].line = 2;
    expect(isDeepStrictEqual(a, b)).toBe(false);
    expect(isDeepStrictEqual(a, lazyGraph())).toBe(true);
  });

  for (const [name, make] of [['Lazy', lazyGraph], ['pre-v2 (no coverage/gaps)', preV2Graph], ['Full (layers, tour, extra fields)', fullGraph]]) {
    it(`reads back a ${name} graph strictly deep-equal, with the same key order`, () => {
      const path = join(dir, KNOWLEDGE_GRAPH_FILE);
      writeKnowledgeGraph(path, make());
      const read = readKnowledgeGraph(path);
      expect(isDeepStrictEqual(read, make())).toBe(true);
      expect(Object.keys(read)).toEqual(Object.keys(make()));
    });
  }

  it('a pre-v2 graph stays without coverage and gaps keys (absent, not empty)', () => {
    const path = join(dir, KNOWLEDGE_GRAPH_FILE);
    writeKnowledgeGraph(path, preV2Graph());
    const read = readKnowledgeGraph(path);
    expect(Object.hasOwn(read, 'coverage')).toBe(false);
    expect(Object.hasOwn(read, 'gaps')).toBe(false);
  });

  it('a tiny read blockSize (splitting multi-byte characters across blocks) still round-trips exactly', () => {
    const path = join(dir, KNOWLEDGE_GRAPH_FILE);
    writeKnowledgeGraph(path, fullGraph());
    for (const blockSize of [1, 2, 3, 5, 7]) {
      expect(isDeepStrictEqual(readKnowledgeGraph(path, { blockSize }), fullGraph())).toBe(true);
    }
  });

  it('writing the same graph twice, and re-writing a read graph, produce byte-identical files', () => {
    const first = join(dir, 'first.jsonl');
    const second = join(dir, 'second.jsonl');
    const third = join(dir, 'third.jsonl');
    writeKnowledgeGraph(first, fullGraph());
    writeKnowledgeGraph(second, fullGraph());
    writeKnowledgeGraph(third, readKnowledgeGraph(first));
    expect(readFileSync(second).equals(readFileSync(first))).toBe(true);
    expect(readFileSync(third).equals(readFileSync(first))).toBe(true);
  });

  it('writes one record per line: a header, then every element of every stream', () => {
    const path = join(dir, KNOWLEDGE_GRAPH_FILE);
    const graph = fullGraph();
    const result = writeKnowledgeGraph(path, graph);
    const records = lines(path).map((line) => JSON.parse(line));
    expect(records[0]).toMatchObject({ record: 'header', format: KNOWLEDGE_GRAPH_FORMAT, keys: Object.keys(graph) });
    expect(records[0].counts).toEqual({ nodes: 2, edges: 1, layers: 1, tour: 1, gaps: 1 });
    expect(records[0].fields.project.name).toBe('demo');
    const kinds = records.slice(1).map((r) => r.record);
    expect(kinds).toEqual(['node', 'node', 'edge', 'layer', 'tour', 'coverage', 'gap']);
    expect(result.lines).toBe(records.length);
    expect(result.bytes).toBe(readFileSync(path).length);
    expect(result.maxLineChars).toBe(Math.max(...lines(path).map((line) => line.length)));
  });

  it('an undefined top-level value is dropped and an undefined element becomes null, as in JSON', () => {
    const path = join(dir, KNOWLEDGE_GRAPH_FILE);
    const graph = { ...lazyGraph(), kind: undefined };
    graph.tour = [undefined];
    writeKnowledgeGraph(path, graph);
    const read = readKnowledgeGraph(path);
    expect(isDeepStrictEqual(read, JSON.parse(JSON.stringify(graph)))).toBe(true);
  });

  it('a top-level key named __proto__ comes back as an own property, not a prototype', () => {
    const path = join(dir, KNOWLEDGE_GRAPH_FILE);
    const graph = JSON.parse('{"version":"1","__proto__":{"polluted":true},"nodes":[],"edges":[]}');
    writeKnowledgeGraph(path, graph);
    const read = readKnowledgeGraph(path);
    expect(Object.getPrototypeOf(read)).toBe(Object.prototype);
    expect(Object.hasOwn(read, '__proto__')).toBe(true);
    expect(read.polluted).toBeUndefined();
  });
});

describe('readKnowledgeGraphHeader', () => {
  it('returns the key order, non-stream fields and counts without reading the records', () => {
    const path = join(dir, KNOWLEDGE_GRAPH_FILE);
    const graph = fullGraph();
    writeKnowledgeGraph(path, graph);
    // Corrupt everything after line 1: a header read must not notice.
    writeFileSync(path, `${lines(path)[0]}\nnot json at all\n`);
    const header = readKnowledgeGraphHeader(path);
    expect(header.keys).toEqual(Object.keys(graph));
    expect(header.fields.project).toEqual(graph.project);
    expect(header.fields.contentLanguage).toBe('en');
    expect(header.counts.nodes).toBe(2);
    expect(() => readKnowledgeGraph(path)).toThrow(KnowledgeGraphFormatError);
  });

  it('fails on an empty file or a non-header first line', () => {
    const path = join(dir, KNOWLEDGE_GRAPH_FILE);
    writeFileSync(path, '');
    expect(() => readKnowledgeGraphHeader(path)).toThrow(KnowledgeGraphFormatError);
    writeFileSync(path, '{"record":"node","node":{}}\n');
    expect(() => readKnowledgeGraphHeader(path)).toThrow(KnowledgeGraphFormatError);
  });
});

describe('per-record size limit', () => {
  it('a graph far larger than the limit is written when every record fits', () => {
    const path = join(dir, KNOWLEDGE_GRAPH_FILE);
    const graph = lazyGraph();
    for (let i = 0; i < 200; i += 1) graph.nodes.push({ id: `file:src/f${i}.ts`, type: 'file', name: `f${i}.ts` });
    const limit = 2_000;
    expect(JSON.stringify(graph).length).toBeGreaterThan(limit);
    const result = writeKnowledgeGraph(path, graph, { limit });
    expect(result.maxLineChars).toBeLessThanOrEqual(limit);
    expect(isDeepStrictEqual(readKnowledgeGraph(path), graph)).toBe(true);
  });

  it('a single record longer than the limit fails as a named ProductTooLargeError', () => {
    const path = join(dir, KNOWLEDGE_GRAPH_FILE);
    const graph = lazyGraph();
    graph.nodes[1].summary = 'x'.repeat(5_000);
    let error;
    try {
      writeKnowledgeGraph(path, graph, { limit: 2_000 });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ProductTooLargeError);
    expect(error.product).toBe(KNOWLEDGE_GRAPH_FILE);
    expect(error.requiredChars).toBeGreaterThan(2_000);
    expect(error.limitChars).toBe(2_000);
  });

  it('the atomic writer leaves the previous file untouched and no temporary file when a record is too large', () => {
    const path = join(dir, KNOWLEDGE_GRAPH_FILE);
    writeKnowledgeGraphAtomic(path, lazyGraph());
    const before = readFileSync(path);
    const graph = lazyGraph();
    graph.nodes[1].summary = 'x'.repeat(5_000);
    expect(() => writeKnowledgeGraphAtomic(path, graph, { limit: 2_000 })).toThrow(ProductTooLargeError);
    expect(readFileSync(path).equals(before)).toBe(true);
    expect(readdirSync(dir)).toEqual([KNOWLEDGE_GRAPH_FILE]);
  });
});

describe('readKnowledgeGraph — named format failures, never a partial graph', () => {
  function written() {
    const path = join(dir, KNOWLEDGE_GRAPH_FILE);
    writeKnowledgeGraph(path, fullGraph());
    return { path, recs: lines(path) };
  }
  function expectFormatError(path, pattern) {
    expect(() => readKnowledgeGraph(path)).toThrow(KnowledgeGraphFormatError);
    expect(() => readKnowledgeGraph(path)).toThrow(pattern);
  }
  const save = (path, recs) => writeFileSync(path, recs.join('\n') + '\n');

  it('an empty file has no header', () => {
    const path = join(dir, KNOWLEDGE_GRAPH_FILE);
    writeFileSync(path, '');
    expectFormatError(path, /missing header/);
  });

  it('the first line is not a header record', () => {
    const { path, recs } = written();
    save(path, recs.slice(1));
    expectFormatError(path, /first line to be a header/);
  });

  it('a header with the wrong format tag', () => {
    const { path, recs } = written();
    const header = JSON.parse(recs[0]);
    header.format = 'excavator-knowledge-graph-lines/0';
    save(path, [JSON.stringify(header), ...recs.slice(1)]);
    expectFormatError(path, /first line to be a header/);
  });

  it('a second header record after line 1', () => {
    const { path, recs } = written();
    save(path, [...recs, recs[0]]);
    expectFormatError(path, /second header/);
  });

  it('a stream with fewer records than the header declares (truncated file)', () => {
    const { path, recs } = written();
    save(path, recs.filter((line) => !line.startsWith('{"record":"edge"')));
    expectFormatError(path, /edges count mismatch/);
  });

  it('a stream with more records than the header declares', () => {
    const { path, recs } = written();
    const extraNode = recs.find((line) => line.startsWith('{"record":"node"'));
    save(path, [...recs, extraNode]);
    expectFormatError(path, /nodes count mismatch/);
  });

  it('an unrecognized record type', () => {
    const { path, recs } = written();
    save(path, [...recs, '{"record":"widget","widget":{}}']);
    expectFormatError(path, /unknown record type/);
  });

  it('a record for a stream the header does not list', () => {
    const path = join(dir, KNOWLEDGE_GRAPH_FILE);
    writeKnowledgeGraph(path, preV2Graph());
    save(path, [...lines(path), '{"record":"gap","gap":{}}']);
    expectFormatError(path, /does not list "gaps"/);
  });

  it('a missing coverage record when the header lists coverage, or two of them', () => {
    const { path, recs } = written();
    save(path, recs.filter((line) => !line.startsWith('{"record":"coverage"')));
    expectFormatError(path, /coverage record count mismatch/);
    const coverage = recs.find((line) => line.startsWith('{"record":"coverage"'));
    save(path, [...recs, coverage]);
    expectFormatError(path, /coverage record count mismatch/);
  });

  it('a header that lists a key without carrying its value', () => {
    const { path, recs } = written();
    const header = JSON.parse(recs[0]);
    delete header.fields.version;
    save(path, [JSON.stringify(header), ...recs.slice(1)]);
    expectFormatError(path, /carries no value/);
  });

  it('a header count that is not a non-negative integer', () => {
    const { path, recs } = written();
    const header = JSON.parse(recs[0]);
    header.counts.nodes = -1;
    save(path, [JSON.stringify(header), ...recs.slice(1)]);
    expectFormatError(path, /non-negative integer/);
  });

  it('a record missing its value field', () => {
    const { path, recs } = written();
    save(path, [...recs.slice(0, 1), '{"record":"node"}', ...recs.slice(2)]);
    expectFormatError(path, /has no "node" value/);
  });

  it('invalid JSON on a non-header line', () => {
    const { path, recs } = written();
    save(path, [recs[0], '{not json', ...recs.slice(1)]);
    expectFormatError(path, /invalid JSON/);
  });

  it('never reads the legacy whole-document file, even when it sits next to the new one', () => {
    const legacy = join(dir, LEGACY_KNOWLEDGE_GRAPH_FILE);
    writeFileSync(legacy, JSON.stringify(lazyGraph()));
    expect(() => readKnowledgeGraph(join(dir, KNOWLEDGE_GRAPH_FILE))).toThrow(/ENOENT/);
    expect(existsSync(legacy)).toBe(true);
  });
});
