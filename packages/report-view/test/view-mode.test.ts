import { describe, expect, it } from 'vitest';

import type { GraphEdge, GraphNode } from '../src/data/graph';
import { buildIndex } from '../src/data/indexes';
import { flowNodes, layoutPlan, planLevel, type FlowView } from '../src/lib/graph-flow';
import { selectHash } from '../src/lib/graph-actions';
import { graphHash, parseGraphState, TOP_LEVEL } from '../src/lib/graph-state';
import { buildLevel, buildStructure, LEVEL_LIMIT, type Level, type Structure } from '../src/lib/graph-structure';
import { parseRoute } from '../src/lib/route';
import { DEFAULT_MODE, hiddenByMode, hiddenTypes, modeForNode, modeParam, parseMode, withMode, type Mode } from '../src/lib/view-mode';
import { rememberPlace, switchHash, viewOf } from '../src/lib/view-switch';

const file = (path: string): GraphNode => ({ id: `file:${path}`, type: 'file', name: path.slice(path.lastIndexOf('/') + 1), filePath: path });
const owned = (type: string, path: string, name: string, line: number): GraphNode => ({ id: `${type}:${path}:${name}`, type, name, filePath: path, lineRange: [line, line + 1] });
const edge = (source: string, target: string, type: string): GraphEdge => ({ source, target, type });

/**
 * Functions and classes in several files, a file that owns only a class, a file that owns a variable beside a function,
 * and one directory of more files than a level draws, so the level folds.
 */
function fixture() {
  const nodes: GraphNode[] = [
    file('src/a.js'), owned('function', 'src/a.js', 'run', 1), owned('class', 'src/a.js', 'Box', 5),
    file('src/b.js'), owned('class', 'src/b.js', 'Only', 1),
    file('src/c.js'), owned('function', 'src/c.js', 'go', 1), owned('variable', 'src/c.js', 'LIMIT', 4),
    file('src/d.js'),
  ];
  const edges: GraphEdge[] = [
    edge('file:src/a.js', 'function:src/a.js:run', 'contains'),
    edge('file:src/a.js', 'class:src/a.js:Box', 'contains'),
    edge('file:src/b.js', 'class:src/b.js:Only', 'contains'),
    edge('file:src/c.js', 'function:src/c.js:go', 'contains'),
    edge('file:src/c.js', 'variable:src/c.js:LIMIT', 'contains'),
    edge('function:src/a.js:run', 'class:src/b.js:Only', 'calls'),
    edge('function:src/c.js:go', 'function:src/a.js:run', 'calls'),
    edge('file:src/a.js', 'file:src/b.js', 'imports'),
    edge('class:src/a.js:Box', 'file:src/d.js', 'imports'),
  ];
  for (let i = 0; i < LEVEL_LIMIT + 30; i++) {
    const path = `many/f${String(i).padStart(3, '0')}.js`;
    nodes.push(file(path), owned('function', path, 'fn', 1), owned('class', path, 'K', 3));
    edges.push(edge(`file:${path}`, `function:${path}:fn`, 'contains'), edge(`file:${path}`, `class:${path}:K`, 'contains'));
    if (i % 7 === 0) edges.push(edge(`function:${path}:fn`, 'function:src/a.js:run', 'calls'));
  }
  const index = buildIndex({ nodes, edges });
  return { index, structure: buildStructure(index), edges };
}

const view: FlowView = { selected: null, selectedEntry: null, hovered: null, hoveredEdge: null, path: null, onOpen: () => {}, onDetails: () => {}, onSelect: () => {}, onToggle: () => {} };
const childDrawnFor = (mode: Mode) => (mode === 'overview' ? (node: { type: string }) => !hiddenByMode(mode, node.type) : undefined);

/**
 * What a level draws in `mode`, with every file open or none: the numbers on every card and edge, and the rows the
 * files show. With files open, Deep dive draws an edge at the function's row and Overview at its file, so `records`
 * (the edge records the drawn edges stand for) is what stays.
 */
async function drawnIn(mode: Mode, structure: Structure, index: ReturnType<typeof buildIndex>, edges: GraphEdge[], params: { path: string; fold?: string | null }, open = true) {
  const level = buildLevel(structure, params) as Level;
  const files = new Set(open ? level.entries.filter((e) => e.kind === 'file').map((e) => e.id) : []);
  const plan = planLevel(structure, index, edges, level, files, { childDrawn: childDrawnFor(mode) });
  const nodes = flowNodes(level, plan, await layoutPlan(level, plan), view);
  const counts = {
    level: { files: level.files, nodes: level.nodes, folded: level.folded, total: level.total, entries: level.entries.length },
    cards: nodes.filter((n) => n.type !== 'child').map((n) => {
      const entry = (n.data as { entry: { id: string; files: number; nodes: number; folded: number } }).entry;
      return [entry.id, entry.files, entry.nodes, entry.folded];
    }),
  };
  const drawnEdges = plan.edges.map((e) => [e.source, e.target, e.count]);
  const records = plan.edges.reduce((sum, e) => sum + e.count, 0);
  const rows = nodes.filter((n) => n.type === 'child' && (n.data as { more: number | null }).more === null).map((n) => (n.data as { type: string }).type);
  const expandable = nodes.filter((n) => n.type === 'file' && (n.data as { expanded: boolean | null }).expanded !== null).map((n) => n.id);
  return { counts, drawnEdges, records, rows, expandable };
}

describe('the modes of the graph pages', () => {
  it('is Learn by default, and leaves the default out of the address', () => {
    expect(DEFAULT_MODE).toBe('learn');
    expect(parseMode(undefined)).toBe('learn');
    expect(parseMode('nonsense')).toBe('learn');
    expect(parseMode('overview')).toBe('overview');
    expect(modeParam('learn')).toBeNull();
    expect(graphHash({ mode: 'learn' })).toBe('#/graph');
    expect(parseGraphState({}).mode).toBe('learn');
  });

  it('round-trips the mode through the graph address and through any other hash, keeping everything else', () => {
    for (const mode of ['overview', 'learn', 'deep'] as const) {
      const state = { ...TOP_LEVEL, path: 'src', node: 'function:src/a.js:run', mode };
      expect(parseGraphState(parseRoute(graphHash(state)).params)).toEqual(state);
      const domain = withMode('#/domain?d=domain%3Aapp&node=x', mode);
      expect(parseRoute(domain).params).toMatchObject({ d: 'domain:app', node: 'x' });
      expect(parseMode(parseRoute(domain).params.mode)).toBe(mode);
    }
    expect(withMode('#/graph?mode=overview&path=src', 'learn')).toBe('#/graph?path=src');
    expect(withMode('#/graph?path=src', 'deep')).toBe('#/graph?path=src&mode=deep');
  });

  it('keeps the mode through a drill-down and a selection elsewhere', () => {
    const { index, structure } = fixture();
    const state = { ...TOP_LEVEL, mode: 'overview' as const };
    expect(parseGraphState(parseRoute(selectHash(state, index, structure, 'file:src/a.js')).params).mode).toBe('overview');
  });

  it('switches to Deep dive for a function or class chosen in Overview, and says which mode it left', () => {
    expect(modeForNode('overview', 'function')).toEqual({ mode: 'deep', switched: 'overview' });
    expect(modeForNode('overview', 'class')).toEqual({ mode: 'deep', switched: 'overview' });
    expect(modeForNode('overview', 'file')).toEqual({ mode: 'overview', switched: null });
    expect(modeForNode('learn', 'function')).toEqual({ mode: 'learn', switched: null });
    expect(modeForNode('deep', 'class')).toEqual({ mode: 'deep', switched: null });
    expect(modeForNode('overview', undefined)).toEqual({ mode: 'overview', switched: null });
  });

  it('hides function and class in Overview on top of the filters, and only there', () => {
    expect([...hiddenTypes('overview', new Set(['document']))].sort()).toEqual(['class', 'document', 'function']);
    expect([...hiddenTypes('deep', new Set(['document']))]).toEqual(['document']);
  });
});

describe('Overview draws no function or class, and changes no count', () => {

  it('draws the same cards, counts, folds and edges in all three modes', async () => {
    const { index, structure, edges } = fixture();
    // The fixture folds: the place of the fold is the one the level makes.
    const many = buildLevel(structure, { path: 'many' }) as Level;
    expect(many.folded).toBeGreaterThan(0);
    const fold = many.entries.find((e) => e.kind === 'fold')?.target?.fold ?? null;
    expect(fold).not.toBeNull();
    for (const place of [{ path: '' }, { path: 'src' }, { path: 'many' }, { path: 'many', fold }]) {
      const deep = await drawnIn('deep', structure, index, edges, place);
      const deepClosed = await drawnIn('deep', structure, index, edges, place, false);
      for (const mode of ['overview', 'learn'] as const) {
        const open = await drawnIn(mode, structure, index, edges, place);
        expect(open.counts).toEqual(deep.counts);
        expect(open.records).toBe(deep.records);
        const closed = await drawnIn(mode, structure, index, edges, place, false);
        expect(closed.counts).toEqual(deepClosed.counts);
        expect(closed.drawnEdges).toEqual(deepClosed.drawnEdges);
      }
    }
  });

  it('opens no file to a function or class in Overview, and a file that owns nothing else cannot be opened', async () => {
    const { index, structure, edges } = fixture();
    const overview = await drawnIn('overview', structure, index, edges, { path: 'src' });
    expect(overview.rows).toEqual(['variable']);
    expect(overview.expandable).toEqual(['file:src/c.js']);
    // The call from a hidden function stays, drawn from its file.
    expect(overview.drawnEdges).toContainEqual(['file:src/a.js', 'file:src/b.js', 2]);
    const deep = await drawnIn('deep', structure, index, edges, { path: 'src' });
    expect([...deep.rows].sort()).toEqual(['class', 'class', 'function', 'function', 'variable']);
    expect([...deep.expandable].sort()).toEqual(['file:src/a.js', 'file:src/b.js', 'file:src/c.js']);
    const learn = await drawnIn('learn', structure, index, edges, { path: 'src' });
    expect(learn.rows).toEqual(deep.rows);
  });
});

describe('the Domain | Structural switch', () => {
  it('goes back to where each view was left, in the mode of the page', () => {
    let places = { graph: null as string | null, domain: null as string | null };
    expect(switchHash('domain', places, 'learn')).toBe('#/domain');
    places = rememberPlace(places, '#/graph?path=src%2Fcore&node=file%3Asrc%2Fa.js&mode=overview');
    places = rememberPlace(places, '#/domain?d=domain%3Aapp');
    places = rememberPlace(places, '#/unused?row=x');
    expect(viewOf('#/unused')).toBeNull();
    expect(parseRoute(switchHash('graph', places, 'deep')).params).toMatchObject({ path: 'src/core', node: 'file:src/a.js', mode: 'deep' });
    expect(switchHash('domain', places, 'overview')).toBe('#/domain?d=domain%3Aapp&mode=overview');
    expect(switchHash('domain', places, 'learn')).toBe('#/domain?d=domain%3Aapp');
  });
});
