import { describe, expect, it } from 'vitest';

import type { ManifestProduct } from '../src/data/manifest';
import { keyNumbers } from '../src/lib/product-cards';

const product = (name: string, status: ManifestProduct['status'], extra: Partial<ManifestProduct> = {}): ManifestProduct => ({
  name, label: name, status, reason: null, revision: null, revisionNote: null, command: `/x-${name}`, file: `${name}.json`, payloads: [name], ...extra,
});

describe('the key numbers of a product card', () => {
  it('reads each number from the product field it names', () => {
    expect(keyNumbers(product('unused-code', 'included'), { data: { counts: { unused: 7, testOnly: 2, candidates: 99 } } }))
      .toEqual([{ label: 'Unused', value: 7 }, { label: 'Test only', value: 2 }]);
    expect(keyNumbers(product('doc-map', 'included'), { data: { counts: { units: 3, found: 2, files: 9 } } }))
      .toEqual([{ label: 'Units', value: 3 }, { label: 'Code found', value: 2 }]);
    expect(keyNumbers(product('domain-graph', 'different-revision', { counts: { domains: 2, flows: 3, steps: 5 } }), {}))
      .toEqual([{ label: 'Domains', value: 2 }, { label: 'Flows', value: 3 }]);
  });

  it('counts the entries of the hotspots files and pairs', () => {
    expect(keyNumbers(product('hotspots', 'included'), { data: { counts: { filesWithHistory: 40 }, files: [{}, {}, {}], pairs: [{}] } }))
      .toEqual([{ label: 'Files', value: 3 }, { label: 'Pairs', value: 1 }]);
  });

  it('says a field the product lacks is not provided (null), never 0', () => {
    expect(keyNumbers(product('unused-code', 'included'), { data: { counts: {} } })).toEqual([{ label: 'Unused', value: null }, { label: 'Test only', value: null }]);
    expect(keyNumbers(product('hotspots', 'included'), { data: {} })).toEqual([{ label: 'Files', value: null }, { label: 'Pairs', value: null }]);
  });

  it('has no numbers for a product that is not in the page, and none yet while its source is read', () => {
    expect(keyNumbers(product('unused-code', 'not-run'), { data: { counts: { unused: 7 } } })).toEqual([]);
    expect(keyNumbers(product('unused-code', 'included'), { data: null })).toBeNull();
    expect(keyNumbers(product('knowledge-graph', 'included'), { graph: null })).toBeNull();
    expect(keyNumbers(product('knowledge-graph', 'included'), { graph: { nodes: 4, edges: 5 } })).toEqual([{ label: 'Nodes', value: 4 }, { label: 'Edges', value: 5 }]);
  });

  it('counts the reports that were written', () => {
    const items = [
      { name: 'a', label: 'A', file: 'a.md', status: 'included' as const, command: '/a', payload: 'a' },
      { name: 'b', label: 'B', file: 'b.md', status: 'not-run' as const, command: '/b', payload: null },
    ];
    expect(keyNumbers(product('reports', 'included', { items }), {})).toEqual([{ label: 'Reports written', value: 1 }]);
  });
});
