import { describe, expect, it } from 'vitest';

import type { GraphLayer, GraphNode } from '../src/data/graph';
import { buildIndex } from '../src/data/indexes';
import { mergeSemantics, type SemanticPayload } from '../src/data/semantics';

const NODES: GraphNode[] = [
  { id: 'file:a.ts', type: 'file', name: 'a.ts', filePath: 'a.ts', summary: 'graph summary of a', tags: ['graph-a'] },
  { id: 'file:b.ts', type: 'file', name: 'b.ts', filePath: 'b.ts', summary: 'graph summary of b', tags: ['graph-b'] },
  { id: 'file:c.ts', type: 'file', name: 'c.ts', filePath: 'c.ts', summary: '', tags: [] },
  { id: 'file:d.ts', type: 'file', name: 'd.ts', filePath: 'd.ts', summary: 'graph summary of d', tags: ['graph-d'] },
  { id: 'file:e.ts', type: 'file', name: 'e.ts', filePath: 'e.ts' },
];
const GRAPH_LAYERS: GraphLayer[] = [{ id: 'layer:graph', name: 'From graph', nodeIds: ['file:a.ts'] }];
const SEMANTIC_LAYERS: GraphLayer[] = [{ id: 'layer:semantic', name: 'From semantics', nodeIds: ['file:a.ts', 'file:b.ts'] }];

const payload: SemanticPayload = {
  entries: [
    { id: 'file:a.ts', summary: 'semantic summary of a', tags: ['semantic-a'], verification: 'verified' },
    // A semantic entry with no text of its own does not erase the graph's.
    { id: 'file:b.ts', summary: '', tags: [], verification: 'unverified' },
    { id: 'file:c.ts', summary: 'semantic summary of c', tags: ['semantic-c'] },
    // The packer blanked this summary; the graph's own text must not fill the gap.
    { id: 'file:d.ts', summary: '', tags: ['semantic-d'], verification: 'contradicted' },
    { id: 'file:gone.ts', summary: 'for a node the graph lacks', tags: [] },
  ],
  layers: SEMANTIC_LAYERS,
};

describe('mergeSemantics: summary, tags and verification', () => {
  const merged = mergeSemantics(NODES, GRAPH_LAYERS, payload);
  const of = (id: string) => merged.byNode.get(id);

  it('takes summary and tags from the semantic entry before the node\'s own fields', () => {
    expect(of('file:a.ts')).toEqual({ summary: 'semantic summary of a', tags: ['semantic-a'], verification: 'verified', source: 'semantic' });
    expect(of('file:c.ts')).toEqual({ summary: 'semantic summary of c', tags: ['semantic-c'], verification: null, source: 'semantic' });
  });

  it('falls back to the node\'s own summary and tags where the entry has none', () => {
    expect(of('file:b.ts')).toEqual({ summary: 'graph summary of b', tags: ['graph-b'], verification: 'unverified', source: 'graph' });
  });

  it('uses the node\'s own fields for a node with no entry, and says when there are none', () => {
    const noEntries = mergeSemantics(NODES, [], { entries: [] });
    expect(noEntries.byNode.get('file:a.ts')).toEqual({ summary: 'graph summary of a', tags: ['graph-a'], verification: null, source: 'graph' });
    expect(noEntries.byNode.get('file:e.ts')).toEqual({ summary: '', tags: [], verification: null, source: 'none' });
  });

  it('keeps a contradicted entry\'s blank summary, with its verdict, instead of the graph\'s text', () => {
    expect(of('file:d.ts')).toEqual({ summary: '', tags: ['semantic-d'], verification: 'contradicted', source: 'none' });
  });

  it('never keeps a summary whose verdict is contradicted, whichever source it came from', () => {
    const leaked = mergeSemantics(
      [{ id: 'file:x.ts', type: 'file', name: 'x.ts', filePath: 'x.ts', summary: 'graph text that a verifier rejected', verification: 'contradicted' }, ...NODES],
      [],
      { entries: [{ id: 'file:a.ts', summary: 'text that came with a contradicted verdict', tags: [], verification: 'contradicted' }] },
    );
    expect(leaked.byNode.get('file:x.ts')).toMatchObject({ summary: '', verification: 'contradicted', source: 'none' });
    expect(leaked.byNode.get('file:a.ts')).toMatchObject({ summary: '', verification: 'contradicted', source: 'none' });
  });

  it('has a row for every node and lists the entry whose node the graph lacks', () => {
    expect([...merged.byNode.keys()]).toEqual(NODES.map((n) => n.id));
    expect(merged.orphanEntries.map((e) => e.id)).toEqual(['file:gone.ts']);
  });

  it('works without a semantic payload (Lazy mode)', () => {
    for (const absent of [undefined, null]) {
      const lazy = mergeSemantics(NODES, GRAPH_LAYERS, absent);
      expect(lazy.byNode.get('file:a.ts')?.summary).toBe('graph summary of a');
      expect(lazy.orphanEntries).toEqual([]);
    }
  });
});

describe('mergeSemantics: layers', () => {
  it('takes the semantic layers before the graph\'s layer records', () => {
    const merged = mergeSemantics(NODES, GRAPH_LAYERS, payload);
    expect(merged.layers.map((l) => l.id)).toEqual(['layer:semantic']);
    expect(merged.layerSource).toBe('semantic');
  });

  it('takes the graph\'s layer records when the payload has none, or no payload is given', () => {
    for (const semantics of [{ entries: [] }, { entries: [], layers: [] }, null, undefined]) {
      const merged = mergeSemantics(NODES, GRAPH_LAYERS, semantics);
      expect(merged.layers.map((l) => l.id)).toEqual(['layer:graph']);
      expect(merged.layerSource).toBe('graph');
    }
  });

  it('reports no layers when neither source has any', () => {
    expect(mergeSemantics(NODES, [], null)).toMatchObject({ layers: [], layerSource: 'none' });
  });
});

describe('buildIndex with a semantic payload', () => {
  it('merges the payload into index.semantics and leaves the structural tables alone', () => {
    const merged = buildIndex({ nodes: NODES, edges: [], layers: GRAPH_LAYERS }, payload);
    expect(merged.semantics.byNode.get('file:a.ts')?.summary).toBe('semantic summary of a');
    expect(merged.semantics.layerSource).toBe('semantic');
    expect(merged.nodesById.get('file:a.ts')?.summary).toBe('graph summary of a');
  });

  it('merges nothing when no payload is given', () => {
    const lazy = buildIndex({ nodes: NODES, edges: [], layers: GRAPH_LAYERS });
    expect(lazy.semantics.byNode.get('file:a.ts')?.summary).toBe('graph summary of a');
    expect(lazy.semantics.layerSource).toBe('graph');
  });
});
