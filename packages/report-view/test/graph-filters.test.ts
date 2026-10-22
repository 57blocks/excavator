import { describe, expect, it } from 'vitest';

import type { GraphEdge, GraphNode } from '../src/data/graph';
import { buildIndex } from '../src/data/indexes';
import { filterableEdgeTypes, filterChoices, hiddenCount, NO_FILTERS, shownEdgeTypes, toggleEdgeType, toggleLayer, toggleNodeType, type FilterChoices } from '../src/lib/graph-filters';
import { aggregateEdges } from '../src/lib/graph-edges';
import { buildLevel, buildStructure, type Level } from '../src/lib/graph-structure';
import { visibilityOf, visibleLevel } from '../src/lib/graph-visibility';

const choices: FilterChoices = {
  nodeTypes: ['class', 'file', 'function'],
  edgeTypes: ['calls', 'contains', 'exports', 'imports', 'mentions'],
  layers: [{ key: 'l1', label: 'One' }, { key: 'l2', label: 'Two' }],
};

describe('the edge types a view shows', () => {
  it('defaults a level to imports, calls and exports, and a focus view to every type', () => {
    expect([...shownEdgeTypes(NO_FILTERS, choices.edgeTypes, false)].sort()).toEqual(['calls', 'exports', 'imports']);
    expect([...shownEdgeTypes(NO_FILTERS, choices.edgeTypes, true)].sort()).toEqual(choices.edgeTypes);
  });

  it('leaves contains out of the choices at a level, where it is nesting', () => {
    expect(filterableEdgeTypes(choices.edgeTypes, false)).not.toContain('contains');
    expect(filterableEdgeTypes(choices.edgeTypes, true)).toContain('contains');
  });

  it('turns the default into an explicit set on the first toggle, and toggles from there', () => {
    const off = toggleEdgeType(NO_FILTERS, 'calls', choices.edgeTypes, false);
    expect([...shownEdgeTypes(off, choices.edgeTypes, false)].sort()).toEqual(['exports', 'imports']);
    const on = toggleEdgeType(off, 'mentions', choices.edgeTypes, false);
    expect([...shownEdgeTypes(on, choices.edgeTypes, false)].sort()).toEqual(['exports', 'imports', 'mentions']);
  });
});

describe('hiddenCount', () => {
  it('counts the edge types a level does not draw by default, and nothing in a focus view', () => {
    expect(hiddenCount(NO_FILTERS, choices, false)).toBe(1);
    expect(hiddenCount(NO_FILTERS, choices, true)).toBe(0);
  });

  it('adds hidden node types, edge types and layers', () => {
    let filters = toggleNodeType(NO_FILTERS, 'class');
    filters = toggleLayer(filters, 'l2');
    filters = toggleEdgeType(filters, 'calls', choices.edgeTypes, false);
    expect(hiddenCount(filters, choices, false)).toBe(1 + 1 + 1 + 1);
  });

  it('does not count a node type or a layer the graph does not have', () => {
    expect(hiddenCount(toggleNodeType(toggleLayer(NO_FILTERS, 'gone'), 'gone'), choices, true)).toBe(0);
  });
});

const file = (path: string, type = 'file'): GraphNode => ({ id: `file:${path}`, type, name: path.slice(path.lastIndexOf('/') + 1), filePath: path });
const fn = (path: string, name: string): GraphNode => ({ id: `function:${path}:${name}`, type: 'function', name, filePath: path });
const contains = (path: string, name: string): GraphEdge => ({ source: `file:${path}`, target: `function:${path}:${name}`, type: 'contains' });

describe('visibility under the node-type and layer filters', () => {
  const nodes = [file('a/x.js'), file('b/y.js'), fn('a/x.js', 'one'), fn('b/y.js', 'two')];
  const edges: GraphEdge[] = [contains('a/x.js', 'one'), contains('b/y.js', 'two'), { source: 'function:a/x.js:one', target: 'function:b/y.js:two', type: 'calls' }];
  const index = buildIndex({ nodes, edges }, { entries: [], layers: [{ id: 'l1', name: 'One', nodeIds: ['file:a/x.js'] }, { id: 'l2', name: 'Two', nodeIds: ['file:b/y.js'] }] });
  const structure = buildStructure(index);

  it('needs nothing checked when no node type or layer is hidden', () => {
    expect(visibilityOf(index, structure, NO_FILTERS)).toBeNull();
  });

  it('hides a node whose type is hidden, and the nodes of a hidden layer', () => {
    const noFunctions = visibilityOf(index, structure, toggleNodeType(NO_FILTERS, 'function'));
    expect(noFunctions?.nodeVisible('function:a/x.js:one')).toBe(false);
    expect(noFunctions?.nodeVisible('file:a/x.js')).toBe(true);
    const noLayer = visibilityOf(index, structure, toggleLayer(NO_FILTERS, 'l2'));
    expect(noLayer?.nodeVisible('function:b/y.js:two')).toBe(false);
    expect(noLayer?.nodeVisible('function:a/x.js:one')).toBe(true);
  });

  it('draws an entry of the top level only while some file under it is visible, and keeps the level counts', () => {
    const top = buildLevel(structure, {}) as Level;
    const vis = visibilityOf(index, structure, toggleLayer(NO_FILTERS, 'l1'));
    const shown = visibleLevel(top, vis);
    expect(top.entries.map((entry) => entry.label).sort()).toEqual(['One', 'Two']);
    expect(shown.entries.map((entry) => entry.label)).toEqual(['Two']);
    expect(shown.files).toBe(top.files);
    expect(visibleLevel(top, null)).toBe(top);
  });

  it('draws no edge that ends at a hidden node', () => {
    const top = buildLevel(structure, {}) as Level;
    const ends = (hidden: string) => {
      const vis = visibilityOf(index, structure, toggleNodeType(NO_FILTERS, hidden));
      const entryOf = new Map(top.entries.flatMap((entry) => entry.members.map((m) => [m.id, entry.id] as const)));
      return aggregateEdges(edges, (id) => (vis?.nodeVisible(id) === false ? null : (entryOf.get(index.owningFile.get(id) ?? '') ?? null)));
    };
    expect(ends('class')).toHaveLength(1);
    expect(ends('function')).toHaveLength(0);
  });
});

describe('filterChoices', () => {
  it('lists the node and edge types of the graph, sorted, and the layers only when the graph is grouped by layer', () => {
    const index = buildIndex({ nodes: [file('a.js'), fn('a.js', 'f')], edges: [contains('a.js', 'f')] });
    const structure = buildStructure(index);
    expect(filterChoices(index.nodesById.values(), [contains('a.js', 'f')], structure)).toEqual({ nodeTypes: ['file', 'function'], edgeTypes: ['contains'], layers: [] });
  });
});
