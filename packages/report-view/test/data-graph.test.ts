import { describe, expect, it } from 'vitest';

import { GRAPH_FORMAT, parseGraphJsonl, type GraphEdge, type GraphNode } from '../src/data/graph';
import { buildIndex, fileNodeId } from '../src/data/indexes';
import { mapDocMapCoverageFiles, mapHotspotFiles, mapUnused } from '../src/data/product-mapping';

/**
 * A synthetic graph with identity traps: two files named a.ts under different
 * directories, two functions named `open` with different owners, a method
 * contained both by its file and by its class, a function with no `contains`
 * edge, and nodes that have no file node at all.
 */
const NODES: GraphNode[] = [
  { id: 'file:src/a.ts', type: 'file', name: 'a.ts', filePath: 'src/a.ts' },
  { id: 'file:src/b.ts', type: 'file', name: 'b.ts', filePath: 'src/b.ts' },
  { id: 'file:lib/a.ts', type: 'file', name: 'a.ts', filePath: 'lib/a.ts' },
  { id: 'class:src/a.ts:Box', type: 'class', name: 'Box', filePath: 'src/a.ts', lineRange: [1, 9] },
  { id: 'function:src/a.ts:Box.open', type: 'function', name: 'open', owner: 'Box', filePath: 'src/a.ts', lineRange: [2, 4] },
  { id: 'function:src/b.ts:open', type: 'function', name: 'open', filePath: 'src/b.ts', lineRange: [1, 3] },
  { id: 'function:lib/a.ts:helper', type: 'function', name: 'helper', filePath: 'lib/a.ts' },
  { id: 'module:loose', type: 'module', name: 'loose' },
  { id: 'function:src/c.ts:ghost', type: 'function', name: 'ghost', filePath: 'src/c.ts' },
];
const EDGES: GraphEdge[] = [
  { source: 'file:src/a.ts', target: 'class:src/a.ts:Box', type: 'contains' },
  { source: 'file:src/a.ts', target: 'function:src/a.ts:Box.open', type: 'contains' },
  { source: 'class:src/a.ts:Box', target: 'function:src/a.ts:Box.open', type: 'contains' },
  { source: 'file:src/b.ts', target: 'function:src/b.ts:open', type: 'contains' },
  { source: 'function:src/a.ts:Box.open', target: 'function:src/b.ts:open', type: 'calls' },
  { source: 'file:src/a.ts', target: 'file:src/b.ts', type: 'imports' },
  { source: 'function:src/b.ts:open', target: 'function:elsewhere', type: 'calls' },
];

function jsonl(lines: unknown[]): string {
  return `${lines.map((line) => (typeof line === 'string' ? line : JSON.stringify(line))).join('\n')}\n`;
}

function graphText(extra: unknown[] = [], counts: Record<string, number> = {}) {
  return jsonl([
    {
      record: 'header',
      format: GRAPH_FORMAT,
      keys: ['project', 'nodes', 'edges', 'layers', 'gaps', 'coverage'],
      fields: { project: { name: 'fixture' } },
      counts: { nodes: NODES.length, edges: EDGES.length, layers: 1, gaps: 1, ...counts },
    },
    ...NODES.map((node) => ({ record: 'node', node })),
    ...EDGES.map((edge) => ({ record: 'edge', edge })),
    { record: 'layer', layer: { id: 'layer:core', name: 'Core', nodeIds: ['file:src/a.ts'] } },
    { record: 'gap', gap: { kind: 'unsupported-language', path: 'src/x.zig' } },
    { record: 'coverage', coverage: { files: 3 } },
    ...extra,
  ]);
}

const ids = (edges: { source: string; target: string; type: string }[] | undefined) => (edges ?? []).map((e) => `${e.type}:${e.source}->${e.target}`);

describe('parseGraphJsonl', () => {
  it('reads every record stream of the store layout', () => {
    const graph = parseGraphJsonl(graphText());
    expect(graph.header.fields).toEqual({ project: { name: 'fixture' } });
    expect(graph.nodes.map((n) => n.id)).toEqual(NODES.map((n) => n.id));
    expect(graph.edges).toHaveLength(EDGES.length);
    expect(graph.layers.map((l) => l.id)).toEqual(['layer:core']);
    expect(graph.gaps).toEqual([{ kind: 'unsupported-language', path: 'src/x.zig' }]);
    expect(graph.coverage).toEqual({ files: 3 });
    expect(graph.problems).toEqual([]);
    expect(graph.countMismatches).toEqual([]);
  });

  it('puts every line it cannot use in a visible problem, with its line number', () => {
    const lines = 1 + NODES.length + EDGES.length + 3; // header, nodes, edges, then layer, gap, coverage
    const graph = parseGraphJsonl(graphText([
      '{not json',
      { record: 'mystery', value: 1 },
      { record: 'node', node: { type: 'file', name: 'no id' } },
      { record: 'edge', edge: { source: 'a', type: 'calls' } },
      { record: 'header', format: GRAPH_FORMAT, fields: {}, counts: {} },
      { record: 'coverage', coverage: { files: 99 } },
    ]));
    expect(graph.problems.map((p) => [p.line, p.kind])).toEqual([
      [lines + 1, 'not-json'],
      [lines + 2, 'unknown-record'],
      [lines + 3, 'invalid-record'],
      [lines + 4, 'invalid-record'],
      [lines + 5, 'second-header'],
      [lines + 6, 'second-coverage'],
    ]);
    expect(graph.coverage).toEqual({ files: 3 });
    // The invalid node and edge were read, so their streams no longer match the header.
    expect(graph.countMismatches).toEqual([
      { stream: 'nodes', header: NODES.length, read: NODES.length + 1 },
      { stream: 'edges', header: EDGES.length, read: EDGES.length + 1 },
    ]);
  });

  it('reports a stream whose record count differs from the header', () => {
    const graph = parseGraphJsonl(graphText([], { nodes: NODES.length + 2, tour: 1 }));
    expect(graph.countMismatches).toEqual([
      { stream: 'nodes', header: NODES.length + 2, read: NODES.length },
      { stream: 'tour', header: 1, read: 0 },
    ]);
  });

  it('refuses a text whose first record is not a header of the known format', () => {
    expect(() => parseGraphJsonl('')).toThrow('the knowledge graph is empty');
    expect(() => parseGraphJsonl(jsonl([{ record: 'node', node: NODES[0] }]))).toThrow('the knowledge graph does not start with a header record');
    expect(() => parseGraphJsonl(jsonl([{ record: 'header', format: 'other/1', fields: {}, counts: {} }]))).toThrow(/has format "other\/1"/);
  });
});

describe('buildIndex', () => {
  const index = buildIndex(parseGraphJsonl(graphText()));

  it('lists each node\'s outgoing and incoming edges', () => {
    expect(ids(index.outEdges.get('file:src/a.ts'))).toEqual([
      'contains:file:src/a.ts->class:src/a.ts:Box',
      'contains:file:src/a.ts->function:src/a.ts:Box.open',
      'imports:file:src/a.ts->file:src/b.ts',
    ]);
    expect(ids(index.inEdges.get('function:src/a.ts:Box.open'))).toEqual([
      'contains:file:src/a.ts->function:src/a.ts:Box.open',
      'contains:class:src/a.ts:Box->function:src/a.ts:Box.open',
    ]);
    expect(ids(index.inEdges.get('function:src/b.ts:open'))).toEqual([
      'contains:file:src/b.ts->function:src/b.ts:open',
      'calls:function:src/a.ts:Box.open->function:src/b.ts:open',
    ]);
    expect(index.outEdges.get('module:loose')).toBeUndefined();
  });

  it('keeps nodes with the same name apart by id and nodes with the same file name apart by path', () => {
    expect(index.nodesByFilePath.get('src/a.ts')?.map((n) => n.id)).toEqual([
      'file:src/a.ts',
      'class:src/a.ts:Box',
      'function:src/a.ts:Box.open',
    ]);
    expect(index.nodesByFilePath.get('lib/a.ts')?.map((n) => n.id)).toEqual(['file:lib/a.ts', 'function:lib/a.ts:helper']);
  });

  it('maps each node to its owning file through reversed contains edges, then through file:<filePath>', () => {
    expect(Object.fromEntries(index.owningFile)).toEqual({
      'file:src/a.ts': 'file:src/a.ts',
      'file:src/b.ts': 'file:src/b.ts',
      'file:lib/a.ts': 'file:lib/a.ts',
      'class:src/a.ts:Box': 'file:src/a.ts',
      'function:src/a.ts:Box.open': 'file:src/a.ts',
      'function:src/b.ts:open': 'file:src/b.ts',
      'function:lib/a.ts:helper': 'file:lib/a.ts',
    });
    expect(index.unowned).toEqual(['module:loose', 'function:src/c.ts:ghost']);
  });

  it('follows contains through a class when the file does not contain the method directly', () => {
    const graph = parseGraphJsonl(graphText());
    graph.edges = graph.edges.filter((e) => !(e.source === 'file:src/a.ts' && e.target === 'function:src/a.ts:Box.open'));
    // Moving the method's filePath shows the owner comes from the contains chain, not from the fallback.
    graph.nodes = graph.nodes.map((n) => (n.id === 'function:src/a.ts:Box.open' ? { ...n, filePath: 'lib/a.ts' } : n));
    expect(buildIndex(graph).owningFile.get('function:src/a.ts:Box.open')).toBe('file:src/a.ts');
  });

  it('lists edges to nodes the graph lacks and repeated node ids', () => {
    expect(ids(index.danglingEdges)).toEqual(['calls:function:src/b.ts:open->function:elsewhere']);
    const repeated = buildIndex({ nodes: [...NODES, { id: 'file:src/a.ts', type: 'file', name: 'again' }], edges: [] });
    expect(repeated.duplicateNodeIds).toEqual(['file:src/a.ts']);
    expect(repeated.nodesById.get('file:src/a.ts')?.name).toBe('a.ts');
  });
});

describe('product to node mapping', () => {
  const index = buildIndex(parseGraphJsonl(graphText()));

  it('maps unused ids as node ids and keeps the ones the graph lacks', () => {
    const unused = { unused: [{ id: 'function:src/b.ts:open' }, { id: 'function:gone' }, { name: 'no id' }] };
    const mapping = mapUnused(unused, index);
    expect(mapping.mapped.map((m) => m.nodeId)).toEqual(['function:src/b.ts:open']);
    expect(mapping.notInGraph.map((m) => [m.reason, m.lookedUp])).toEqual([
      ['not-in-graph', 'function:gone'],
      ['no-key', null],
    ]);
  });

  it('maps hotspots file paths to file:<path> and keeps the ones the graph lacks', () => {
    const hotspots = { files: [{ path: 'src/a.ts' }, { path: 'lib/a.ts' }, { path: 'assets/logo.png' }, {}] };
    const mapping = mapHotspotFiles(hotspots, index);
    expect(mapping.mapped.map((m) => m.nodeId)).toEqual([fileNodeId('src/a.ts'), fileNodeId('lib/a.ts')]);
    expect(mapping.notInGraph.map((m) => [m.reason, m.lookedUp])).toEqual([
      ['not-in-graph', 'file:assets/logo.png'],
      ['no-key', null],
    ]);
  });

  it('maps doc-map coverage files to file:<path>; a doc map without coverage has none', () => {
    const docMap = { coverage: { files: [{ path: 'lib/a.ts' }, { path: 'docs/guide.md' }] } };
    const mapping = mapDocMapCoverageFiles(docMap, index);
    expect(mapping.mapped.map((m) => m.nodeId)).toEqual(['file:lib/a.ts']);
    expect(mapping.notInGraph.map((m) => m.lookedUp)).toEqual(['file:docs/guide.md']);
    expect(mapDocMapCoverageFiles({ coverage: null }, index)).toEqual({ mapped: [], notInGraph: [] });
  });

  it('never drops a record: mapped plus not in graph is every record', () => {
    const files = Array.from({ length: 40 }, (_, i) => (i % 3 === 0 ? {} : { path: i % 2 ? 'src/a.ts' : `x/${i}.ts` }));
    const mapping = mapHotspotFiles({ files }, index);
    expect(mapping.mapped.length + mapping.notInGraph.length).toBe(files.length);
    expect([...mapping.mapped, ...mapping.notInGraph].map((m) => files.indexOf(m.record as never)).sort((a, b) => a - b))
      .toEqual(files.map((_, i) => i));
  });
});
