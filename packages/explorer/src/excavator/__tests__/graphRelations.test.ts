import { describe, expect, it } from 'vitest';

import {
  drawnHome, externalStandInId, layerPlacer, layerStandInId, overviewPlacer, projectRelations, relationIndex, relationsOfNode,
} from '../graphRelations';
import { relationRows } from '../products/relations';

const site = (unit: string, file: string, line: number, nodeId: string | null) => ({ unit, file, line, quote: `q ${file}`, nodeId, evidence: [] });

// Two files in a web layer, one in an api layer; functions inside them.
const NODES = new Set(['file:web/a.js', 'function:web/a.js:load', 'file:web/b.js', 'function:web/b.js:save', 'file:api/r.js', 'function:api/r.js:get', 'function:api/r.js:post']);
const PARENT = new Map([
  ['function:web/a.js:load', 'file:web/a.js'],
  ['function:web/b.js:save', 'file:web/b.js'],
  ['function:api/r.js:get', 'file:api/r.js'],
  ['function:api/r.js:post', 'file:api/r.js'],
]);

const PRODUCT = {
  relations: [
    { id: 'rel:1', kind: 'http', bucket: 'linked', addressKey: 'GET /orders', caller: site('unit:web', 'web/a.js', 3, 'function:web/a.js:load'), receiver: site('unit:api', 'api/r.js', 7, 'function:api/r.js:get') },
    { id: 'rel:2', kind: 'http', bucket: 'linked', addressKey: 'GET /orders', caller: site('unit:web', 'web/a.js', 9, 'function:web/a.js:load'), receiver: site('unit:api', 'api/r.js', 7, 'function:api/r.js:get') },
    { id: 'rel:3', kind: 'http', bucket: 'linked', addressKey: 'POST /orders', caller: site('unit:web', 'web/b.js', 2, 'function:web/b.js:save'), receiver: site('unit:api', 'api/r.js', 12, 'function:api/r.js:post') },
    { id: 'rel:4', kind: 'external', bucket: 'linked', addressKey: 'external:mail', caller: site('unit:api', 'api/r.js', 14, 'function:api/r.js:post'), receiver: { external: 'external:mail' } },
    // Linked, but the receiver's node is not in the graph, and a caller that records no node.
    { id: 'rel:5', kind: 'http', bucket: 'linked', addressKey: 'GET /gone', caller: site('unit:web', 'web/b.js', 5, 'function:web/b.js:save'), receiver: site('unit:api', 'api/old.js', 1, 'function:api/old.js:x') },
    { id: 'rel:6', kind: 'external', bucket: 'linked', addressKey: 'external:maps', caller: site('unit:web', 'web/b.js', 6, null), receiver: { external: 'external:maps' } },
    // Not linked: each has a known node on its one end and must never be drawn.
    { id: 'rel:7', kind: 'http', bucket: 'caller-only', addressKey: 'POST /refunds', caller: site('unit:web', 'web/a.js', 4, 'function:web/a.js:load'), receiver: null },
    { id: 'rel:8', kind: 'http', bucket: 'receiver-only', addressKey: 'GET /health', caller: null, receiver: site('unit:api', 'api/r.js', 1, 'function:api/r.js:get') },
    { id: 'rel:9', kind: 'http', bucket: 'ambiguous', addressKey: 'GET /x', caller: site('unit:web', 'web/a.js', 8, 'function:web/a.js:load'), receiver: null },
    { id: 'rel:10', kind: 'external', bucket: 'address-unresolved', role: 'caller', unresolved: 'a parameter', caller: site('unit:api', 'api/r.js', 20, 'function:api/r.js:post') },
  ],
};
const ROWS = relationRows(PRODUCT);
const INDEX = relationIndex(ROWS, NODES, PARENT);
const ids = (rows: { row: { id: string } }[] | { id: string }[]) => rows.map((r) => ('row' in r ? r.row.id : r.id));

describe('relationIndex', () => {
  it('draws only linked relations whose ends are known, and counts the rest', () => {
    expect(INDEX.total).toBe(10);
    expect(INDEX.linked).toBe(6);
    expect(ids(INDEX.drawable)).toEqual(['rel:1', 'rel:2', 'rel:3', 'rel:4']);
    expect(ids(INDEX.notInGraph)).toEqual(['rel:5', 'rel:6']);
    expect(INDEX.notLinked).toBe(4);
    expect(INDEX.drawable.length + INDEX.notInGraph.length + INDEX.notLinked).toBe(INDEX.total);
  });

  it('keeps the external system id as the receiver', () => {
    const mail = INDEX.drawable.find((r) => r.row.id === 'rel:4');
    expect(mail).toMatchObject({ kind: 'external', caller: 'function:api/r.js:post', receiver: 'external:mail', external: true });
  });

  it('lists every relation, in any bucket, under its end node and the nodes containing it', () => {
    expect(ids(INDEX.byNode.get('function:web/a.js:load') ?? [])).toEqual(['rel:1', 'rel:2', 'rel:7', 'rel:9']);
    expect(ids(INDEX.byNode.get('file:web/a.js') ?? [])).toEqual(['rel:1', 'rel:2', 'rel:7', 'rel:9']);
    const api = INDEX.byNode.get('file:api/r.js') ?? [];
    expect(api.map((e) => `${e.row.id}:${e.role}:${e.endNodeId}`)).toEqual([
      'rel:1:receiver:function:api/r.js:get', 'rel:2:receiver:function:api/r.js:get', 'rel:3:receiver:function:api/r.js:post',
      'rel:4:caller:function:api/r.js:post', 'rel:8:receiver:function:api/r.js:get', 'rel:10:caller:function:api/r.js:post',
    ]);
    // An end whose node is not in the graph is listed under no node.
    expect(INDEX.byNode.has('function:api/old.js:x')).toBe(false);
  });

  it('gives a node only its own drawable relations', () => {
    expect(ids(relationsOfNode(INDEX, 'file:web/b.js'))).toEqual(['rel:3']);
    expect(ids(relationsOfNode(INDEX, 'function:api/r.js:post'))).toEqual(['rel:3', 'rel:4']);
    expect(relationsOfNode(INDEX, 'file:none')).toEqual([]);
  });
});

describe('placing ends', () => {
  const drawn = new Set(['file:web/a.js', 'file:web/b.js', 'file:api/r.js']);
  const home = (id: string) => drawnHome(id, drawn, PARENT);
  const layerOf = new Map([['file:web/a.js', 'layer:web'], ['file:web/b.js', 'layer:web'], ['file:api/r.js', 'layer:api']]);
  const layersOf = new Map([...layerOf].map(([n, l]) => [n, new Set([l])]));

  it('puts a function end at the file that holds it', () => {
    expect(home('function:web/a.js:load')).toBe('file:web/a.js');
    expect(home('file:api/r.js')).toBe('file:api/r.js');
    expect(home('function:nowhere')).toBeNull();
  });

  it('draws one overview edge per layer pair and kind, with every relation on it', () => {
    const { edges, standIns, drawn: count, inView } = projectRelations(INDEX.drawable, overviewPlacer(home, layerOf));
    expect(edges.map((e) => `${e.id}=${e.relations.length}`)).toEqual([
      'relation|external|layer:api|relations:external:mail=1',
      'relation|http|layer:web|layer:api=3',
    ]);
    expect(standIns).toEqual([{ id: externalStandInId('external:mail'), kind: 'external', key: 'external:mail' }]);
    expect(count).toBe(4);
    expect(inView).toBe(4);
  });

  it('in a layer, draws to the drawn file, the closed box, or the other layer stand-in', () => {
    // web layer: a.js drawn on its own, b.js inside a closed box.
    const web = layerPlacer({ home, layerOf, layersOf, activeLayerId: 'layer:web', shown: new Set(['file:web/a.js', 'container:web/sub']), boxOf: new Map([['file:web/b.js', 'container:web/sub'], ['file:web/a.js', 'file:web/a.js']]) });
    const inWeb = projectRelations(INDEX.drawable, web);
    expect(inWeb.edges.map((e) => `${e.id}=${e.relations.length}`)).toEqual([
      'relation|http|container:web/sub|relations:layer:layer:api=1',
      'relation|http|file:web/a.js|relations:layer:layer:api=2',
    ]);
    expect(inWeb.standIns).toEqual([{ id: layerStandInId('layer:api'), kind: 'layer', key: 'layer:api' }]);
    // The external call starts in the api layer; from the web layer both of its ends are elsewhere, so it is no edge here.
    expect(inWeb.drawn).toBe(3);
    expect(inWeb.inView).toBe(3);

    const api = layerPlacer({ home, layerOf, layersOf, activeLayerId: 'layer:api', shown: new Set(['file:api/r.js']), boxOf: new Map() });
    const inApi = projectRelations(INDEX.drawable, api);
    expect(inApi.edges.map((e) => e.id)).toEqual([
      'relation|external|file:api/r.js|relations:external:mail',
      'relation|http|relations:layer:layer:web|file:api/r.js',
    ]);
  });

  it('draws no edge for an end the view does not show, nor for two ends on one node', () => {
    const hidden = layerPlacer({ home, layerOf, layersOf, activeLayerId: 'layer:web', shown: new Set(), boxOf: new Map() });
    const none = projectRelations(INDEX.drawable, hidden);
    expect(none.edges).toEqual([]);
    expect(none.inView).toBe(0);
    // Both ends of the three http relations on one box: counted in the view, no edge.
    const together = projectRelations(INDEX.drawable, () => 'one-box');
    expect(together.edges.map((e) => e.id)).toEqual(['relation|external|one-box|relations:external:mail']);
    expect(together.drawn).toBe(1);
    expect(together.inView).toBe(4);
  });

  it('a node in two layers is drawn in either', () => {
    const both = new Map(layersOf);
    both.set('file:api/r.js', new Set(['layer:api', 'layer:web']));
    const web = layerPlacer({ home, layerOf, layersOf: both, activeLayerId: 'layer:web', shown: new Set(['file:web/a.js', 'file:web/b.js', 'file:api/r.js']), boxOf: new Map() });
    expect(projectRelations(INDEX.drawable, web).edges.map((e) => e.id)).toContain('relation|http|file:web/a.js|file:api/r.js');
  });
});
