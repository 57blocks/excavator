import { describe, expect, it } from 'vitest';

import type { GraphEdge, GraphNode } from '../src/data/graph';
import { buildIndex } from '../src/data/indexes';
import { flowOf, layoutPlan, planLevel } from '../src/lib/graph-flow';
import { buildLevel, buildStructure, LEVEL_LIMIT, levelNotes, type Level } from '../src/lib/graph-structure';

const file = (path: string): GraphNode => ({ id: `file:${path}`, type: 'file', name: path.slice(path.lastIndexOf('/') + 1), filePath: path });
const fn = (path: string, name: string, line: number): GraphNode => ({ id: `function:${path}:${name}`, type: 'function', name, filePath: path, lineRange: [line, line + 1] });
const edge = (source: string, target: string, type: string): GraphEdge => ({ source, target, type });

const NODES = [file('a/x.js'), file('a/y.js'), file('b/z.js'), fn('a/x.js', 'one', 1), fn('a/x.js', 'two', 5), fn('a/y.js', 'three', 1), fn('b/z.js', 'four', 1)];
const EDGES = [
  edge('file:a/x.js', 'function:a/x.js:one', 'contains'),
  edge('file:a/x.js', 'function:a/x.js:two', 'contains'),
  edge('file:a/y.js', 'function:a/y.js:three', 'contains'),
  edge('function:a/x.js:one', 'function:a/y.js:three', 'calls'),
  edge('function:a/y.js:three', 'function:b/z.js:four', 'calls'),
  edge('file:a/x.js', 'file:a/y.js', 'imports'),
];
const view = { selected: null, onOpen: () => {}, onSelect: () => {}, onToggle: () => {} };

function setup(nodes = NODES, edges = EDGES) {
  const index = buildIndex({ nodes, edges });
  const structure = buildStructure(index);
  const level = buildLevel(structure, { path: 'a' }) as Level;
  return { index, structure, edges, level };
}

describe('planLevel', () => {
  it('opens a file to the nodes it owns, in the order of the file, and draws an edge to the node itself', () => {
    const { index, structure, edges, level } = setup();
    const closed = planLevel(structure, index, edges, level, new Set());
    expect(closed.open.size).toBe(0);
    expect(closed.edges.map((e) => `${e.source}>${e.target}:${e.count}`)).toEqual(['file:a/x.js>file:a/y.js:2']);

    const opened = planLevel(structure, index, edges, level, new Set(['file:a/x.js']));
    expect([...(opened.open.get('file:a/x.js')?.shown ?? [])].map((n) => n.name)).toEqual(['one', 'two']);
    expect(opened.fileOf.get('function:a/x.js:two')).toBe('file:a/x.js');
    expect(opened.edges.map((e) => `${e.source}>${e.target}:${e.count}`).sort()).toEqual(['file:a/x.js>file:a/y.js:1', 'function:a/x.js:one>file:a/y.js:1']);
  });

  it('opens nothing for a file that owns no node, or that the level does not draw', () => {
    const { index, structure, edges, level } = setup([file('a/x.js'), file('a/y.js')], []);
    expect(planLevel(structure, index, edges, level, new Set(['file:a/x.js', 'file:b/none.js'])).open.size).toBe(0);
  });
});

describe('layoutPlan and flowOf', () => {
  it('places every entry of the level without overlap, and reports the time ELK took', async () => {
    const { index, structure, edges, level } = setup();
    const plan = planLevel(structure, index, edges, level, new Set(['file:a/x.js']));
    const layout = await layoutPlan(level, plan);
    expect(layout.ms).toBeGreaterThanOrEqual(0);
    expect([...layout.boxes.keys()].sort()).toEqual(level.entries.map((e) => e.id).sort());
    const boxes = [...layout.boxes.values()];
    for (const a of boxes) {
      for (const b of boxes) {
        if (a === b) continue;
        expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
      }
    }
    // The opened file is taller than the closed one by the rows of the nodes it shows.
    const closed = await layoutPlan(level, planLevel(structure, index, edges, level, new Set()));
    expect((layout.boxes.get('file:a/x.js')?.height ?? 0) - (closed.boxes.get('file:a/x.js')?.height ?? 0)).toBeGreaterThan(40);
  });

  it('puts a file before the nodes it shows, makes them its children, and draws one edge for each aggregated edge', async () => {
    const { index, structure, edges, level } = setup();
    const plan = planLevel(structure, index, edges, level, new Set(['file:a/x.js']));
    const { nodes, edges: drawn } = flowOf(level, plan, await layoutPlan(level, plan), { ...view, selected: 'function:a/x.js:two' });
    expect(nodes.map((n) => [n.id, n.type, n.parentId ?? null])).toEqual([
      ['file:a/x.js', 'file', null],
      ['function:a/x.js:one', 'child', 'file:a/x.js'],
      ['function:a/x.js:two', 'child', 'file:a/x.js'],
      ['file:a/y.js', 'file', null],
    ]);
    expect(nodes.filter((n) => (n.data as { selected: boolean }).selected).map((n) => n.id)).toEqual(['function:a/x.js:two']);
    expect(drawn).toHaveLength(plan.edges.length);
    expect(drawn.map((e) => e.label).sort()).toEqual(['1 calls', '1 imports']);
  });

  it('says how many nodes of a file are not drawn when it owns more than a level draws', async () => {
    const many = Array.from({ length: LEVEL_LIMIT + 3 }, (_, i) => fn('a/x.js', `f${i}`, i + 1));
    const { index, structure, edges, level } = setup([file('a/x.js'), ...many], []);
    const plan = planLevel(structure, index, edges, level, new Set(['file:a/x.js']));
    const { nodes } = flowOf(level, plan, await layoutPlan(level, plan), view);
    const last = nodes[nodes.length - 1];
    expect(nodes).toHaveLength(1 + LEVEL_LIMIT + 1);
    expect(last.id).toBe('more:file:a/x.js');
    expect((last.data as { more: number }).more).toBe(3);
  });
});

describe('levelNotes', () => {
  it('says the grouping is by directory when the graph has no layers, and counts what is left out', () => {
    const { structure } = setup();
    const top = buildLevel(structure, {}) as Level;
    expect(levelNotes(structure, top, 'none')).toEqual(['Grouped by directory: the graph has no layers.']);
    const withLoose = buildStructure(buildIndex({ nodes: [...NODES, { id: 'module:loose', type: 'module', name: 'loose' }], edges: EDGES }));
    expect(levelNotes(withLoose, buildLevel(withLoose, {}) as Level, 'none')).toContain('1 node(s) belong to no file and are not drawn.');
  });

  it('names where the layers came from, and says files inside a layer are grouped by directory', () => {
    const index = buildIndex({ nodes: NODES, edges: EDGES }, { entries: [], layers: [{ id: 'l', name: 'L', nodeIds: ['file:a/x.js'] }] });
    const structure = buildStructure(index);
    expect(levelNotes(structure, buildLevel(structure, {}) as Level, 'semantic')[0]).toBe('Grouped by layer, from the semantic graph; inside a layer the files are grouped by directory.');
    expect(levelNotes(structure, buildLevel(structure, { path: 'l' }) as Level, 'semantic')).toEqual(['Files are grouped by directory.']);
  });

  it('says how many entries a level folded', () => {
    const structure = buildStructure(buildIndex({ nodes: Array.from({ length: 450 }, (_, i) => file(`d/f${String(i).padStart(3, '0')}.js`)), edges: [] }));
    const level = buildLevel(structure, { path: 'd' }) as Level;
    expect(levelNotes(structure, level, 'none').join(' ')).toContain(`${level.folded} entries beyond the ${LEVEL_LIMIT} a level draws are folded`);
  });
});
