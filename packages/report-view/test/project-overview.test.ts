import { describe, expect, it } from 'vitest';

import type { GraphEdge, GraphLayer, GraphNode } from '../src/data/graph';
import { buildIndex } from '../src/data/indexes';
import type { ManifestProduct } from '../src/data/manifest';
import { buildLevel, buildStructure } from '../src/lib/graph-structure';
import { complexityCounts, hotspotHighlights, hotspotsRowHref, layerRows, overviewTiles, readable, topConnected, UNUSED_HREF, unusedHighlights } from '../src/lib/project-overview';
import { parseRoute } from '../src/lib/route';
import { tourIdle, tourSteps } from '../src/lib/tour-state';

const file = (path: string): GraphNode => ({ id: `file:${path}`, type: 'file', name: path.slice(path.lastIndexOf('/') + 1), filePath: path });
const fn = (path: string, name: string, complexity?: string): GraphNode => ({ id: `function:${path}:${name}`, type: 'function', name, filePath: path, ...(complexity === undefined ? {} : { complexity }) });
const edge = (source: string, target: string, type = 'calls'): GraphEdge => ({ source, target, type });

describe('the most connected nodes', () => {
  it('counts every edge record of every type at each end, and breaks ties by name, then id', () => {
    const nodes = [file('a.js'), file('b.js'), file('c.js'), fn('a.js', 'zeta'), fn('b.js', 'alpha'), fn('c.js', 'alpha'), fn('c.js', 'lonely')];
    const edges = [
      edge('file:a.js', 'function:a.js:zeta', 'contains'),
      edge('file:b.js', 'function:b.js:alpha', 'contains'),
      edge('file:c.js', 'function:c.js:alpha', 'contains'),
      edge('file:c.js', 'function:c.js:lonely', 'contains'),
      edge('function:a.js:zeta', 'function:b.js:alpha'),
      edge('function:a.js:zeta', 'function:c.js:alpha'),
      edge('function:b.js:alpha', 'function:b.js:alpha'),
      edge('function:c.js:alpha', 'missing:node'),
      edge('missing:node', 'file:a.js', 'imports'),
    ];
    const top = topConnected({ nodes, edges }, 5);
    // zeta: contains in, two calls out = 3. b.js alpha: contains, a call in, a self-loop in and out = 4.
    // c.js alpha: contains, a call in, a call to a node the graph lacks = 3. file:a.js: contains out, an import in = 2.
    expect(top.map((n) => [n.id, n.degree])).toEqual([
      ['function:b.js:alpha', 4],
      ['function:c.js:alpha', 3],
      ['function:a.js:zeta', 3],
      ['file:a.js', 2],
      ['file:c.js', 2],
    ]);
    expect(top[0]).toMatchObject({ incoming: 3, outgoing: 1 });
    // Two nodes with the same name and degree go by id.
    const twins = topConnected({ nodes: [fn('b.js', 'same'), fn('a.js', 'same')], edges: [edge('function:b.js:same', 'function:a.js:same'), edge('function:a.js:same', 'function:b.js:same')] });
    expect(twins.map((n) => n.id)).toEqual(['function:a.js:same', 'function:b.js:same']);
    // A node without edges is not listed.
    expect(topConnected({ nodes: [file('x.js')], edges: [] })).toEqual([]);
  });
});

describe('the counts of the project overview', () => {
  it('counts complexity from the complexity field, the three classes always, and the nodes without one as not recorded', () => {
    expect(complexityCounts([fn('a', 'x', 'simple'), fn('a', 'y', 'complex'), fn('a', 'z', 'complex'), fn('a', 'w', 'huge'), fn('a', 'v'), file('a')])).toEqual([
      { key: 'simple', label: 'simple', count: 1 },
      { key: 'moderate', label: 'moderate', count: 0 },
      { key: 'complex', label: 'complex', count: 2 },
      { key: 'huge', label: 'huge', count: 1 },
      { key: '~none', label: 'not recorded', count: 2 },
    ]);
    expect(complexityCounts([fn('a', 'x', 'simple')]).map((row) => row.key)).toEqual(['simple', 'moderate', 'complex']);
  });

  it('takes the tiles from the records: nodes, edges, layers and file nodes', () => {
    const nodes = [file('src/a.js'), file('src/b.js'), fn('src/a.js', 'run')];
    const edges = [edge('file:src/a.js', 'function:src/a.js:run', 'contains'), edge('file:src/a.js', 'file:src/b.js', 'imports')];
    const layers: GraphLayer[] = [{ id: 'layer:core', name: 'Core', nodeIds: ['file:src/a.js'] }, { id: 'layer:ui', name: 'UI', nodeIds: ['file:src/b.js'] }];
    const index = buildIndex({ nodes, edges, layers });
    const structure = buildStructure(index);
    expect(overviewTiles({ nodes, edges }, index, structure)).toEqual({ nodes: 3, edges: 2, layers: 2, files: 2 });
    const bare = buildIndex({ nodes, edges });
    expect(overviewTiles({ nodes, edges }, bare, buildStructure(bare)).layers).toBe(0);
  });

  it('lists the top-level groups with their file counts, each opening the level its card opens', () => {
    const nodes = ['src/a.js', 'src/b.js', 'src/c.js', 'lib/x.py', 'README.md'].map(file);
    const layers: GraphLayer[] = [
      { id: 'layer:core', name: 'Core', nodeIds: ['file:src/a.js', 'file:src/b.js', 'file:src/c.js'] },
      { id: 'layer:data', name: 'Data', nodeIds: ['file:lib/x.py'] },
    ];
    const structure = buildStructure(buildIndex({ nodes, edges: [], layers }));
    const rows = layerRows(structure);
    expect(rows.map((row) => [row.label, row.files])).toEqual(expect.arrayContaining([['Core', 3], ['Data', 1], ['Not in any layer', 1]]));
    expect(rows.reduce((sum, row) => sum + row.files, 0)).toBe(5);
    const top = buildLevel(structure, { path: '' });
    for (const row of rows) {
      const card = top?.entries.find((entry) => entry.id === `group:${row.key}`);
      expect(row.path).toBe(card?.target?.path);
      expect(buildLevel(structure, { path: row.path })?.files).toBe(row.files);
    }
    expect(rows.map((row) => `group:${row.key}`)).toEqual(top?.entries.filter((entry) => entry.id.startsWith('group:')).map((entry) => entry.id));
  });
});

describe('the highlights', () => {
  it('counts the unused entries by confidence, high, medium and low always', () => {
    const facts = unusedHighlights({ unused: [{ confidence: 'high' }, { confidence: 'high' }, { confidence: 'low' }, { confidence: 'odd' }, {}, 'not a row'] });
    expect(facts.total).toBe(5);
    expect(facts.byConfidence).toEqual([
      { key: 'high', label: 'high', count: 2 },
      { key: 'medium', label: 'medium', count: 0 },
      { key: 'low', label: 'low', count: 1 },
      { key: 'odd', label: 'odd', count: 1 },
      { key: '~none', label: 'no confidence', count: 1 },
    ]);
    expect(unusedHighlights({}).total).toBe(0);
    expect(UNUSED_HREF).toBe('#/unused');
  });

  it('takes the three files with the highest score, each linking to its own row on the Files view', () => {
    const files = [{ path: 'b.js', score: 40 }, { path: 'a.js', score: 90 }, { path: 'c.js', score: 40 }, { path: 'd.js', score: 5 }, { path: 'e.js' }];
    const hot = hotspotHighlights({ files });
    expect(hot.map((row) => [row.path, row.score])).toEqual([['a.js', 90], ['b.js', 40], ['c.js', 40]]);
    for (const row of hot) {
      expect(row.href).toBe(hotspotsRowHref(row.path));
      expect(parseRoute(row.href)).toMatchObject({ page: 'hotspots', params: { view: 'files', row: row.path } });
    }
    expect(parseRoute(hotspotsRowHref('dir with space/x&y.js')).params.row).toBe('dir with space/x&y.js');
  });

  it('reads a product that is in the page at any revision, and no other', () => {
    expect(readable({ status: 'included' })).toBe(true);
    expect(readable({ status: 'different-revision' })).toBe(true);
    expect(readable({ status: 'not-run' })).toBe(false);
    expect(readable({ status: 'unreadable' })).toBe(false);
    expect(readable(undefined)).toBe(false);
  });
});

describe("the tour's state in the Learn sidebar", () => {
  const product = (over: Partial<ManifestProduct>): ManifestProduct => ({
    name: 'tour', label: 'Tour', status: 'included', reason: null, revision: null, revisionNote: null, command: '/excavator-tour', file: 'tour.json', payloads: ['p1'], ...over,
  });

  it('says each of the four states with what the manifest records', () => {
    expect(tourIdle(product({ status: 'not-run', payloads: [] }))).toEqual({ state: 'not-run', command: '/excavator-tour', file: 'tour.json' });
    expect(tourIdle(product({ status: 'unreadable', reason: 'line 3 is not JSON' }))).toEqual({ state: 'unreadable', reason: 'line 3 is not JSON' });
    expect(tourIdle(product({ status: 'different-revision', reason: 'other facts', factDigests: { tour: 'aaa', graph: 'bbb' } }))).toEqual({ state: 'different-revision', tourDigest: 'aaa', graphDigest: 'bbb', reason: 'other facts' });
    expect(tourIdle(product({ status: 'different-revision' }))).toMatchObject({ tourDigest: null, graphDigest: null });
    expect(tourIdle(product({ counts: { steps: 2 } }))).toEqual({ state: 'included', steps: 2 });
  });

  it("lists the steps' titles in the payload's order", () => {
    expect(tourSteps({ steps: [{ order: 1, title: 'Start' }, { order: 2, title: 'Engine' }] })).toEqual([{ order: 1, title: 'Start' }, { order: 2, title: 'Engine' }]);
    expect(tourSteps(null)).toEqual([]);
  });
});
