// artifact-view task 6.1: the CSR adjacency (out / in edges, segmented by
// edge type) and the directory / member aggregation, checked against
// hand-computed answers on the committed dev fixture and on hand-built
// segments with an unresolved edge, an untyped edge, a duplicate node id and a
// node without a path.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodeBundle } from '../../skills/excavator-view/bundle-codec.mjs';
import {
  NO_PATH, UNTYPED, aggregate, buildAdjacency, directoryOf, edgesAt, memberOf, neighborhood,
} from '../../packages/view/src/model/adjacency.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sample = readFileSync(join(repoRoot, 'packages/view/fixtures/sample.bundle.txt'), 'utf-8');

// The fixture, in graph order (hand-read from its knowledge graph):
//   nodes 0 class Counter (src/counter.ts), 1 file docs/notes.md, 2 file package.json,
//         3 file src/counter.ts, 4 file src/main.ts, 5 file src/util/format.ts,
//         6 function run (src/main.ts), 7 function formatGreeting, 8 function shout (src/util/format.ts)
//   edges 0 run -calls-> formatGreeting; 1 counter.ts -contains-> Counter; 2 main.ts -contains-> run;
//         3 format.ts -contains-> formatGreeting; 4 format.ts -contains-> shout;
//         5 counter.ts -exports-> Counter; 6 main.ts -exports-> run; 7 format.ts -exports-> formatGreeting;
//         8 format.ts -exports-> shout; 9 main.ts -imports-> counter.ts; 10 main.ts -imports-> format.ts
const CALLS = 0;
const CONTAINS = 1;
const EXPORTS = 2;
const IMPORTS = 3;

async function sampleSegments() {
  return (await decodeBundle(sample)).segments;
}

const ids = (segments, rows) => [...rows].map((row) => segments.strings[segments.nodes.columns.id[row]]);

describe('CSR adjacency (6.1)', () => {
  it('lists out- and in-edges per node, segmented by type, on the fixture', async () => {
    const segments = await sampleSegments();
    expect(ids(segments, [4, 6, 7])).toEqual(['file:src/main.ts', 'function:src/main.ts:run(name)', 'function:src/util/format.ts:formatGreeting(name,times)']);
    const adj = buildAdjacency(segments, segments.strings);
    expect(adj).toMatchObject({ nodeCount: 9, edgeCount: 11, types: ['calls', 'contains', 'exports', 'imports'], unresolvedEdges: 0, duplicateNodeIds: 0 });
    expect(adj.outOffsets).toHaveLength(9 * 4 + 1);
    expect(adj.outEdges).toHaveLength(11);
    expect(adj.inEdges).toHaveLength(11);
    expect([...edgesAt(adj, 4, 'out')]).toEqual([2, 6, 9, 10]);
    expect([...edgesAt(adj, 4, 'out', [IMPORTS])]).toEqual([9, 10]);
    expect([...edgesAt(adj, 4, 'out', [IMPORTS, CONTAINS])]).toEqual([2, 9, 10]);
    expect([...edgesAt(adj, 4, 'in')]).toEqual([]);
    expect([...edgesAt(adj, 7, 'in')]).toEqual([0, 3, 7]);
    expect([...edgesAt(adj, 7, 'in', [CALLS])]).toEqual([0]);
    expect([...edgesAt(adj, 5, 'out', [EXPORTS])]).toEqual([7, 8]);
    expect([...edgesAt(adj, 1, 'out')]).toEqual([]);
    expect([...edgesAt(adj, 99, 'out')]).toEqual([]);
    // Every edge appears exactly once per direction.
    expect([...adj.outEdges].sort((a, b) => a - b)).toEqual([...Array(11).keys()]);
    expect([...adj.inEdges].sort((a, b) => a - b)).toEqual([...Array(11).keys()]);
  });

  it('answers 1- and 2-hop neighborhoods by direction and type', async () => {
    const segments = await sampleSegments();
    const adj = buildAdjacency(segments, segments.strings);
    expect([...neighborhood(adj, 6, 1)]).toEqual([[6, 0], [7, 1], [4, 1]]);
    expect([...neighborhood(adj, 6, 2)]).toEqual([[6, 0], [7, 1], [4, 1], [5, 2], [3, 2]]);
    expect([...neighborhood(adj, 6, 2, { direction: 'out' })]).toEqual([[6, 0], [7, 1]]);
    expect([...neighborhood(adj, 4, 2, { types: [CALLS] })]).toEqual([[4, 0]]);
    expect([...neighborhood(adj, 4, 1, { types: [IMPORTS] })]).toEqual([[4, 0], [3, 1], [5, 1]]);
    expect([...neighborhood(adj, -1, 2)]).toEqual([]);
  });

  it('counts unresolved edges, untyped edges and duplicate ids instead of dropping them', () => {
    const strings = ['a', 'b', 'c', 'x/y.ts', 'calls', 'missing', 'x/z.ts'];
    const segments = {
      strings,
      nodes: { rows: 4, columns: { id: Int32Array.from([0, 1, 2, 0]), path: Int32Array.from([3, 6, -1, 3]) } },
      edges: { rows: 3, columns: { src: Int32Array.from([0, 0, 1]), dst: Int32Array.from([1, 5, 2]), type: Int32Array.from([4, 4, -1]) } },
    };
    const adj = buildAdjacency(segments, strings);
    expect(adj).toMatchObject({ types: [UNTYPED, 'calls'], unresolvedEdges: 1, duplicateNodeIds: 1 });
    expect([...adj.src]).toEqual([0, -1, 1]);
    expect([...adj.dst]).toEqual([1, -1, 2]);
    expect([...edgesAt(adj, 0, 'out')]).toEqual([0]);
    expect([...edgesAt(adj, 1, 'out')]).toEqual([2]);
    expect([...edgesAt(adj, 3, 'out')]).toEqual([]);
    expect(adj.outEdges).toHaveLength(2);

    const byDir = aggregate(adj, segments, strings, directoryOf);
    expect(byDir.groups.map((g) => [g.key, g.nodes])).toEqual([[NO_PATH, 1], ['x', 3]]);
    expect([...byDir.groupOf]).toEqual([1, 1, 0, 1]);
    expect([...byDir.groups[1].internalByType]).toEqual([0, 1]);
    expect([...byDir.groups[1].outByType]).toEqual([1, 0]);
    expect([...byDir.groups[0].inByType]).toEqual([1, 0]);
    expect(byDir.links).toEqual([{ source: 1, target: 0, type: 0, count: 1 }]);
    expect(byDir.unresolvedEdges).toBe(1);
  });
});

describe('directory and member aggregation (6.1)', () => {
  it('derives directory and member keys from a path', () => {
    expect(directoryOf('src/util/format.ts')).toBe('src/util');
    expect(directoryOf('package.json')).toBe('.');
    expect(directoryOf(null)).toBe(null);
    expect(memberOf('repo-a/src/x.ts')).toBe('repo-a');
    expect(memberOf('README.md')).toBe('.');
    expect(memberOf(null)).toBe(null);
  });

  it('aggregates the fixture by directory: node counts, edges by type inside, out of and into each group', async () => {
    const segments = await sampleSegments();
    const adj = buildAdjacency(segments, segments.strings);
    const agg = aggregate(adj, segments, segments.strings, directoryOf);
    expect(agg.types).toEqual(['calls', 'contains', 'exports', 'imports']);
    expect(agg.groups.map((g) => [g.key, g.nodes])).toEqual([['.', 1], ['docs', 1], ['src', 4], ['src/util', 3]]);
    const byKey = Object.fromEntries(agg.groups.map((g) => [g.key, {
      internal: [...g.internalByType], out: [...g.outByType], in: [...g.inByType],
    }]));
    expect(byKey.src).toEqual({ internal: [0, 2, 2, 1], out: [1, 0, 0, 1], in: [0, 0, 0, 0] });
    expect(byKey['src/util']).toEqual({ internal: [0, 2, 2, 0], out: [0, 0, 0, 0], in: [1, 0, 0, 1] });
    expect(byKey['.']).toEqual({ internal: [0, 0, 0, 0], out: [0, 0, 0, 0], in: [0, 0, 0, 0] });
    expect(agg.links).toEqual([
      { source: 2, target: 3, type: CALLS, count: 1 },
      { source: 2, target: 3, type: IMPORTS, count: 1 },
    ]);
    // Conservation: every resolved edge is internal to one group or counted once out and once in.
    const internal = agg.groups.reduce((n, g) => n + g.internalByType.reduce((a, b) => a + b, 0), 0);
    const cross = agg.links.reduce((n, l) => n + l.count, 0);
    expect(internal + cross + agg.unresolvedEdges).toBe(11);
  });

  it('aggregates the fixture by member (first path segment)', async () => {
    const segments = await sampleSegments();
    const adj = buildAdjacency(segments, segments.strings);
    const agg = aggregate(adj, segments, segments.strings, memberOf);
    expect(agg.groups.map((g) => [g.key, g.nodes])).toEqual([['.', 1], ['docs', 1], ['src', 7]]);
    expect([...agg.groups[2].internalByType]).toEqual([1, 4, 4, 2]);
    expect(agg.links).toEqual([]);
  });
});
