// artifact-view tasks 6.2-6.4 and 7.1: the graph explorer's levels (member,
// directory, file, symbol neighborhood), the node detail's edge lists, the
// edge-type legend against retrieve.mjs, the graph routes, and the source
// text lookups with their recorded reasons. Checked against hand-computed
// answers on the committed dev fixture and on hand-built segments.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodeBundle } from '../../skills/excavator-view/bundle-codec.mjs';
import { DETERMINISTIC_EDGE_TYPES } from '../../skills/excavator/retrieve.mjs';
import { EDGE_TYPES, LEGEND_KEYS, edgeTypeKey } from '../../packages/view/src/model/edge-types.ts';
import {
  GraphEngine, MAX_VISIBLE, buildPathTree, capItems, chainEnd, childItems,
} from '../../packages/view/src/model/graph-model.ts';
import { QueryEngine, retainForQueries } from '../../packages/view/src/model/engine.ts';
import { chunkTerms, edgeEvidence, evidenceLocation, nodeFacts, nodeRowIndex } from '../../packages/view/src/model/node-detail.ts';
import { evidenceLineText, nodeExcerpt } from '../../packages/view/src/model/source-text.ts';
import { graphDirHash, graphFileHash, nodeHash, parseHash, routeSection } from '../../packages/view/src/routes.ts';
import { buildStructure, compressedDir } from '../../packages/view/src/model/tree.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sample = readFileSync(join(repoRoot, 'packages/view/fixtures/sample.bundle.txt'), 'utf-8');

// Fixture rows (see adjacency.test.mjs): nodes 0 Counter, 1 docs/notes.md, 2 package.json,
// 3 src/counter.ts, 4 src/main.ts, 5 src/util/format.ts, 6 run, 7 formatGreeting, 8 shout.
async function sampleSegments() {
  return (await decodeBundle(sample)).segments;
}

const idOf = (segments, row) => segments.strings[segments.nodes.columns.id[row]];

describe('edge type legend (6.4)', () => {
  it('lists exactly the deterministic edge types of retrieve.mjs, plus "other"', () => {
    expect([...EDGE_TYPES].sort()).toEqual([...DETERMINISTIC_EDGE_TYPES].sort());
    expect(LEGEND_KEYS).toEqual([...EDGE_TYPES, 'other']);
    expect(edgeTypeKey('calls')).toBe('calls');
    expect(edgeTypeKey('depends-on')).toBe('other');
    expect(edgeTypeKey('(untyped)')).toBe('other');
  });
});

describe('graph routes (6.2)', () => {
  it('parses directory, file and node levels, and keeps a top-level directory named "file" apart', () => {
    expect(parseHash('#/graph')).toMatchObject({ kind: 'section', section: 'graph' });
    expect(parseHash('#/graph/')).toMatchObject({ kind: 'section', section: 'graph' });
    expect(parseHash('#/graph/src/util')).toEqual({ kind: 'graph-dir', path: 'src/util' });
    expect(parseHash('#/graph/file/src/main.ts')).toEqual({ kind: 'graph-file', path: 'src/main.ts' });
    expect(parseHash(graphDirHash('a b/c#d'))).toEqual({ kind: 'graph-dir', path: 'a b/c#d' });
    expect(parseHash(graphFileHash('x/y z.ts'))).toEqual({ kind: 'graph-file', path: 'x/y z.ts' });
    expect(graphDirHash('file/x')).toBe('#/graph/%66ile/x');
    expect(parseHash(graphDirHash('file/x'))).toEqual({ kind: 'graph-dir', path: 'file/x' });
    expect(parseHash(graphDirHash('file'))).toEqual({ kind: 'graph-dir', path: 'file' });
    expect(graphDirHash('')).toBe('#/graph');
    expect(routeSection(parseHash('#/graph/src'))).toBe('graph');
    expect(routeSection(parseHash('#/graph/file/a.ts'))).toBe('graph');
    expect(parseHash(nodeHash('n:1', 2))).toEqual({ kind: 'node', id: 'n:1', hops: 2 });
    expect(parseHash(nodeHash('n:1'))).toEqual({ kind: 'node', id: 'n:1' });
    expect(parseHash('#/node/n%3A1?hops=7')).toEqual({ kind: 'node', id: 'n:1' });
    expect(parseHash('#/graph/file/')).toMatchObject({ kind: 'unknown' });
  });
});

describe('path tree and level items (6.2)', () => {
  const paths = ['a/b/c/x.ts', 'a/b/c/x.ts', 'a/b/c/y.ts', 'b/x.ts', 'top.ts', null, 'm/n/deep/z.ts', 'm/n/other.ts'];
  const types = ['file', 'function', 'file', 'file', 'file', 'function', 'file', 'file'];

  it('builds the tree with recursive node counts and compresses single-subdirectory chains', () => {
    const tree = buildPathTree(paths, types);
    expect(tree.noPath).toBe(1);
    expect(tree.dirs.get('').nodes).toBe(7);
    expect(tree.dirs.get('a').nodes).toBe(3);
    expect(tree.fileNodes.get('a/b/c/x.ts')).toBe(2);
    expect(tree.fileRow.get('a/b/c/x.ts')).toBe(0);
    expect(chainEnd(tree, 'a')).toBe('a/b/c');
    expect(chainEnd(tree, 'm')).toBe('m/n');
    expect(chainEnd(tree, 'b')).toBe('b');
    // Same file name under different directories stays two items.
    expect(childItems(tree, '').map((i) => [i.key, i.label, i.nodes])).toEqual([
      ['d:a/b/c', 'a/b/c/', 3], ['d:b', 'b/', 1], ['d:m/n', 'm/n/', 2], ['p:top.ts', 'top.ts', 1],
    ]);
    expect(childItems(tree, 'b').map((i) => i.key)).toEqual(['p:b/x.ts']);
  });

  it('folds items past the cap into one "more" item that keeps the node count', () => {
    const many = Array.from({ length: 450 }, (_, i) => `d/f${String(i).padStart(3, '0')}.ts`);
    const tree = buildPathTree(many, many.map(() => 'file'));
    const raw = childItems(tree, 'd');
    expect(raw).toHaveLength(450);
    const { items, folded } = capItems(raw);
    expect(items).toHaveLength(MAX_VISIBLE);
    expect(items.at(-1)).toMatchObject({ key: 'more', kind: 'more', folded: 51, nodes: 51 });
    expect(folded.size).toBe(51);
    expect(items.reduce((n, i) => n + i.nodes, 0)).toBe(450);
  });

  it('caps a real directory level at 400 nodes through the engine', () => {
    const n = 450;
    const strings = [];
    const cell = (s) => {
      strings.push(s);
      return strings.length - 1;
    };
    const ids = [];
    const ps = [];
    const ts = [];
    const fileType = cell('file');
    for (let i = 0; i < n; i += 1) {
      ids.push(cell(`file:d/f${i}.ts`));
      ps.push(cell(`d/f${i}.ts`));
      ts.push(fileType);
    }
    const imports = cell('imports');
    const segments = {
      strings,
      nodes: { rows: n, columns: { id: Int32Array.from(ids), path: Int32Array.from(ps), type: Int32Array.from(ts) } },
      edges: { rows: 1, columns: { src: Int32Array.from([ids[0]]), dst: Int32Array.from([ids[1]]), type: Int32Array.from([imports]) } },
    };
    const engine = new GraphEngine(segments, strings);
    const member = engine.graphView(null);
    expect(member).toMatchObject({ found: true, level: 'member', shown: 'd', itemsTotal: 450 });
    expect(member.items).toHaveLength(MAX_VISIBLE);
    expect(member.items.reduce((s, i) => s + i.nodes, 0)).toBe(n);
  });
});

describe('graph engine over the fixture (6.2 / 6.3)', () => {
  it('answers the member, directory and file levels with aggregated links and outside counts', async () => {
    const segments = await sampleSegments();
    const engine = new GraphEngine(segments, segments.strings);
    expect(engine.built).toBe(false);
    const init = engine.init();
    expect(init).toMatchObject({ types: ['calls', 'contains', 'exports', 'imports'], nodes: 9, edges: 11, unresolvedEdges: 0 });

    const member = engine.graphView(null);
    expect(member.level).toBe('member');
    expect(member.items.map((i) => [i.key, i.nodes])).toEqual([['d:docs', 1], ['d:src', 7], ['p:package.json', 1]]);
    expect(member.links).toEqual([]);

    const src = engine.graphView('src');
    expect(src).toMatchObject({ found: true, level: 'directory', scope: 'src', shown: 'src' });
    expect(src.items.map((i) => [i.key, i.nodes, i.internal])).toEqual([
      ['d:src/util', 3, 4], ['p:src/counter.ts', 2, 2], ['p:src/main.ts', 2, 2],
    ]);
    const named = src.links.map((l) => [src.items[l.source].key, src.items[l.target].key, src.types[l.type], l.count]);
    expect(named.sort()).toEqual([
      ['p:src/main.ts', 'd:src/util', 'calls', 1],
      ['p:src/main.ts', 'd:src/util', 'imports', 1],
      ['p:src/main.ts', 'p:src/counter.ts', 'imports', 1],
    ]);
    expect(src.outsideOut.reduce((a, b) => a + b, 0)).toBe(0);
    expect(engine.graphView('src/util').items.map((i) => i.key)).toEqual(['p:src/util/format.ts']);
    expect(engine.graphView('nope')).toEqual({ found: false, scope: 'nope' });

    const file = engine.fileView('src/util/format.ts');
    expect(file).toMatchObject({ found: true, fileRow: 5, total: 2, edgesTotal: 0 });
    expect(file.rows.map((r) => idOf(segments, r))).toEqual([
      'function:src/util/format.ts:formatGreeting(name,times)', 'function:src/util/format.ts:shout(text)',
    ]);
    // run -calls-> formatGreeting arrives from another file.
    expect(file.outsideIn[file.types.indexOf('calls')]).toBe(1);
    expect(engine.fileView('src/none.ts')).toMatchObject({ found: false, rows: [] });
  });

  it('answers 1- and 2-hop neighborhoods with the edges among the drawn nodes, filtered by type', async () => {
    const segments = await sampleSegments();
    const engine = new GraphEngine(segments, segments.strings);
    const one = engine.neighborhoodView(6, 1, null);
    expect(one).toMatchObject({ found: true, rows: [6, 7, 4], distance: [0, 1, 1], total: 3 });
    const edges = [];
    for (let i = 0; i < one.edges.length; i += 4) edges.push([one.rows[one.edges[i + 1]], one.rows[one.edges[i + 2]], one.types[one.edges[i + 3]]]);
    expect(edges.sort()).toEqual([[4, 6, 'contains'], [4, 6, 'exports'], [6, 7, 'calls']]);
    expect(engine.neighborhoodView(6, 2, null).rows).toEqual([6, 7, 4, 5, 3]);
    expect(engine.neighborhoodView(6, 2, ['calls']).rows).toEqual([6, 7]);
    // Reached only through in-edges: formatGreeting is entered by run, format.ts and an export.
    expect(engine.neighborhoodView(7, 1, null).rows.sort()).toEqual([5, 6, 7]);
    expect(engine.neighborhoodView(-1, 1, null)).toMatchObject({ found: false, rows: [] });
  });

  it('lists a class node\'s edges by type and direction (6.3)', async () => {
    const segments = await sampleSegments();
    const engine = new GraphEngine(segments, segments.strings);
    const counter = engine.nodeEdges(0);
    expect(counter.out).toEqual([]);
    expect(counter.in.map((g) => [g.type, g.total, g.edges])).toEqual([['contains', 1, [1, 3]], ['exports', 1, [5, 3]]]);
    const main = engine.nodeEdges(4);
    expect(main.out.map((g) => [g.type, g.total])).toEqual([['contains', 1], ['exports', 1], ['imports', 2]]);
    expect(main.unresolvedOut).toEqual([]);
  });

  it('keeps edges with an endpoint outside the graph visible on the node that has them', () => {
    const strings = ['a', 'b', 'x/y.ts', 'calls', 'ghost'];
    const segments = {
      strings,
      nodes: { rows: 2, columns: { id: Int32Array.from([0, 1]), path: Int32Array.from([2, 2]), type: Int32Array.from([-1, -1]) } },
      edges: { rows: 2, columns: { src: Int32Array.from([0, 0]), dst: Int32Array.from([1, 4]), type: Int32Array.from([3, 3]) } },
    };
    const engine = new GraphEngine(segments, strings);
    const a = engine.nodeEdges(0);
    expect(a.out.map((g) => g.total)).toEqual([1]);
    expect(a.unresolvedOut).toEqual([1]);
    expect(engine.graphView(null).unresolvedEdges).toBe(1);
  });

  it('runs the graph queries through the query engine on the Worker\'s retained columns', async () => {
    const segments = await sampleSegments();
    const engine = new QueryEngine(retainForQueries(segments));
    const progress = [];
    const init = engine.run({ op: 'graph-init' }, (done, total) => progress.push([done, total]));
    expect(init).toMatchObject({ nodes: 9, edges: 11 });
    expect(progress.at(-1)).toEqual([33, 33]);
    expect(engine.run({ op: 'neighborhood', row: 6, hops: 1, types: null }).rows).toEqual([6, 7, 4]);
    expect(engine.run({ op: 'graph-view', scope: 'src' }).items).toHaveLength(3);
    expect(engine.run({ op: 'graph-file', path: 'src/main.ts' }).rows).toEqual([6]);
    expect(engine.run({ op: 'node-edges', row: 0 }).in).toHaveLength(2);
  });
});

describe('node detail model (6.3)', () => {
  it('reads fact fields, the chunk terms and evidence locations', async () => {
    const segments = await sampleSegments();
    const index = nodeRowIndex(segments, segments.strings);
    expect(index.get('class:src/counter.ts:Counter')).toBe(0);
    const facts = nodeFacts(segments, segments.strings, 0);
    expect(facts).toMatchObject({ id: 'class:src/counter.ts:Counter', type: 'class', name: 'Counter', path: 'src/counter.ts', line0: 1, line1: 11 });
    const terms = chunkTerms(segments, segments.strings, segments.meta, 0);
    expect(terms.state).toBe('chunk');
    expect(terms.identifiers).toContain('increment');
    expect(terms.comments).toEqual([]);
    expect(terms.literals.state).toBe('embedded');
    const ev = edgeEvidence(segments, segments.strings, 0, 3);
    expect(ev.total).toBe(1);
    expect(evidenceLocation(ev.rows[0])).toBe('src/main.ts:7');
    expect(evidenceLocation({ ...ev.rows[0], endLine: 9 })).toBe('src/main.ts:7-9');
  });

  it('says "not available" without an index and "not embedded" without the literal text', async () => {
    const segments = await sampleSegments();
    const { 'index.chunks': _c, ...noIndex } = segments;
    expect(chunkTerms(noIndex, segments.strings, segments.meta, 0)).toEqual({ state: 'no-index' });
    const chunks = segments['index.chunks'];
    const minus = new Int32Array(chunks.rows).fill(-1);
    const trimmed = {
      ...segments,
      'index.chunks': { rows: chunks.rows, columns: { ...chunks.columns, commentOffset: minus, commentCount: minus, stringOffset: minus, stringCount: minus } },
    };
    delete trimmed.indexLiterals;
    const meta = { ...segments.meta, index: { ...segments.meta.index, literals: 'omitted' } };
    const terms = chunkTerms(trimmed, segments.strings, meta, 0);
    expect(terms).toMatchObject({ state: 'chunk', comments: null, strings: null, literals: { state: 'omitted' } });
  });
});

describe('source text and its recorded reasons (7.1)', () => {
  it('returns evidence line text and excerpts when embedded', async () => {
    const segments = await sampleSegments();
    expect(evidenceLineText(segments.meta, segments, 0, 'src/main.ts')).toEqual({ state: 'embedded', text: '  return formatGreeting(name, counter.value());' });
    const excerpt = nodeExcerpt(segments.meta, segments, 0, 'src/counter.ts');
    expect(excerpt.state).toBe('embedded');
    expect(excerpt.text.split('\n')).toHaveLength(11);
  });

  it('points to --no-source, the budget, a hash mismatch, or the bake counts, never a guess', async () => {
    const segments = await sampleSegments();
    const strip = (...names) => {
      const copy = { ...segments };
      for (const n of names) delete copy[n];
      return copy;
    };
    const noSource = { ...segments.meta, embeds: segments.meta.embeds.map((e) => ({ segment: e.segment, status: 'dropped', reason: 'no-source' })), dropped: [{ segment: 'excerpts', reason: 'no-source' }, { segment: 'evidenceText', reason: 'no-source' }] };
    expect(nodeExcerpt(noSource, strip('excerpts', 'excerpts.strings'), 0, 'src/counter.ts')).toMatchObject({ state: 'not-embedded', reason: 'no-source', message: 'Source not embedded: this page was baked with --no-source.' });
    const budget = { ...segments.meta, embeds: [{ segment: 'excerpts', status: 'dropped', reason: 'budget' }], dropped: [{ segment: 'excerpts', reason: 'budget' }] };
    expect(nodeExcerpt(budget, strip('excerpts', 'excerpts.strings'), 0, 'x').message).toBe('Source not embedded: the symbol excerpts were dropped to fit the source budget (64 MB).');
    // Embedded segment, but this row has no text.
    const holes = { ...segments, evidenceText: { rows: segments.evidenceText.rows, columns: { text: new Int32Array(segments.evidenceText.rows).fill(-1) } } };
    const mismatchMeta = { ...segments.meta, source: { ...segments.meta.source, embedding: { ...segments.meta.source.embedding, filesHashMismatch: 1, hashMismatchSamples: ['src/main.ts'] } } };
    expect(evidenceLineText(mismatchMeta, holes, 0, 'src/main.ts')).toMatchObject({ reason: 'hash-mismatch' });
    const other = evidenceLineText(mismatchMeta, holes, 1, 'src/counter.ts');
    expect(other.reason).toBe('not-embedded-for-file');
    expect(other.message).toContain('1 with a content hash mismatch');
    expect(nodeExcerpt({ ...segments.meta, embeds: [], dropped: [] }, strip('excerpts', 'excerpts.strings'), 0, 'x').reason).toBe('not-recorded');
  });
});

describe('structure treemap chain compression (5.1 follow-up)', () => {
  it('follows single-subdirectory chains to the first directory with files or several children', async () => {
    const segments = await sampleSegments();
    const model = buildStructure(segments, segments.strings, segments.meta);
    const src = model.byPath.get('src');
    expect(compressedDir(src)).toBe(src);
    const leaf = { kind: 'file', name: 'z.ts', path: 'a/b/c/z.ts', lines: 1, language: null, fileNode: -1, symbols: [] };
    const c = { kind: 'dir', name: 'c', path: 'a/b/c', children: [leaf], files: 1, lines: 1, language: null, member: false };
    const b = { kind: 'dir', name: 'b', path: 'a/b', children: [c], files: 1, lines: 1, language: null, member: false };
    const a = { kind: 'dir', name: 'a', path: 'a', children: [b], files: 1, lines: 1, language: null, member: false };
    expect(compressedDir(a)).toBe(c);
  });
});
