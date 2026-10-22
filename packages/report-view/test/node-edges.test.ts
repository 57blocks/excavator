import { describe, expect, it } from 'vitest';

import type { GraphEdge, GraphNode } from '../src/data/graph';
import { buildIndex } from '../src/data/indexes';
import { nodeEdges } from '../src/lib/node-edges';

const n = (id: string, name = id, type = 'function'): GraphNode => ({ id, type, name });
const e = (source: string, target: string, type: string): GraphEdge => ({ source, target, type });

describe('nodeEdges', () => {
  const index = buildIndex({
    nodes: [n('a'), n('b', 'beta'), n('c', 'alpha'), n('d', 'delta'), n('f', 'file', 'file')],
    edges: [
      e('a', 'b', 'calls'), e('a', 'c', 'calls'), e('a', 'd', 'imports'), e('a', 'ghost', 'calls'),
      e('b', 'a', 'calls'), e('f', 'a', 'contains'), e('a', 'a', 'calls'),
    ],
  });

  it('groups the outgoing edges by type, the larger group first, and orders each group by the name at the other end', () => {
    const out = nodeEdges(index, 'a');
    expect(out.outTotal).toBe(5);
    expect(out.out.map((g) => [g.type, g.ends.map((end) => end.other?.name ?? end.otherId)])).toEqual([
      ['calls', ['a', 'alpha', 'beta', 'ghost']],
      ['imports', ['delta']],
    ]);
  });

  it('groups the incoming edges the same way, with the node at the source as the other end', () => {
    const into = nodeEdges(index, 'a');
    expect(into.inTotal).toBe(3);
    expect(into.in.map((g) => [g.type, g.ends.map((end) => end.otherId)]).sort()).toEqual([['calls', ['a', 'b']], ['contains', ['f']]]);
  });

  it('keeps an edge whose other end is not a node, with no node, and counts it', () => {
    const ghost = nodeEdges(index, 'a').out.flatMap((g) => g.ends).find((end) => end.otherId === 'ghost');
    expect(ghost).toMatchObject({ other: null });
  });

  it('lists a node with no edges as empty groups, not as zero groups of something', () => {
    const lonely = nodeEdges(buildIndex({ nodes: [n('x')], edges: [] }), 'x');
    expect(lonely).toEqual({ out: [], in: [], outTotal: 0, inTotal: 0 });
  });
});
