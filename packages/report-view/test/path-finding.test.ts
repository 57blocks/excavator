import { describe, expect, it } from 'vitest';

import type { GraphEdge, GraphNode } from '../src/data/graph';
import { buildIndex } from '../src/data/indexes';
import { shortestPath } from '../src/lib/path-finding';

const n = (id: string): GraphNode => ({ id, type: 'function', name: id });
const e = (source: string, target: string, type = 'calls'): GraphEdge => ({ source, target, type });

//   a -> b -> c -> d      a -> x -> d (shorter)      z is on its own     d -> q (only against the arrow from q)
const index = buildIndex({
  nodes: ['a', 'b', 'c', 'd', 'x', 'z', 'q'].map(n),
  edges: [e('a', 'b'), e('b', 'c'), e('c', 'd'), e('a', 'x', 'imports'), e('x', 'd', 'imports'), e('q', 'd')],
});

describe('shortestPath', () => {
  it('finds the path with the fewest edges and names the edge used at each step', () => {
    const found = shortestPath(index, 'a', 'd');
    expect(found?.nodes).toEqual(['a', 'x', 'd']);
    expect(found?.edges.map((edge) => `${edge.source}>${edge.target}:${edge.type}`)).toEqual(['a>x:imports', 'x>d:imports']);
  });

  it('follows an edge against its direction unless the path is directed', () => {
    expect(shortestPath(index, 'd', 'a')?.nodes).toEqual(['d', 'x', 'a']);
    expect(shortestPath(index, 'd', 'a', { directed: true })).toBeNull();
    expect(shortestPath(index, 'a', 'q')?.nodes).toEqual(['a', 'x', 'd', 'q']);
    expect(shortestPath(index, 'a', 'q', { directed: true })).toBeNull();
    expect(shortestPath(index, 'q', 'd', { directed: true })?.nodes).toEqual(['q', 'd']);
  });

  it('says there is no path between nodes that no edge joins, and for a node the graph does not have', () => {
    expect(shortestPath(index, 'a', 'z')).toBeNull();
    expect(shortestPath(index, 'a', 'missing')).toBeNull();
    expect(shortestPath(index, 'missing', 'a')).toBeNull();
  });

  it('gives a path of one node and no edge from a node to itself', () => {
    expect(shortestPath(index, 'b', 'b')).toEqual({ nodes: ['b'], edges: [] });
  });

  it('does not walk through an edge to something that is not a node', () => {
    const dangling = buildIndex({ nodes: [n('a'), n('b')], edges: [e('a', 'ghost'), e('ghost', 'b')] });
    expect(shortestPath(dangling, 'a', 'b')).toBeNull();
  });
});
