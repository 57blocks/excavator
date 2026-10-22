import { describe, expect, it } from 'vitest';

import type { GraphEdge, GraphNode } from '../src/data/graph';
import { buildIndex } from '../src/data/indexes';
import { parseGraphState } from '../src/lib/graph-state';
import { buildLevel, buildStructure, LEVEL_LIMIT, locateDirectory, type Level } from '../src/lib/graph-structure';
import { locate, NO_SINGLE_NODE, NOT_IN_GRAPH, type Located } from '../src/lib/locate';
import { parseRoute } from '../src/lib/route';

const file = (path: string): GraphNode => ({ id: `file:${path}`, type: 'file', name: path.slice(path.lastIndexOf('/') + 1), filePath: path });
const fn = (path: string, name: string): GraphNode => ({ id: `function:${path}:${name}`, type: 'function', name, filePath: path, lineRange: [1, 2] });
const contains = (path: string, name: string): GraphEdge => ({ source: `file:${path}`, target: `function:${path}:${name}`, type: 'contains' });

const NODES = [
  file('src/core/engine/run.js'), file('src/core/index.js'), file('src/util/a.js'), file('src/util/b.js'), file('lib/deep/er/data.py'), file('README.md'),
  fn('src/core/engine/run.js', 'run'), fn('lib/deep/er/data.py', 'load'),
];
const EDGES = [contains('src/core/engine/run.js', 'run'), contains('lib/deep/er/data.py', 'load')];

const graphOf = (nodes: GraphNode[], layers?: { id: string; name: string; nodeIds: string[] }[]) => {
  const index = buildIndex({ nodes, edges: EDGES.filter((e) => nodes.some((n) => n.id === e.source)) }, layers ? { entries: [], layers } : undefined);
  return { index, structure: buildStructure(index) };
};
const state = (hash: string | null) => parseGraphState(parseRoute(hash as string).params);

/** The entry of `place`'s level (or fold) that has the id the place names. */
const drawn = (structure: ReturnType<typeof buildStructure>, place: { path: string; fold: string | null; entry: string }) => {
  const level = buildLevel(structure, { path: place.path, fold: place.fold }) as Level;
  return level.entries.find((entry) => entry.id === place.entry);
};

describe('locateDirectory, in a graph grouped by directory', () => {
  const { structure } = graphOf(NODES);

  it('finds the container of a directory, in the level of its parent', () => {
    const place = locateDirectory(structure, 'src/util') as NonNullable<ReturnType<typeof locateDirectory>>;
    expect(place.entry).toBe('container:src/util');
    expect(drawn(structure, place)?.kind).toBe('container');
    expect(drawn(structure, place)?.files).toBe(2);
  });

  it('finds a directory that a chain of single-child directories ends in, from either end of the chain', () => {
    const top = locateDirectory(structure, 'lib/deep') as NonNullable<ReturnType<typeof locateDirectory>>;
    const end = locateDirectory(structure, 'lib/deep/er') as NonNullable<ReturnType<typeof locateDirectory>>;
    expect(top.entry).toBe(end.entry);
    expect(drawn(structure, end)?.files).toBe(1);
  });

  it('finds a directory that is a group of the top level', () => {
    const place = locateDirectory(structure, 'lib') as NonNullable<ReturnType<typeof locateDirectory>>;
    expect(place).toMatchObject({ path: '', fold: null, entry: 'group:lib' });
    expect(drawn(structure, place)?.files).toBe(1);
  });

  it('gives nothing for the project root, a directory the graph has no file in, a file, and a directory only part of whose files make a container', () => {
    expect(locateDirectory(structure, '.')).toBeNull();
    expect(locateDirectory(structure, '')).toBeNull();
    expect(locateDirectory(structure, 'nowhere')).toBeNull();
    expect(locateDirectory(structure, 'README.md')).toBeNull();
  });

  it('gives nothing for a directory whose group was split below it: no container stands for all of it', () => {
    // `src` holds four of five files, so the top level splits it into `src/core`, `src/util` and the file directly in `src`.
    const split = buildStructure(buildIndex({ nodes: [file('src/core/x.js'), file('src/util/a.js'), file('src/util/b.js'), file('src/top.js'), file('lib/y.js')], edges: [] }));
    expect(split.groups.map((group) => group.key).sort()).toEqual(['lib', 'src', 'src/core', 'src/util']);
    expect(split.groups.find((group) => group.key === 'src')?.directOnly).toBe(true);
    expect(locateDirectory(split, 'src')).toBeNull();
    expect(locateDirectory(split, 'src/util')).toMatchObject({ path: '', entry: 'group:src/util' });
    // Unsplit, the same directory is one group and has its container.
    expect(locateDirectory(structure, 'src')).toMatchObject({ path: '', entry: 'group:src' });
  });

  it('takes a trailing slash as the same directory', () => {
    expect(locateDirectory(structure, 'src/util/')).toEqual(locateDirectory(structure, 'src/util'));
  });
});

describe('locateDirectory, in a graph grouped by layer', () => {
  const layers = [
    { id: 'layer:core', name: 'Core', nodeIds: ['file:src/core/index.js', 'file:src/util/a.js', 'file:src/util/b.js'] },
    { id: 'layer:app', name: 'App', nodeIds: ['file:src/core/engine/run.js', 'file:src/util/b.js'] },
  ];
  const { structure } = graphOf(NODES, layers);

  it('finds a directory inside the layer that holds its files', () => {
    const place = locateDirectory(structure, 'src/core/engine') as NonNullable<ReturnType<typeof locateDirectory>>;
    expect(place.path.startsWith('layer:app')).toBe(true);
    expect(drawn(structure, place)?.files).toBe(1);
  });

  it('takes the layer that holds most of a directory whose files are in several', () => {
    // src/core: index.js in Core, engine/run.js in App; src/util: a.js and b.js, both claimed first by Core.
    const util = locateDirectory(structure, 'src/util') as NonNullable<ReturnType<typeof locateDirectory>>;
    expect(util.path.startsWith('layer:core')).toBe(true);
    expect(drawn(structure, util)?.files).toBe(2);
    // One file each: the first layer wins the tie.
    const core = locateDirectory(structure, 'src/core') as NonNullable<ReturnType<typeof locateDirectory>>;
    expect(core.path.startsWith('layer:core')).toBe(true);
  });
});

describe('locateDirectory, in a level too big to draw whole', () => {
  it('names the fold that holds the container', () => {
    const many = Array.from({ length: LEVEL_LIMIT + 30 }, (_, i) => file(`root/d${String(i).padStart(4, '0')}/f.js`));
    // Two files in the first directory and one in each other: the first sorts first, the last is folded.
    const structure = buildStructure(buildIndex({ nodes: [...many, file('root/d0000/g.js')], edges: [] }));
    const last = locateDirectory(structure, `root/d${String(LEVEL_LIMIT + 29).padStart(4, '0')}`) as NonNullable<ReturnType<typeof locateDirectory>>;
    expect(last.fold).not.toBeNull();
    expect(drawn(structure, last)?.kind).toBe('container');
    expect(locateDirectory(structure, 'root/d0000')?.fold).toBeNull();
  });
});

describe('locate', () => {
  const graph = graphOf(NODES);
  const locateHash = (...args: Parameters<typeof locate>): string | null => {
    const found: Located = locate(...args);
    return 'hash' in found ? found.hash : null;
  };

  it('selects the function a row names, drilled to its file, with the overlay on', () => {
    const hash = locateHash(graph, { kind: 'node', nodeId: 'function:src/core/engine/run.js:run' }, 'unused');
    expect(state(hash)).toMatchObject({ path: 'src/core/engine', node: 'function:src/core/engine/run.js:run', overlays: ['unused'] });
  });

  it('selects a file by its path', () => {
    expect(state(locateHash(graph, { kind: 'file', path: 'src/util/a.js' }, 'hotspots'))).toMatchObject({ path: 'src/util', node: 'file:src/util/a.js', overlays: ['hotspots'] });
  });

  it('selects a directory as an entry of its level, not as a node', () => {
    expect(state(locateHash(graph, { kind: 'directory', path: 'src/util' }, 'hotspots'))).toMatchObject({ path: 'src', node: null, entry: 'container:src/util', overlays: ['hotspots'] });
  });

  it('turns on no overlay when none is named', () => {
    expect(state(locateHash(graph, { kind: 'file', path: 'README.md' }, null)).overlays).toEqual([]);
  });

  it('says not in the graph for a node, a file or a directory the graph does not have, and does nothing else', () => {
    expect(locate(graph, { kind: 'node', nodeId: 'function:gone.js:f' }, 'unused')).toEqual({ message: NOT_IN_GRAPH });
    expect(locate(graph, { kind: 'file', path: 'bin/blob.dat' }, 'hotspots')).toEqual({ message: NOT_IN_GRAPH });
    expect(locate(graph, { kind: 'directory', path: 'nowhere' }, 'hotspots')).toEqual({ message: NOT_IN_GRAPH });
    expect(locate(graph, { kind: 'directory', path: '.' }, 'hotspots')).toEqual({ message: NOT_IN_GRAPH });
    expect(NOT_IN_GRAPH).toBe('Not in the graph.');
  });

  it('says so, in other words, for a directory whose files are in the graph but that no single node stands for', () => {
    const split = graphOf([file('src/core/x.js'), file('src/util/a.js'), file('src/util/b.js'), file('lib/y.js')]);
    expect(locate(split, { kind: 'directory', path: 'src' }, 'hotspots')).toEqual({ message: NO_SINGLE_NODE });
    expect(locate(split, { kind: 'directory', path: 'src/util' }, 'hotspots')).toHaveProperty('hash');
  });
});
