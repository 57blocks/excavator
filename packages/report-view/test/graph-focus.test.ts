import { describe, expect, it } from 'vitest';

import type { GraphEdge, GraphNode } from '../src/data/graph';
import { buildIndex } from '../src/data/indexes';
import { FOCUS_LIMIT, focusSet } from '../src/lib/graph-focus';

const n = (id: string, name = id, type = 'function'): GraphNode => ({ id, type, name });
const e = (source: string, target: string, type = 'calls'): GraphEdge => ({ source, target, type });
const ALL = new Set(['calls', 'imports', 'contains']);

const nodes = ['c', 'a', 'b', 'd', 'e', 'f', 'lonely'].map((id) => n(id));
const edges = [
  e('c', 'a'), e('c', 'b'), e('d', 'c'), e('c', 'e', 'imports'), e('e', 'c', 'imports'),
  e('c', 'c'), e('c', 'ghost'), e('c', 'a'), e('a', 'b'), e('b', 'f'),
];
const index = buildIndex({ nodes, edges });

/** The neighbours counted from the raw edge list, independently of the index tables. */
const distinctEnds = (center: string, types: ReadonlySet<string>) => new Set(
  edges.filter((x) => types.has(x.type)).flatMap((x) => (x.source === center ? [x.target] : x.target === center ? [x.source] : [])).filter((id) => id !== center && nodes.some((node) => node.id === id)),
);

describe('focusSet', () => {
  it('has as neighbours the distinct nodes at the other end of the in and out edges, without the node itself or an end that is no node', () => {
    const set = focusSet(index, 'c', { edgeTypes: ALL });
    expect(set.neighbours).toEqual(['a', 'b', 'd', 'e']);
    expect(set.neighbours.length).toBe(distinctEnds('c', ALL).size);
    expect(set.neighbours).not.toContain('c');
    expect(set.neighbours).not.toContain('ghost');
  });

  it('counts a node that is both a caller and a callee once', () => {
    expect(focusSet(index, 'c', { edgeTypes: ALL }).neighbours.filter((id) => id === 'e')).toHaveLength(1);
  });

  it('keeps only the neighbours reached by the shown edge types', () => {
    const calls = focusSet(index, 'c', { edgeTypes: new Set(['calls']) });
    expect(calls.neighbours).toEqual(['a', 'b', 'd']);
    expect(calls.neighbours.length).toBe(distinctEnds('c', new Set(['calls'])).size);
    expect(focusSet(index, 'c', { edgeTypes: new Set() }).neighbours).toEqual([]);
  });

  it('leaves out a neighbour that a filter hides', () => {
    expect(focusSet(index, 'c', { edgeTypes: ALL, nodeVisible: (id) => id !== 'b' }).neighbours).toEqual(['a', 'd', 'e']);
  });

  it('draws the edges among the node and its neighbours once each, and none that leave the set', () => {
    const set = focusSet(index, 'c', { edgeTypes: ALL });
    const keys = set.edges.map((x) => `${x.source}>${x.target}:${x.type}`).sort();
    expect(keys).toEqual(['a>b:calls', 'c>a:calls', 'c>b:calls', 'c>c:calls', 'c>e:imports', 'd>c:calls', 'e>c:imports']);
    expect(keys.some((key) => key.includes('f') || key.includes('ghost'))).toBe(false);
  });

  it('draws the first neighbours by name when there are more than the limit, and still counts them all', () => {
    const many = Array.from({ length: FOCUS_LIMIT + 5 }, (_, i) => n(`n${String(i).padStart(4, '0')}`));
    const hub = buildIndex({ nodes: [n('hub'), ...many], edges: many.map((m) => e('hub', m.id)) });
    const set = focusSet(hub, 'hub', { edgeTypes: ALL });
    expect(set.neighbours).toHaveLength(FOCUS_LIMIT + 5);
    expect(set.drawn).toEqual(set.neighbours.slice(0, FOCUS_LIMIT));
    expect(set.edges).toHaveLength(FOCUS_LIMIT);
  });

  it('gives a node with no edge no neighbour', () => {
    expect(focusSet(index, 'lonely', { edgeTypes: ALL })).toMatchObject({ neighbours: [], drawn: [], edges: [] });
  });
});
