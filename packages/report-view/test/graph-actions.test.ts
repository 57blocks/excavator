import { describe, expect, it } from 'vitest';

import type { GraphEdge, GraphNode } from '../src/data/graph';
import { buildIndex } from '../src/data/indexes';
import { clearPathHash, clearSelectionHash, entryHash, levelHash, parentLevel, selectHash, setFocusHash, setPathHash } from '../src/lib/graph-actions';
import { parseGraphState, TOP_LEVEL, type GraphState } from '../src/lib/graph-state';
import { buildLevel, buildStructure, LEVEL_LIMIT, locateFile, type Level } from '../src/lib/graph-structure';
import { parseRoute } from '../src/lib/route';

const file = (path: string): GraphNode => ({ id: `file:${path}`, type: 'file', name: path.slice(path.lastIndexOf('/') + 1), filePath: path });
const fn = (path: string, name: string): GraphNode => ({ id: `function:${path}:${name}`, type: 'function', name, filePath: path, lineRange: [1, 2] });
const contains = (path: string, name: string): GraphEdge => ({ source: `file:${path}`, target: `function:${path}:${name}`, type: 'contains' });

const NODES = [file('src/core/engine/run.js'), file('src/core/index.js'), file('lib/data.py'), file('README.md'), fn('src/core/engine/run.js', 'run'), fn('lib/data.py', 'load')];
const EDGES = [contains('src/core/engine/run.js', 'run'), contains('lib/data.py', 'load')];
const index = buildIndex({ nodes: NODES, edges: EDGES });
const structure = buildStructure(index);
const parse = (hash: string): GraphState => parseGraphState(parseRoute(hash).params);

describe('locateFile', () => {
  it('names the level of the directory that holds the file, and that level draws the file', () => {
    const where = locateFile(structure, 'file:src/core/engine/run.js');
    expect(where).toEqual({ path: 'src/core/engine', fold: null });
    const level = buildLevel(structure, where as { path: string; fold: string | null }) as Level;
    expect(level.entries.some((entry) => entry.id === 'file:src/core/engine/run.js')).toBe(true);
  });

  it('finds a file at the project root and one in a layer', () => {
    expect(locateFile(structure, 'file:README.md')).toEqual({ path: '.', fold: null });
    const layered = buildStructure(buildIndex({ nodes: NODES, edges: EDGES }, { entries: [], layers: [{ id: 'layer:core', name: 'Core', nodeIds: ['file:src/core/index.js', 'file:src/core/engine/run.js'] }] }));
    const where = locateFile(layered, 'file:src/core/engine/run.js');
    expect(where?.path).toBe('layer:core/src/core/engine');
    expect((buildLevel(layered, where as { path: string; fold: string | null }) as Level).entries.map((entry) => entry.id)).toContain('file:src/core/engine/run.js');
  });

  it('names the fold when the level is too big to draw the file itself', () => {
    const many = Array.from({ length: LEVEL_LIMIT + 50 }, (_, i) => file(`big/f${String(i).padStart(4, '0')}.js`));
    const big = buildStructure(buildIndex({ nodes: many, edges: [] }));
    const last = locateFile(big, many[many.length - 1].id);
    expect(last?.fold).not.toBeNull();
    expect((buildLevel(big, last as { path: string; fold: string | null }) as Level).entries.map((entry) => entry.id)).toContain(many[many.length - 1].id);
    expect(locateFile(big, many[0].id)?.fold).toBeNull();
  });

  it('gives nothing for a file that no group holds', () => {
    expect(locateFile(structure, 'file:nowhere.js')).toBeNull();
  });
});

describe('selectHash', () => {
  it('drills to the level that draws the node and selects it', () => {
    const state = parse(selectHash(TOP_LEVEL, index, structure, 'function:src/core/engine/run.js:run'));
    expect(state).toMatchObject({ path: 'src/core/engine', node: 'function:src/core/engine/run.js:run', focus: false });
  });

  it('keeps a highlighted path, and drops a selected entry', () => {
    const before: GraphState = { ...TOP_LEVEL, path: 'lib', entry: 'container:lib', from: 'a', to: 'b', directed: true };
    expect(parse(selectHash(before, index, structure, 'function:lib/data.py:load'))).toMatchObject({ path: 'lib', entry: null, node: 'function:lib/data.py:load', from: 'a', to: 'b', directed: true });
  });

  it('stays at the level while focused: the focus moves to the node', () => {
    const focused: GraphState = { ...TOP_LEVEL, path: 'lib', node: 'file:lib/data.py', focus: true };
    expect(parse(selectHash(focused, index, structure, 'function:src/core/engine/run.js:run'))).toMatchObject({ path: 'lib', node: 'function:src/core/engine/run.js:run', focus: true });
  });

  it('selects a node that has no file where the view is', () => {
    const loose = buildIndex({ nodes: [...NODES, { id: 'service:x', type: 'service', name: 'x' }], edges: EDGES });
    const state = parse(selectHash({ ...TOP_LEVEL, path: 'lib' }, loose, buildStructure(loose), 'service:x'));
    expect(state).toMatchObject({ path: 'lib', node: 'service:x' });
  });
});

describe('the other moves', () => {
  const at: GraphState = { ...TOP_LEVEL, path: 'src', node: 'n', focus: true, from: 'a', to: 'b', directed: true };

  it('drills into a level and keeps only the path', () => {
    expect(parse(levelHash(at, 'src/core', null))).toEqual({ ...TOP_LEVEL, path: 'src/core', from: 'a', to: 'b', directed: true });
  });

  it('clears the selection together with the focus, and exits the focus alone', () => {
    expect(parse(clearSelectionHash(at))).toMatchObject({ node: null, entry: null, focus: false, from: 'a' });
    expect(parse(setFocusHash(at, false))).toMatchObject({ node: 'n', focus: false });
    expect(parse(setFocusHash({ ...at, focus: false }, true))).toMatchObject({ node: 'n', focus: true });
  });

  it('sets and clears the path', () => {
    expect(parse(clearPathHash(at))).toMatchObject({ from: null, to: null, directed: false, node: 'n' });
    expect(parse(setPathHash(TOP_LEVEL, 'x', 'y', true))).toMatchObject({ from: 'x', to: 'y', directed: true });
  });

  it('selects an entry instead of a node', () => {
    expect(parse(entryHash(at, 'container:src'))).toMatchObject({ node: null, entry: 'container:src', focus: false });
  });

  it('goes up one level from a drilled level, and has no parent at the top', () => {
    const level = buildLevel(structure, { path: 'src/core/engine' }) as Level;
    const up = parentLevel(level);
    expect(up).not.toBeNull();
    expect(buildLevel(structure, up as { path: string; fold: string | null })?.crumbs.length).toBe(level.crumbs.length - 1);
    expect(parentLevel(buildLevel(structure, {}) as Level)).toBeNull();
  });
});
