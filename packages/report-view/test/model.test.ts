import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { GRAPH_FORMAT } from '../src/data/graph';
import type { Manifest, ManifestProduct } from '../src/data/manifest';
import { loadGraphModel } from '../src/data/model';
import { PayloadReader } from '../src/data/payload';

const packed = (text: string) => gzipSync(Buffer.from(text, 'utf-8')).toString('base64');
const reader = (elements: Record<string, string>) => new PayloadReader({
  getElementById: (id) => (Object.hasOwn(elements, id) ? { textContent: elements[id] } : null),
});

const graphText = `${[
  { record: 'header', format: GRAPH_FORMAT, keys: ['nodes'], fields: {}, counts: { nodes: 2 } },
  { record: 'node', node: { id: 'file:a.ts', type: 'file', name: 'a.ts', filePath: 'a.ts', summary: 'graph text', tags: ['graph'] } },
  { record: 'node', node: { id: 'file:b.ts', type: 'file', name: 'b.ts', filePath: 'b.ts', summary: 'only in the graph', tags: [] } },
].map((r) => JSON.stringify(r)).join('\n')}\n`;
const semanticsText = JSON.stringify({
  entries: [{ id: 'file:a.ts', summary: 'semantic text', tags: ['semantic'], verification: 'verified' }],
  layers: [{ id: 'l', name: 'Layer', nodeIds: ['file:a.ts'] }],
});

const product = (name: string, status: ManifestProduct['status'], payloads: string[]): ManifestProduct => ({
  name, label: name, status, reason: null, revision: null, revisionNote: null, command: '/x', file: `${name}.json`, payloads,
});
const manifestOf = (...products: ManifestProduct[]): Manifest => ({
  viewer: 1,
  project: { name: 'fixture' },
  snapshot: { revision: 'git:abc', kind: 'git' },
  products,
  source: { embedded: false, requested: true, limitBytes: 1, counts: { embedded: 0, binary: 0, tooLarge: 0, notInSnapshot: 0, notEmbeddedOnRequest: 0 }, files: {} },
});

describe('loadGraphModel', () => {
  it('merges the semantic payload into the index, semantic text before the graph\'s own', async () => {
    const payloads = reader({ 'xv-knowledge-graph': packed(graphText), 'xv-semantics': packed(semanticsText) });
    const model = await loadGraphModel(manifestOf(product('knowledge-graph', 'included', ['knowledge-graph']), product('semantics', 'included', ['semantics'])), payloads);
    expect(model?.index.semantics.byNode.get('file:a.ts')).toMatchObject({ summary: 'semantic text', tags: ['semantic'], verification: 'verified', source: 'semantic' });
    expect(model?.index.semantics.byNode.get('file:b.ts')).toMatchObject({ summary: 'only in the graph', source: 'graph' });
    expect(model?.index.semantics.layers.map((l) => l.id)).toEqual(['l']);
  });

  it('uses the graph\'s own fields when the semantics product is not run, even if a payload element is there', async () => {
    const payloads = reader({ 'xv-knowledge-graph': packed(graphText), 'xv-semantics': packed(semanticsText) });
    for (const status of ['not-run', 'unreadable'] as const) {
      const model = await loadGraphModel(manifestOf(product('knowledge-graph', 'included', ['knowledge-graph']), product('semantics', status, [])), payloads);
      expect(model?.semantics).toBeNull();
      expect(model?.index.semantics.byNode.get('file:a.ts')).toMatchObject({ summary: 'graph text', source: 'graph' });
    }
  });

  it('is null when the knowledge graph is not included', async () => {
    expect(await loadGraphModel(manifestOf(product('knowledge-graph', 'not-run', [])), reader({}))).toBeNull();
  });

  it('builds the model once per reader', async () => {
    const payloads = reader({ 'xv-knowledge-graph': packed(graphText) });
    const manifest = manifestOf(product('knowledge-graph', 'included', ['knowledge-graph']));
    expect(await loadGraphModel(manifest, payloads)).toBe(await loadGraphModel(manifest, payloads));
  });
});
