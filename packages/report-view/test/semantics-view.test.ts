import { describe, expect, it } from 'vitest';

import type { GraphNode } from '../src/data/graph';
import { buildIndex } from '../src/data/indexes';
import type { ManifestProduct } from '../src/data/manifest';
import type { SemanticPayload } from '../src/data/semantics';
import { semanticsCounts, semanticsDetail, semanticsStats } from '../src/lib/semantics-view';

const nodes: GraphNode[] = ['a', 'b', 'c', 'd', 'e'].map((n) => ({ id: `file:${n}.ts`, type: 'file', name: `${n}.ts`, filePath: `${n}.ts`, summary: '', tags: [] }));
const payload: SemanticPayload = {
  entries: [
    { id: 'file:a.ts', summary: 'A.', tags: [], verification: 'verified' },
    { id: 'file:b.ts', summary: 'B.', tags: [], verification: 'verified' },
    { id: 'file:c.ts', summary: 'C.', tags: [], verification: 'unverified' },
    { id: 'file:d.ts', summary: '', tags: [], verification: 'contradicted' },
    { id: 'file:e.ts', summary: 'E.', tags: [] },
  ],
  layers: [{ id: 'l1', name: 'One', nodeIds: ['file:a.ts'] }, { id: 'l2', name: 'Two', nodeIds: ['file:b.ts'] }],
};
const product = { name: 'semantics', counts: { entries: 5, stale: 7, byVerdict: {}, layers: 2 } } as unknown as ManifestProduct;
const index = buildIndex({ nodes, edges: [], layers: [{ id: 'g', name: 'Graph layer', nodeIds: [] }] }, payload);

describe('semanticsStats', () => {
  const stats = semanticsStats(index, payload, product);

  it('counts the entries by verdict, with no verdict as unchecked', () => {
    expect(stats.byVerdict).toEqual({ verified: 2, unverified: 1, contradicted: 1, unchecked: 1 });
    expect(stats.entries).toBe(5);
  });

  it('takes the stale count from the packer, and null when it gave none', () => {
    expect(stats.stale).toBe(7);
    expect(semanticsStats(index, payload, undefined).stale).toBeNull();
  });

  it('counts the summaries the merged index shows, not the contradicted one', () => {
    expect(stats.summariesShown).toBe(4);
  });

  it('takes the layers from the semantic graph, not the graph\'s own records', () => {
    expect(stats.layers).toBe(2);
    expect(stats.layerSource).toBe('semantic');
  });

  it('lists the nodes whose summary was contradicted', () => {
    expect(stats.contradicted).toEqual([{ id: 'file:d.ts', name: 'd.ts', type: 'file', filePath: 'd.ts' }]);
  });

  it('lists a verdict the verifier wrote that the page does not name, after the named ones', () => {
    const odd = semanticsStats(index, { entries: [{ id: 'file:a.ts', summary: 'A.', tags: [], verification: 'dirty' }] }, product);
    expect(Object.keys(odd.byVerdict)).toEqual(['verified', 'unverified', 'contradicted', 'unchecked', 'dirty']);
  });
});

describe('what the Overview publishes and says', () => {
  const stats = semanticsStats(index, payload, product);

  it('publishes one count per figure, and only for verdicts it names', () => {
    expect(semanticsCounts(stats)).toEqual({
      'semantic-entries': 5, 'semantic-layers': 2, 'summaries-shown': 4, 'semantic-stale': 7,
      'semantic-verified': 2, 'semantic-unverified': 1, 'semantic-contradicted': 1, 'semantic-unchecked': 1,
    });
    const odd = semanticsStats(index, { entries: [{ id: 'file:a.ts', summary: 'A.', tags: [], verification: 'a b' }] }, product);
    expect(Object.keys(semanticsCounts(odd)).every((key) => /^[a-z-]+$/.test(key))).toBe(true);
  });

  it('says how many summaries were inlined, how many were left out as not fresh, and the layers', () => {
    expect(semanticsDetail(stats)).toBe('5 summaries inlined; 7 not fresh and left out; 2 layers.');
    expect(semanticsDetail({ ...stats, stale: null })).toBe('5 summaries inlined; 2 layers.');
  });
});
