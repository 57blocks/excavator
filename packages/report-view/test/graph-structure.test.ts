import { describe, expect, it } from 'vitest';

import type { GraphEdge, GraphLayer, GraphNode } from '../src/data/graph';
import { buildIndex } from '../src/data/indexes';
import { buildLevel, buildStructure, fileChildren, foldRanges, LEVEL_LIMIT, type Level, type Structure } from '../src/lib/graph-structure';

const file = (path: string): GraphNode => ({ id: `file:${path}`, type: 'file', name: path.slice(path.lastIndexOf('/') + 1), filePath: path });
const fn = (path: string, name: string, line = 1): GraphNode => ({ id: `function:${path}:${name}`, type: 'function', name, filePath: path, lineRange: [line, line + 1] });
const contains = (path: string, name: string): GraphEdge => ({ source: `file:${path}`, target: `function:${path}:${name}`, type: 'contains' });

function structureOf(nodes: GraphNode[], edges: GraphEdge[] = [], layers: GraphLayer[] = []): Structure {
  return buildStructure(buildIndex({ nodes, edges }, layers.length > 0 ? { entries: [], layers } : null));
}

/** A tree with a dominant top-level directory, a chain of single-child directories, and files at the root. */
const TREE = [
  'README.md', 'main.go',
  'api/server.go', 'api/routes.go',
  'src/core/index.js', 'src/core/engine/run.js', 'src/core/engine/plan.js', 'src/core/util/a.js', 'src/core/util/b.js',
  'src/web/app.js', 'src/web/pages/home.js', 'src/web/pages/about.js',
  'src/index.js', 'src/types.js',
  'deep/one/two/three/leaf.js',
];

/** Every level reachable by clicking from the top (folds included), with the route params that open it. */
function reachable(structure: Structure): Level[] {
  const seen = new Map<string, Level>();
  const visit = (params: { path: string; fold: string | null }) => {
    const key = `${params.path}|${params.fold ?? ''}`;
    if (seen.has(key)) return;
    const level = buildLevel(structure, params);
    if (!level) throw new Error(`a click leads to no level: ${key}`);
    seen.set(key, level);
    for (const entry of level.entries) if (entry.target) visit(entry.target);
    for (const crumb of level.crumbs) visit(crumb);
  };
  visit({ path: '', fold: null });
  return [...seen.values()];
}

describe('grouping by directory when the graph has no layers', () => {
  const structure = structureOf(TREE.map(file));

  it('says it groups by directory and has no group the files do not make', () => {
    expect(structure.mode).toBe('directories');
    // Each group is a directory the files are in, or the project root; every file is in exactly one group.
    for (const group of structure.groups) {
      expect(group.files.length).toBeGreaterThan(0);
      for (const f of group.files) {
        if (group.key === '.') expect(f.path).not.toContain('/');
        else if (group.directOnly) expect(f.path.slice(0, f.path.lastIndexOf('/'))).toBe(group.key);
        else expect(f.path.startsWith(`${group.key}/`)).toBe(true);
      }
    }
    expect(structure.groups.flatMap((g) => g.files.map((f) => f.path)).sort()).toEqual([...TREE].sort());
  });

  it('splits the group that holds most of the files one directory deeper, and leaves its own files as a group', () => {
    // src holds 9 of 15 files (60%): not dominant. Add more until it is.
    expect(structure.groups.map((g) => g.key).sort()).toEqual(['.', 'api', 'deep', 'src']);
    const crowded = structureOf([...TREE, 'src/core/more1.js', 'src/core/more2.js', 'src/core/more3.js'].map(file));
    expect(crowded.groups.map((g) => g.key).sort()).toEqual(['.', 'api', 'deep', 'src', 'src/core', 'src/web']);
    const own = crowded.groups.find((g) => g.key === 'src');
    expect(own?.directOnly).toBe(true);
    expect(own?.files.map((f) => f.path).sort()).toEqual(['src/index.js', 'src/types.js']);
    expect(crowded.groups.flatMap((g) => g.files).length).toBe(TREE.length + 3);
  });

  it('keeps splitting while one directory still holds most of the files, and stops at a directory with files of its own', () => {
    const chain = structureOf(['a/b/c/x.js', 'a/b/c/y.js', 'a/b/c/d/z.js', 'a/b/c/d/w.js', 'a/b/c/e/v.js', 'other/o.js'].map(file));
    expect(chain.groups.map((g) => g.key).sort()).toEqual(['a/b/c', 'a/b/c/d', 'a/b/c/e', 'other']);
    expect(chain.groups.find((g) => g.key === 'a/b/c')?.directOnly).toBe(true);
  });

  it('shows a file group of the project root, and a group of one file when that is all there is', () => {
    expect(structure.groups.find((g) => g.key === '.')?.files.map((f) => f.path).sort()).toEqual(['README.md', 'main.go']);
    expect(structureOf([file('only/one.js')]).groups.map((g) => g.key)).toEqual(['only']);
  });

  it('opens no level for a path the graph does not have', () => {
    for (const path of ['nope', 'src/nope', 'src/core/engine/run.js', 'api/server.go', 'deep/one/two/three/leaf.js', 'deep/two']) {
      expect(buildLevel(structure, { path }), path).toBeNull();
    }
    expect(buildLevel(structure, { path: 'api', fold: '1-2' })).toBeNull();
  });
});

describe('the level under a path', () => {
  const structure = structureOf(TREE.map(file));

  it('has as many files as there are files under the path, at every level reachable by clicking', () => {
    const crowded = structureOf([...TREE, 'src/core/more1.js', 'src/core/more2.js', 'src/core/more3.js'].map(file));
    for (const [name, built, paths] of [['plain', structure, TREE], ['split', crowded, [...TREE, 'src/core/more1.js', 'src/core/more2.js', 'src/core/more3.js']]] as const) {
      const levels = reachable(built);
      expect(levels.length, name).toBeGreaterThan(8);
      for (const level of levels) {
        // The files the level's group holds that have the level's directory as a prefix, counted from the paths.
        const inGroup = (p: string) => level.group === null || level.group.files.some((f) => f.path === p);
        const under = paths.filter((p) => inGroup(p) && (level.dir === '' || p.startsWith(`${level.dir}/`)));
        expect(level.files, `${name} ${level.path}`).toBe(under.length);
        // A group that is a directory holds every file under it.
        if (level.group && !level.group.directOnly && level.dir === level.group.baseDir && level.group.baseDir !== '') {
          expect(level.files, `${name} ${level.path} by prefix`).toBe(paths.filter((p) => p.startsWith(`${level.group?.baseDir}/`)).length);
        }
      }
    }
  });

  it('counts, for each entry, the files under it', () => {
    for (const level of reachable(structure)) {
      expect(level.entries.reduce((n, e) => n + e.files, 0), level.path).toBe(level.files);
      for (const entry of level.entries) expect(entry.members.length, entry.id).toBe(entry.files);
    }
    const src = buildLevel(structure, { path: 'src' }) as Level;
    expect(src.entries.map((e) => [e.kind, e.label, e.files])).toEqual([['container', 'core', 5], ['container', 'web', 3], ['file', 'index.js', 1], ['file', 'types.js', 1]]);
  });

  it('shows a chain of directories with one child and no file as one container', () => {
    const top = buildLevel(structure, { path: 'deep' }) as Level;
    expect(top.entries.map((e) => [e.label, e.files, e.target?.path])).toEqual([['one/two/three', 1, 'deep/one/two/three']]);
    expect(top.crumbs.map((c) => c.label)).toEqual(['Project', 'deep']);
    const leaf = buildLevel(structure, { path: 'deep/one/two/three' }) as Level;
    expect(leaf.crumbs.map((c) => [c.label, c.path])).toEqual([['Project', ''], ['deep', 'deep'], ['one/two/three', 'deep/one/two/three']]);
    expect(leaf.entries.map((e) => e.id)).toEqual(['file:deep/one/two/three/leaf.js']);
    // A path inside the chain is a level too, with one container below it.
    const inside = buildLevel(structure, { path: 'deep/one' }) as Level;
    expect(inside.entries.map((e) => e.label)).toEqual(['two/three']);
    expect(inside.crumbs.map((c) => c.label)).toEqual(['Project', 'deep', 'one']);
  });

  it('draws a file as an entry that counts the nodes it owns', () => {
    const withFns = structureOf([file('a.js'), file('b.js'), fn('a.js', 'f'), fn('a.js', 'g', 5)], [contains('a.js', 'f'), contains('a.js', 'g')]);
    const level = buildLevel(withFns, { path: '.' }) as Level;
    expect(level.entries.map((e) => [e.id, e.nodes])).toEqual([['file:a.js', 3], ['file:b.js', 1]]);
    expect(level.nodes).toBe(4);
    expect(withFns.unowned).toBe(0);
  });
});

describe('grouping by layer', () => {
  const nodes = ['a/x.js', 'a/y.js', 'b/z.js', 'c/w.js', 'c/deep/v.js'].map(file);
  const layers: GraphLayer[] = [
    { id: 'layer:app', name: 'App', description: 'the app', nodeIds: ['file:a/x.js', 'file:b/z.js', 'file:gone.js'] },
    { id: 'layer:lib', name: 'Lib', nodeIds: ['file:c/w.js', 'file:a/x.js'] },
  ];
  const structure = structureOf(nodes, [], layers);

  it('has one cluster per layer, and one for the files no layer lists', () => {
    expect(structure.mode).toBe('layers');
    const top = buildLevel(structure, {}) as Level;
    expect(top.entries.map((e) => [e.kind, e.id, e.files])).toEqual([['cluster', 'group:layer:app', 2], ['cluster', 'group:~unlayered', 2], ['cluster', 'group:layer:lib', 1]]);
    expect(top.files).toBe(nodes.length);
    expect(top.entries.find((e) => e.id === 'group:layer:app')?.note).toBe('the app');
  });

  it('has no cluster for the files no layer lists when every file is in one', () => {
    const all = structureOf(nodes, [], [{ id: 'one', name: 'One', nodeIds: nodes.map((n) => n.id) }]);
    expect(all.groups.map((g) => g.key)).toEqual(['one']);
    expect((buildLevel(all, {}) as Level).entries.map((e) => e.kind)).toEqual(['cluster']);
  });

  it('says what it could not follow: a file two layers list, and an id that names no file', () => {
    expect(structure.notes).toEqual(['1 file(s) are listed by more than one layer and show in the first.', '1 layer entries name no file of the graph.']);
  });

  it('groups the files of a layer by directory, and the count under a directory is the layer\'s files with that prefix', () => {
    const app = buildLevel(structure, { path: 'layer:app' }) as Level;
    expect(app.entries.map((e) => [e.label, e.files, e.target?.path])).toEqual([['a', 1, 'layer:app/a'], ['b', 1, 'layer:app/b']]);
    const unlayered = buildLevel(structure, { path: '~unlayered' }) as Level;
    expect(unlayered.entries.map((e) => [e.label, e.files])).toEqual([['a', 1], ['c/deep', 1]]);
    const deep = buildLevel(structure, { path: '~unlayered/c/deep' }) as Level;
    expect(deep.files).toBe(1);
    expect(deep.crumbs.map((x) => x.label)).toEqual(['Project', 'Not in any layer', 'c/deep']);
    // A directory the layer has no file under is no level.
    expect(buildLevel(structure, { path: 'layer:lib/a' })).toBeNull();
  });

  it('puts the layers first even when the graph also has directories to group by', () => {
    expect(structure.groups.map((g) => g.key)).toEqual(['layer:app', 'layer:lib', '~unlayered']);
  });

  it('sends a click on a layer, or on a directory group, past the directories that are all it holds', () => {
    const nested = structureOf(['pkg/a/x.js', 'pkg/a/y.js', 'pkg/b/z.js'].map(file), [], [{ id: 'l', name: 'L', nodeIds: ['file:pkg/a/x.js', 'file:pkg/a/y.js', 'file:pkg/b/z.js'] }]);
    const top = buildLevel(nested, {}) as Level;
    expect(top.entries[0].target).toEqual({ path: 'l/pkg', fold: null });
    const inside = buildLevel(nested, { path: 'l/pkg' }) as Level;
    expect(inside.entries.map((e) => [e.label, e.files])).toEqual([['a', 2], ['b', 1]]);
    expect(inside.crumbs.map((c) => c.label)).toEqual(['Project', 'L', 'pkg']);
    // The layer's own level is still there, with the one container, and is one step up in the breadcrumb.
    expect((buildLevel(nested, { path: 'l' }) as Level).entries.map((e) => e.label)).toEqual(['pkg']);

    const chain = structureOf(['deep/one/two/leaf.js', 'other/o.js'].map(file));
    expect((buildLevel(chain, {}) as Level).entries.map((e) => [e.label, e.target?.path])).toEqual([['deep', 'deep/one/two'], ['other', 'other']]);
  });

  it('finds the layer when its id has a slash and another layer\'s id starts the same', () => {
    const slashed = structureOf(nodes, [], [{ id: 'l/1', name: 'One', nodeIds: ['file:a/x.js'] }, { id: 'l', name: 'Two', nodeIds: ['file:b/z.js'] }]);
    expect((buildLevel(slashed, { path: 'l/1/a' }) as Level).group?.key).toBe('l/1');
    expect((buildLevel(slashed, { path: 'l/b' }) as Level).group?.key).toBe('l');
  });
});

describe('folding at the limit', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => `d/f${String(i).padStart(4, '0')}.js`);

  it('folds only the overflow: what is drawn plus what is folded is the whole level, and every file is in exactly one place', () => {
    // d holds 1030 of 1530 files: under the share at which a directory group is split.
    const paths = [...many(1000), ...Array.from({ length: 30 }, (_, i) => `d/sub${i}/x.js`), ...Array.from({ length: 500 }, (_, i) => `other/o${i}.js`)];
    const structure = structureOf(paths.map(file));
    const level = buildLevel(structure, { path: 'd' }) as Level;
    expect(level.entries.length).toBeLessThanOrEqual(LEVEL_LIMIT);
    expect(level.total).toBe(1030);
    expect(level.entries.filter((e) => e.kind !== 'fold').length + level.folded).toBe(level.total);
    expect(level.entries.reduce((n, e) => n + e.files, 0)).toBe(1030);
    expect(level.files).toBe(1030);
    // Containers come first, so they are drawn before any file is folded.
    expect(level.entries.filter((e) => e.kind === 'container')).toHaveLength(30);

    const seen = new Set<string>();
    const add = (ids: string[]) => ids.forEach((id) => {
      expect(seen.has(id), id).toBe(false);
      seen.add(id);
    });
    add(level.entries.filter((e) => e.kind === 'file').map((e) => e.id));
    let foldedEntries = 0;
    for (const fold of level.entries.filter((e) => e.kind === 'fold')) {
      const opened = buildLevel(structure, fold.target as { path: string; fold: string }) as Level;
      expect(opened.entries.length).toBe(fold.folded);
      expect(opened.entries.length).toBeLessThanOrEqual(LEVEL_LIMIT);
      expect(opened.folded).toBe(0);
      expect(opened.files).toBe(fold.files);
      foldedEntries += opened.entries.length;
      add(opened.entries.map((e) => e.id));
    }
    expect(foldedEntries).toBe(level.folded);
    expect(seen.size).toBe(1000);
    expect(level.entries.filter((e) => e.kind === 'fold')[0].label).toBe(`${level.entries.filter((e) => e.kind === 'fold')[0].folded} more`);
  });

  it('draws everything, with no fold, when it fits', () => {
    const level = buildLevel(structureOf(many(LEVEL_LIMIT).map(file)), { path: 'd' }) as Level;
    expect(level.entries).toHaveLength(LEVEL_LIMIT);
    expect(level.folded).toBe(0);
    expect(level.entries.some((e) => e.kind === 'fold')).toBe(false);
  });

  it('opens no fold the level did not make', () => {
    const structure = structureOf(many(450).map(file));
    const level = buildLevel(structure, { path: 'd' }) as Level;
    const [fold] = level.entries.filter((e) => e.kind === 'fold');
    expect(fold.target?.fold).toBe(`${LEVEL_LIMIT - 1}-450`);
    expect(buildLevel(structure, { path: 'd', fold: '5-450' })).toBeNull();
    expect(buildLevel(structure, { path: 'd', fold: 'x' })).toBeNull();
  });

  it('keeps the drawn nodes and folds within the limit for any size, and the folds hold the rest exactly', () => {
    for (const total of [LEVEL_LIMIT + 1, 2 * LEVEL_LIMIT - 1, 2 * LEVEL_LIMIT, 2 * LEVEL_LIMIT + 5, 5000, 159_600, 159_601, 1_000_000]) {
      const ranges = foldRanges(total);
      const kept = ranges[0][0];
      // Past 159,600 entries the folds alone outnumber the limit; they still hold everything.
      if (total <= 159_600) expect(kept + ranges.length, String(total)).toBeLessThanOrEqual(LEVEL_LIMIT);
      expect(ranges.every(([from, to]) => to > from && to - from <= LEVEL_LIMIT)).toBe(true);
      expect(ranges.reduce((n, [from, to]) => n + to - from, kept)).toBe(total);
      expect(ranges.every(([from], i) => i === 0 || from === ranges[i - 1][1])).toBe(true);
    }
    expect(foldRanges(LEVEL_LIMIT)).toEqual([]);
  });

  it('folds the groups of the top level the same way', () => {
    const structure = structureOf(Array.from({ length: 450 }, (_, i) => file(`g${String(i).padStart(3, '0')}/x.js`)));
    const top = buildLevel(structure, {}) as Level;
    expect(top.entries.length).toBe(LEVEL_LIMIT);
    expect(top.folded).toBe(51);
    expect(top.files).toBe(450);
  });
});

describe('the nodes a file owns', () => {
  it('lists them in the order of the file, up to the limit, and says how many are over', () => {
    const nodes = [file('a.js'), fn('a.js', 'late', 30), fn('a.js', 'early', 2), { id: 'function:a.js:loose', type: 'function', name: 'loose', filePath: 'a.js' } as GraphNode];
    const structure = structureOf(nodes, [contains('a.js', 'late'), contains('a.js', 'early')]);
    expect(fileChildren(structure, 'file:a.js').shown.map((n) => n.name)).toEqual(['early', 'late', 'loose']);
    expect(fileChildren(structure, 'file:a.js', 2)).toMatchObject({ more: 1 });
    expect(fileChildren(structure, 'file:a.js', 2).shown).toHaveLength(2);
    expect(fileChildren(structure, 'file:none').shown).toEqual([]);
  });
});
