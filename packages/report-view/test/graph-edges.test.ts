import { describe, expect, it } from 'vitest';

import type { GraphEdge, GraphNode } from '../src/data/graph';
import { buildIndex } from '../src/data/indexes';
import { aggregateEdges, DEFAULT_EDGE_TYPES, edgeLabel, levelEnds } from '../src/lib/graph-edges';
import { buildLevel, buildStructure, type Level } from '../src/lib/graph-structure';

const file = (path: string): GraphNode => ({ id: `file:${path}`, type: 'file', name: path.slice(path.lastIndexOf('/') + 1), filePath: path });
const fn = (path: string, name: string): GraphNode => ({ id: `function:${path}:${name}`, type: 'function', name, filePath: path });
const edge = (source: string, target: string, type: string): GraphEdge => ({ source, target, type });

const NODES = [file('a/x.js'), file('a/y.js'), file('b/z.js'), file('c/w.js'), fn('a/x.js', 'one'), fn('a/y.js', 'two'), fn('b/z.js', 'three'), fn('c/w.js', 'four')];
const EDGES: GraphEdge[] = [
  edge('file:a/x.js', 'function:a/x.js:one', 'contains'),
  edge('file:a/y.js', 'function:a/y.js:two', 'contains'),
  edge('file:b/z.js', 'function:b/z.js:three', 'contains'),
  edge('file:a/x.js', 'file:b/z.js', 'imports'),
  edge('file:a/y.js', 'file:b/z.js', 'imports'),
  edge('function:a/x.js:one', 'function:b/z.js:three', 'calls'),
  edge('function:a/y.js:two', 'function:b/z.js:three', 'calls'),
  edge('function:a/y.js:two', 'function:b/z.js:three', 'calls'),
  edge('function:b/z.js:three', 'function:a/x.js:one', 'calls'),
  edge('function:a/x.js:one', 'function:a/y.js:two', 'calls'),
  edge('file:a/x.js', 'file:c/w.js', 'depends_on'),
  edge('function:c/w.js:four', 'function:b/z.js:three', 'exports'),
  edge('function:nowhere', 'function:b/z.js:three', 'calls'),
  // Nesting between two groups (a malformed graph): still not a line.
  edge('file:a/y.js', 'file:c/w.js', 'contains'),
];

const index = buildIndex({ nodes: NODES, edges: EDGES });
const structure = buildStructure(index);
const top = buildLevel(structure, {}) as Level;
const ends = levelEnds(top, index.owningFile, new Map());

describe('aggregateEdges', () => {
  const edges = aggregateEdges(EDGES, ends);
  const between = (source: string, target: string) => edges.find((e) => e.source === `group:${source}` && e.target === `group:${target}`);

  it('sums the edges between two things into one edge, by type, along the arrow and back, and counts every one of them', () => {
    expect(between('a', 'b')).toMatchObject({ count: 6, forward: { count: 5, byType: { imports: 2, calls: 3 } }, backward: { count: 1, byType: { calls: 1 } } });
    expect(between('c', 'b')).toMatchObject({ count: 1, forward: { count: 1, byType: { exports: 1 } }, backward: null });
    expect(between('b', 'a')).toBeUndefined();
  });

  it('points an edge the way most of its edges run, and the way the first ran on a tie', () => {
    const pair = (...types: [string, string][]) => aggregateEdges(types.map(([s, t]) => edge(s, t, 'calls')), (id) => id);
    expect(pair(['x', 'y'], ['y', 'x'], ['y', 'x'])[0]).toMatchObject({ source: 'y', target: 'x', forward: { count: 2 }, backward: { count: 1 } });
    expect(pair(['y', 'x'], ['x', 'y'])[0]).toMatchObject({ source: 'y', target: 'x', forward: { count: 1 }, backward: { count: 1 } });
  });

  it('leaves out contains, types that are not asked for, edges inside one thing and edges with an end the level does not draw', () => {
    expect(edges.map((e) => `${e.source}>${e.target}`).sort()).toEqual(['group:a>group:b', 'group:c>group:b']);
    expect(edges.reduce((n, e) => n + e.count, 0)).toBe(7);
    // depends_on is not a default type, `calls` inside group a and the edge from an unknown node are not between two groups.
    expect(DEFAULT_EDGE_TYPES.has('depends_on')).toBe(false);
    const withDepends = aggregateEdges(EDGES, ends, new Set(['depends_on']));
    expect(withDepends).toHaveLength(1);
    expect(withDepends[0]).toMatchObject({ source: 'group:a', target: 'group:c', count: 1 });
    // contains is never a line, even when asked for.
    expect(aggregateEdges(EDGES, ends, new Set(['contains']))).toEqual([]);
  });

  it('gives each edge an id of its own and writes the count, and the types when there are several', () => {
    expect(new Set(edges.map((e) => e.id)).size).toBe(edges.length);
    expect(edgeLabel(between('a', 'b') as never)).toBe('5: 3 calls, 2 imports / back 1 calls');
    expect(edgeLabel(between('c', 'b') as never)).toBe('1 exports');
  });
});

describe('levelEnds', () => {
  it('lets a file stand for the nodes it owns, and a shown child for itself', () => {
    const level = buildLevel(structure, { path: 'a' }) as Level;
    const closed = levelEnds(level, index.owningFile, new Map());
    expect(closed('function:a/x.js:one')).toBe('file:a/x.js');
    expect(closed('file:a/y.js')).toBe('file:a/y.js');
    expect(closed('function:b/z.js:three')).toBeNull();
    expect(closed('function:nowhere')).toBeNull();
    const open = levelEnds(level, index.owningFile, new Map([['file:a/x.js', new Set(['function:a/x.js:one'])]]));
    expect(open('function:a/x.js:one')).toBe('function:a/x.js:one');
    expect(open('function:a/y.js:two')).toBe('file:a/y.js');
    const drawn = aggregateEdges(EDGES, open);
    expect(drawn.map((e) => `${e.source}>${e.target}:${e.count}`)).toEqual(['function:a/x.js:one>file:a/y.js:1']);
  });

  it('puts a file that was folded into the fold that holds it', () => {
    const many = Array.from({ length: 450 }, (_, i) => file(`d/f${String(i).padStart(3, '0')}.js`));
    const big = buildIndex({ nodes: many, edges: [edge('file:d/f000.js', 'file:d/f449.js', 'imports')] });
    const level = buildLevel(buildStructure(big), { path: 'd' }) as Level;
    const fold = level.entries.find((e) => e.kind === 'fold');
    expect(levelEnds(level, big.owningFile, new Map())('file:d/f449.js')).toBe(fold?.id);
  });
});
