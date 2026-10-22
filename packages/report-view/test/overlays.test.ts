import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { GraphEdge, GraphNode } from '../src/data/graph';
import { buildIndex } from '../src/data/indexes';
import type { FileInfo, LevelEntry } from '../src/lib/graph-structure';
import { OVERLAY_NAMES, overlayParam, parseOverlays, toggleOverlay, type OverlayName } from '../src/lib/overlay-names';
import {
  anyOverlay, bandOf, docMapFacts, entryMarks, hotLevel, hotspotsFacts, hotspotsRules, HOT_LEVELS, legendBlocks, legendOf, nodeMarks, NO_OVERLAYS, overlayAvailability, scoreBands, unusedFacts,
  type EntryHot, type OverlayFacts,
} from '../src/lib/overlays';

const ADVICE = /safe to (delete|remove)|can be (deleted|removed)|should be (removed|deleted)|recommend|you should|consider (removing|deleting)/i;
// Words that would turn a legend or a tooltip into advice, beyond the sentences the built page is scanned for.
const IMPERATIVE = /\b(should|must|ought|recommend\w*|consider|prefer|avoid|remove|delete|refactor|investigate|review|fix|dead code|safe)\b/i;

const fileInfo = (path: string, nodes = 1): FileInfo => ({ id: `file:${path}`, path, name: path.slice(path.lastIndexOf('/') + 1), nodes });

describe('scoreBands', () => {
  const eight = [1, 2, 3, 4, 5, 6, 7, 8];

  it('cuts the sorted scores into quartiles: a band starts at the score a quarter, a half and three quarters in', () => {
    const { cuts, bands, scored } = scoreBands(eight);
    expect(cuts).toEqual([3, 5, 7]);
    expect(scored).toBe(8);
    expect(bands.map((b) => [b.min, b.max, b.count])).toEqual([[1, 2, 2], [3, 4, 2], [5, 6, 2], [7, 8, 2]]);
  });

  it('cuts at the score a quarter of the way in when the count is not a multiple of four', () => {
    const ten = Array.from({ length: 10 }, (_, i) => i + 1);
    const { cuts, bands } = scoreBands(ten);
    expect(cuts).toEqual([3, 6, 8]);
    expect(bands.map((b) => [b.min, b.max, b.count])).toEqual([[1, 2, 2], [3, 5, 3], [6, 7, 2], [8, 10, 3]]);
    expect(scoreBands([5, 1, 3]).cuts).toEqual([3, 5]);
  });

  it('puts a score on a cut point in the higher band, and each score in exactly one band', () => {
    const { cuts } = scoreBands(eight);
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((score) => bandOf(score, { cuts }))).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    expect(bandOf(0, { cuts })).toBe(0);
    expect(bandOf(1e9, { cuts })).toBe(3);
  });

  it('gives the same bands whatever order the scores come in', () => {
    const shuffled = [5, 1, 8, 3, 7, 2, 6, 4];
    expect(scoreBands(shuffled)).toEqual(scoreBands(eight));
  });

  it('keeps equal scores in one band, so the cuts that coincide merge and there are fewer bands', () => {
    const { cuts, bands } = scoreBands([0, 0, 0, 0, 0, 0, 5, 9]);
    expect(cuts).toEqual([5]);
    expect(bands.map((b) => [b.min, b.max, b.count])).toEqual([[0, 0, 6], [5, 9, 2]]);
    expect(scoreBands([4, 4, 4, 4]).bands).toHaveLength(1);
    expect(scoreBands([4, 4, 4, 4]).cuts).toEqual([]);
  });

  it('is one band for one score, and none for no score', () => {
    expect(scoreBands([7]).bands.map((b) => [b.min, b.max, b.count])).toEqual([[7, 7, 1]]);
    expect(scoreBands([])).toEqual({ cuts: [], bands: [], scored: 0 });
  });

  it('accounts for every score: the counts of the bands add up', () => {
    const scores = Array.from({ length: 101 }, (_, i) => (i * 37) % 53);
    const { bands, scored } = scoreBands(scores);
    expect(bands.reduce((sum, b) => sum + b.count, 0)).toBe(scored);
    expect(scored).toBe(101);
    for (let i = 1; i < bands.length; i += 1) expect(bands[i].min).toBeGreaterThan(bands[i - 1].max);
  });

  it('spreads the bands over the fill levels, the highest band on the strongest', () => {
    expect([0, 1, 2, 3].map((i) => hotLevel(i, 4))).toEqual([1, 2, 3, 4]);
    expect([0, 1].map((i) => hotLevel(i, 2))).toEqual([1, 4]);
    expect(hotLevel(0, 1)).toBe(HOT_LEVELS - 1);
    for (let count = 1; count <= 4; count += 1) for (let i = 0; i < count; i += 1) expect(hotLevel(i, count)).toBeGreaterThanOrEqual(1);
  });
});

describe('the facts of each product', () => {
  const hotspots = {
    files: [
      { path: 'a.js', score: 800 }, { path: 'a.js', score: 5 }, { path: 'b.js', score: 10 }, { path: 'bin.dat', score: null }, { path: 'c.js' },
      { path: 'd.js', score: 100 }, { path: 'e.js', score: 40 },
    ],
  };

  it('takes each path once, the first row winning, and lists a file without a score apart from one without history', () => {
    const facts = hotspotsFacts(hotspots);
    expect(facts.scores.get('a.js')).toBe(800);
    expect([...facts.scores.keys()].sort()).toEqual(['a.js', 'b.js', 'd.js', 'e.js']);
    expect(facts.listed.has('bin.dat')).toBe(true);
    expect(facts.listed.has('c.js')).toBe(true);
    expect(facts.listed.has('absent.js')).toBe(false);
    expect(facts.bands.scored).toBe(4);
  });

  const NODES: GraphNode[] = [
    { id: 'file:a.js', type: 'file', name: 'a.js', filePath: 'a.js' },
    { id: 'function:a.js:f', type: 'function', name: 'f', filePath: 'a.js' },
    { id: 'function:a.js:g', type: 'function', name: 'g', filePath: 'a.js' },
    { id: 'function:a.js:h', type: 'function', name: 'h', filePath: 'a.js' },
    { id: 'file:b.js', type: 'file', name: 'b.js', filePath: 'b.js' },
    { id: 'function:b.js:t', type: 'function', name: 't', filePath: 'b.js' },
  ];
  const EDGES: GraphEdge[] = ['f', 'g', 'h'].map((n) => ({ source: 'file:a.js', target: `function:a.js:${n}`, type: 'contains' }))
    .concat([{ source: 'file:b.js', target: 'function:b.js:t', type: 'contains' }]);
  const index = buildIndex({ nodes: NODES, edges: EDGES });

  it('puts the unused functions on their nodes and their files, by confidence, and leaves test-only ones out', () => {
    const facts = unusedFacts({
      unused: [
        { id: 'function:a.js:f', confidence: 'high' }, { id: 'function:a.js:g', confidence: 'low' }, { id: 'function:a.js:h' }, { id: 'function:gone.js:x', confidence: 'medium' },
        { id: 'function:a.js:f', confidence: 'low' },
      ],
      testOnly: [{ id: 'function:b.js:t', confidence: 'high' }],
    }, index);
    expect(facts.byNode.get('function:a.js:f')).toBe('high');
    expect(facts.byNode.get('function:a.js:h')).toBe('unrated');
    expect(facts.byNode.has('function:b.js:t')).toBe(false);
    expect(facts.byFile.get('file:a.js')).toEqual({ high: 1, medium: 0, low: 1, unrated: 1 });
    expect(facts.byFile.has('file:b.js')).toBe(false);
    expect(facts.notInGraph).toBe(1);
    expect(facts.listed).toBe(5);
  });

  it('splits the coverage files into those with and without evidence, and says when there is no coverage', () => {
    const facts = docMapFacts({ coverage: { files: [{ path: 'a.js', units: [1, 2] }, { path: 'b.js', units: [] }, { path: 'c.js' }] } });
    expect([...facts.withEvidence]).toEqual(['a.js']);
    expect([...facts.withoutEvidence].sort()).toEqual(['b.js', 'c.js']);
    expect(facts.hasCoverage).toBe(true);
    expect(docMapFacts({ coverage: null }).hasCoverage).toBe(false);
    expect(docMapFacts({}).hasCoverage).toBe(false);
  });
});

describe('what a node is drawn with', () => {
  const hotspots = hotspotsFacts({ files: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((p, i) => ({ path: `${p}.js`, score: (i + 1) * 10 })) });
  const unused = unusedFacts({ unused: [{ id: 'function:a.js:f', confidence: 'medium' }, { id: 'function:b.js:g', confidence: 'high' }, { id: 'function:b.js:h', confidence: 'low' }] }, buildIndex({
    nodes: ['a', 'b'].flatMap((p) => [
      { id: `file:${p}.js`, type: 'file', name: `${p}.js`, filePath: `${p}.js` },
      ...(p === 'a' ? [{ id: 'function:a.js:f', type: 'function', name: 'f', filePath: 'a.js' }] : [{ id: 'function:b.js:g', type: 'function', name: 'g', filePath: 'b.js' }, { id: 'function:b.js:h', type: 'function', name: 'h', filePath: 'b.js' }]),
    ]),
    edges: [
      { source: 'file:a.js', target: 'function:a.js:f', type: 'contains' }, { source: 'file:b.js', target: 'function:b.js:g', type: 'contains' }, { source: 'file:b.js', target: 'function:b.js:h', type: 'contains' },
    ],
  }));
  const docMap = docMapFacts({ coverage: { files: [{ path: 'a.js', units: [1] }, { path: 'b.js', units: [] }, { path: 'c.js', units: [2] }] } });
  const all: OverlayFacts = { hotspots, unused, docMap };
  const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'z'].map((p) => fileInfo(`${p}.js`));
  const at = (name: string) => files.find((f) => f.name === `${name}.js`) as FileInfo;

  it('has no marks when no overlay is on', () => {
    expect(anyOverlay(NO_OVERLAYS)).toBe(false);
    expect(entryMarks([at('a')], NO_OVERLAYS, false)).toBeNull();
    expect(entryMarks([], all, true)).toBeNull();
  });

  it('draws a file in the band of its score, and says the score and the band', () => {
    const top = entryMarks([at('h')], { ...NO_OVERLAYS, hotspots }, false) as NonNullable<ReturnType<typeof entryMarks>>;
    const bottom = entryMarks([at('a')], { ...NO_OVERLAYS, hotspots }, false) as NonNullable<ReturnType<typeof entryMarks>>;
    expect(top.hot).toBe(4);
    expect(bottom.hot).toBe(1);
    expect(top.title).toBe('Hotspots: score 80, band 4 of 4 (70 to 80).');
    expect(top.chips).toEqual([]);
  });

  it('tells a file with no history from one listed without a score, and draws neither in a band', () => {
    const facts = { ...NO_OVERLAYS, hotspots: hotspotsFacts({ files: [{ path: 'x.js', score: 5 }, { path: 'bin.dat', score: null }] }) };
    const none = entryMarks([fileInfo('z.js')], facts, false) as NonNullable<ReturnType<typeof entryMarks>>;
    const noScore = entryMarks([fileInfo('bin.dat')], facts, false) as NonNullable<ReturnType<typeof entryMarks>>;
    expect(none.hot).toBeNull();
    expect(none.title).toBe('Hotspots: the product lists no history for this file.');
    expect(noScore.hot).toBeNull();
    expect(noScore.title).toBe('Hotspots: the product lists this file without a score.');
  });

  it('draws a directory, layer or fold in the band of the rule it is given, and says that rule', () => {
    const sum: EntryHot = { rule: 'sum', sum: 80, scored: 2, siblings: 4, bands: scoreBands([10, 40, 80, 120]) };
    const marks = entryMarks([at('a'), at('c'), at('z')], { ...NO_OVERLAYS, hotspots }, true, sum) as NonNullable<ReturnType<typeof entryMarks>>;
    expect(marks.hot).toBe(hotLevel(bandOf(80, sum.bands), sum.bands.bands.length));
    expect(marks.title).toContain('add up to 80');
  });

  it('marks a file with the number of its functions listed as unused, coloured by the highest confidence', () => {
    const one = entryMarks([at('a')], { ...NO_OVERLAYS, unused }, false) as NonNullable<ReturnType<typeof entryMarks>>;
    expect(one.chips).toEqual([{ text: '1 unused', tone: 'medium' }]);
    const two = entryMarks([at('b')], { ...NO_OVERLAYS, unused }, false) as NonNullable<ReturnType<typeof entryMarks>>;
    expect(two.chips).toEqual([{ text: '2 unused', tone: 'high' }]);
    expect(two.title).toBe('Unused: 2 functions of this file are listed as unused (1 high, 1 low).');
  });

  it('adds up the listed functions of a directory, and says in how many of its files they are', () => {
    const marks = entryMarks([at('a'), at('b'), at('c')], { ...NO_OVERLAYS, unused }, true) as NonNullable<ReturnType<typeof entryMarks>>;
    expect(marks.chips).toEqual([{ text: '3 unused', tone: 'high' }]);
    expect(marks.title).toContain('3 functions listed as unused in 2 of its 3 files (1 high, 1 medium, 1 low)');
    expect(marks.title).toContain('highest confidence');
  });

  it('puts no chip on a file or directory with no listed function, and says so', () => {
    const file = entryMarks([at('c')], { ...NO_OVERLAYS, unused }, false) as NonNullable<ReturnType<typeof entryMarks>>;
    expect(file.chips).toEqual([]);
    expect(file.title).toBe('Unused: no function of this file is listed as unused.');
    const dir = entryMarks([at('c'), at('d')], { ...NO_OVERLAYS, unused }, true) as NonNullable<ReturnType<typeof entryMarks>>;
    expect(dir.chips).toEqual([]);
    expect(dir.title).toContain('none of the functions of its 2 files is listed as unused');
  });

  it('tells a file with evidence, one without, and one outside the coverage', () => {
    const facts = { ...NO_OVERLAYS, docMap };
    expect((entryMarks([at('a')], facts, false) as NonNullable<ReturnType<typeof entryMarks>>).chips).toEqual([{ text: 'evidence', tone: 'evidence' }]);
    expect((entryMarks([at('b')], facts, false) as NonNullable<ReturnType<typeof entryMarks>>).chips).toEqual([{ text: 'no evidence', tone: 'no-evidence' }]);
    const outside = entryMarks([at('z')], facts, false) as NonNullable<ReturnType<typeof entryMarks>>;
    expect(outside.chips).toEqual([]);
    expect(outside.title).toBe('Doc map: this file is not among the code files of the coverage.');
  });

  it('counts the files of a directory with evidence among the files of the coverage only', () => {
    const marks = entryMarks([at('a'), at('b'), at('c'), at('z')], { ...NO_OVERLAYS, docMap }, true) as NonNullable<ReturnType<typeof entryMarks>>;
    expect(marks.chips).toEqual([{ text: '2/3 evidence', tone: 'evidence' }]);
    expect(marks.title).toContain('2 of its 3 counted files have evidence; 1 file is not among the coverage');
    const none = entryMarks([at('b'), at('z')], { ...NO_OVERLAYS, docMap }, true) as NonNullable<ReturnType<typeof entryMarks>>;
    expect(none.chips).toEqual([{ text: '0/1 evidence', tone: 'no-evidence' }]);
  });

  it('keeps the overlays apart: each one that is on adds its own line, and one that is off adds nothing', () => {
    const marks = entryMarks([at('a')], all, false) as NonNullable<ReturnType<typeof entryMarks>>;
    expect(marks.title?.split('\n').map((line) => line.split(':')[0])).toEqual(['Hotspots', 'Unused', 'Doc map']);
    expect(marks.chips.map((c) => c.tone)).toEqual(['medium', 'evidence']);
    const only = entryMarks([at('a')], { ...NO_OVERLAYS, unused }, false) as NonNullable<ReturnType<typeof entryMarks>>;
    expect(only.hot).toBeNull();
    expect(only.title?.split('\n')).toHaveLength(1);
  });

  it('marks a function row when the unused-code product lists it, and no other row', () => {
    expect(nodeMarks('function:a.js:f', { ...NO_OVERLAYS, unused })).toEqual({ confidence: 'medium', title: 'Unused: listed as unused, confidence medium.' });
    expect(nodeMarks('function:a.js:other', { ...NO_OVERLAYS, unused })).toEqual({ confidence: null, title: null });
    expect(nodeMarks('function:a.js:f', NO_OVERLAYS)).toBeNull();
  });
});

describe('hotspots bands by the rule of each entry', () => {
  const fileScores = Array.from({ length: 64 }, (_, i) => ({ path: `f${i + 1}.js`, score: i + 1 }));
  const dirs = Array.from({ length: 8 }, (_, i) => ({ path: `d${i + 1}`, score: (i + 1) * 100 }));
  const facts = hotspotsFacts({ files: fileScores, directories: dirs });
  const on: OverlayFacts = { ...NO_OVERLAYS, hotspots: facts };
  const files = (...ns: number[]) => ns.map((n) => fileInfo(`f${n}.js`));
  const entry = (id: string, kind: LevelEntry['kind'], members: FileInfo[], dir: string | null = null) => ({ id, kind, dir, members });
  const marksOf = (rules: ReturnType<typeof hotspotsRules>, e: ReturnType<typeof entry>) => entryMarks(e.members, on, e.kind !== 'file', rules.byEntry.get(e.id)) as NonNullable<ReturnType<typeof entryMarks>>;

  it('reads the directory scores the product lists, with their own quartiles, apart from the file scores', () => {
    expect(facts.directoryScores.get('d3')).toBe(300);
    expect([...facts.directoryScores.keys()]).toHaveLength(8);
    expect(facts.directoryBands.scored).toBe(8);
    expect(facts.directoryBands.cuts).toEqual([300, 500, 700]);
    expect(facts.bands.scored).toBe(64);
    // A row with no score, a repeated path and a row that is not an object take no part.
    const odd = hotspotsFacts({ files: [], directories: [{ path: 'a', score: 5 }, { path: 'a', score: 9 }, { path: 'b', score: null }, { path: 'c' }, 7] as never });
    expect([...odd.directoryScores]).toEqual([['a', 5]]);
    expect(hotspotsFacts({ files: [] }).directoryScores.size).toBe(0);
  });

  it('gives each entry the rule it has: files their score, a listed directory its own, everything else the sum of its files', () => {
    const entries = [
      entry('file', 'file', files(1)), entry('listed', 'container', files(2, 3), 'd3'), entry('unlisted', 'container', files(4), 'elsewhere'),
      entry('cluster', 'cluster', files(5, 6)), entry('fold', 'fold', files(7)), entry('group', 'container', files(8), null),
    ];
    const rules = hotspotsRules(entries, facts);
    expect([...rules.byEntry].map(([id, hot]) => [id, hot.rule])).toEqual([['file', 'file'], ['listed', 'directory'], ['unlisted', 'sum'], ['cluster', 'sum'], ['fold', 'sum'], ['group', 'sum']]);
    expect(rules.scales.files?.scored).toBe(64);
    expect(rules.scales.directories?.scored).toBe(8);
    expect(rules.scales.sums?.scored).toBe(4);
  });

  it('bands a directory the product lists by the product\'s own directory score, whatever its files score', () => {
    const entries = [entry('top', 'container', files(1), 'd8'), entry('bottom', 'container', files(64), 'd1'), entry('mid', 'container', files(1), 'd5')];
    const rules = hotspotsRules(entries, facts);
    // d8 has the highest directory score though its only file has the lowest file score; d1 is the reverse.
    expect(marksOf(rules, entries[0]).hot).toBe(4);
    expect(marksOf(rules, entries[1]).hot).toBe(1);
    expect(marksOf(rules, entries[2]).hot).toBe(3);
    expect(marksOf(rules, entries[0]).title).toBe('Hotspots: the product lists this directory with score 800, band 4 of 4 (700 to 800), among the 8 directory scores it lists.');
  });

  it('does not put every layer cluster in the top band when each holds one top-band file: the sums of their files are banded among the clusters', () => {
    // Cluster k holds files k, k+8, ..., k+56: each has a file with a score in the top quartile of the files (49 to 64).
    const clusters = Array.from({ length: 8 }, (_, k) => entry(`c${k + 1}`, 'cluster', files(...Array.from({ length: 8 }, (_, j) => k + 1 + 8 * j))));
    for (const cluster of clusters) expect(Math.max(...cluster.members.map((m) => facts.scores.get(m.path) as number))).toBeGreaterThanOrEqual(facts.bands.cuts[2]);
    const rules = hotspotsRules(clusters, facts);
    expect(clusters.map((c) => marksOf(rules, c).hot)).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
    expect(marksOf(rules, clusters[7]).title).toBe('Hotspots: the scores of its 8 scored files (of 8) add up to 288; band 4 of 4 (280 to 288) among the 8 entries of this level that have no directory score.');
  });

  it('takes the sum over the files that have a score, bands it among the entries of the level that have one, and draws none for an entry whose files have no score', () => {
    const entries = [entry('a', 'fold', files(1, 2)), entry('b', 'fold', files(10)), entry('c', 'cluster', [fileInfo('unscored.js')]), entry('d', 'fold', [...files(20), fileInfo('unscored.js')])];
    const rules = hotspotsRules(entries, facts);
    expect(rules.byEntry.get('a')).toMatchObject({ rule: 'sum', sum: 3, scored: 2 });
    expect(rules.byEntry.get('c')).toMatchObject({ rule: 'sum', sum: null, scored: 0 });
    expect(rules.scales.sums?.scored).toBe(3);
    expect(marksOf(rules, entries[2]).hot).toBeNull();
    expect(marksOf(rules, entries[2]).title).toBe('Hotspots: none of its 1 file has a score.');
    expect(marksOf(rules, entries[3]).title).toContain('add up to 20');
    expect(marksOf(rules, entries[3]).title).toContain('1 scored file (of 2)');
    // The lowest sum is in the lowest band and the highest in the highest.
    expect(marksOf(rules, entries[0]).hot).toBeLessThan(marksOf(rules, entries[3]).hot as number);
  });

  it('says one entry, not "1 entries", when a level has a single entry banded by its sum', () => {
    const single = [entry('only', 'cluster', files(1, 2))];
    const rules = hotspotsRules(single, facts);
    expect(marksOf(rules, single[0]).title).toBe('Hotspots: the scores of its 2 scored files (of 2) add up to 3; band 1 of 1 (3 to 3) among the 1 entry of this level that has no directory score.');
    expect((legendOf('hotspots', on, rules.scales) as NonNullable<ReturnType<typeof legendOf>>).note).toContain('among the quartiles of the 1 such entry drawn at this level that has a sum');
  });

  it('banded the same whatever order the entries are drawn in', () => {
    const entries = Array.from({ length: 6 }, (_, k) => entry(`e${k}`, 'fold', files(k * 3 + 1, k * 3 + 2)));
    const one = hotspotsRules(entries, facts);
    const two = hotspotsRules([...entries].reverse(), facts);
    for (const e of entries) expect(marksOf(two, e).hot).toBe(marksOf(one, e).hot);
  });

  it('uses only the scales a level needs: a level of clusters has only the sum scale', () => {
    const rules = hotspotsRules([entry('c1', 'cluster', files(1)), entry('c2', 'cluster', files(2))], facts);
    expect(rules.scales.files).toBeNull();
    expect(rules.scales.directories).toBeNull();
    expect(rules.scales.sums?.scored).toBe(2);
    expect(hotspotsRules([], facts).scales).toEqual({ files: null, directories: null, sums: null });
  });

  it('writes each rule that applies into the legend, with the numbers of its own bands', () => {
    const rules = hotspotsRules([entry('f', 'file', files(1)), entry('d', 'container', files(2), 'd2'), entry('c', 'cluster', files(3)), entry('c2', 'cluster', files(4))], facts);
    const legend = legendOf('hotspots', on, rules.scales) as NonNullable<ReturnType<typeof legendOf>>;
    const prefixes = new Set(legend.rows.map((r) => r.label.split(' ')[0]));
    expect([...prefixes]).toEqual(['Files', 'Directories', 'Sums']);
    expect(legend.note).toContain('A file is banded by its own score, among the quartiles of the 64 file scores the product lists');
    expect(legend.note).toContain("A directory the product lists is banded by the product's score for it, among the quartiles of its 8 directory scores");
    expect(legend.note).toContain("A layer, a fold, or a directory the product has no score for is banded by the sum of its files' scores, among the quartiles of the 2 such entries drawn at this level that have a sum");
    expect(legend.rows.filter((r) => r.label.startsWith('Directories')).reduce((n, r) => n + (r.count ?? 0), 0)).toBe(8);
    expect(legend.note).not.toContain('highest band');
  });

  it('says only the rules of the level: a level of files has the file rule and nothing about directories or sums', () => {
    const rules = hotspotsRules([entry('f', 'file', files(1))], facts);
    const legend = legendOf('hotspots', on, rules.scales) as NonNullable<ReturnType<typeof legendOf>>;
    expect(legend.note).toContain('A file is banded');
    expect(legend.note).not.toContain('A directory');
    expect(legend.note).not.toContain('A layer');
  });
});

describe('the legend', () => {
  const hotspots = hotspotsFacts({ files: Array.from({ length: 8 }, (_, i) => ({ path: `f${i}.js`, score: (i + 1) * 100 })) });
  const unused = unusedFacts({
    unused: [{ id: 'function:x:a', confidence: 'high' }, { id: 'function:x:b', confidence: 'low' }, { id: 'function:gone:c', confidence: 'high' }, { id: 'function:gone:d' }],
  }, buildIndex({ nodes: ['a', 'b'].map((n) => ({ id: `function:x:${n}`, type: 'function', name: n, filePath: 'x.js' })), edges: [] }));
  const docMap = docMapFacts({ coverage: { files: [{ path: 'a.js', units: [1] }, { path: 'b.js', units: [] }] } });
  const all: OverlayFacts = { hotspots, unused, docMap };

  it('lists the score range of each band with its count, and says how the bands were made', () => {
    const legend = legendOf('hotspots', all) as NonNullable<ReturnType<typeof legendOf>>;
    expect(legend.rows.map((r) => [r.label, r.count])).toEqual([['Files 100 – 200', 2], ['Files 300 – 400', 2], ['Files 500 – 600', 2], ['Files 700 – 800', 2]]);
    expect(legend.note).toContain('quartiles of the 8 file scores');
    expect(legend.note).toContain('cut points 300, 500, 700');
    expect(legend.note).not.toContain('highest band');
    expect(legend.rows.map((r) => (r.swatch as { hot: number }).hot)).toEqual([1, 2, 3, 4]);
  });

  it('says there are no bands when no file has a score, and when every score is the same', () => {
    expect((legendOf('hotspots', { ...NO_OVERLAYS, hotspots: hotspotsFacts({ files: [{ path: 'a', score: null }] }) }) as NonNullable<ReturnType<typeof legendOf>>).note).toContain('no file with a score');
    const same = legendOf('hotspots', { ...NO_OVERLAYS, hotspots: hotspotsFacts({ files: [{ path: 'a', score: 3 }, { path: 'b', score: 3 }] }) }) as NonNullable<ReturnType<typeof legendOf>>;
    expect(same.rows).toHaveLength(1);
    expect(same.note).toContain('no cut point, since every score is the same');
  });

  it('lists the confidences with how many functions each covers, and how many listed functions the graph lacks', () => {
    const legend = legendOf('unused', all) as NonNullable<ReturnType<typeof legendOf>>;
    expect(legend.rows.map((r) => [r.label, r.count])).toEqual([['high confidence', 1], ['medium confidence', 0], ['low confidence', 1]]);
    expect(legend.note).toContain('2 listed functions have no node in the graph');
    expect(legend.note).toContain('used only by tests are not marked');
  });

  it('lists the doc-map files with and without evidence, and says when there is no coverage', () => {
    const legend = legendOf('doc-map', all) as NonNullable<ReturnType<typeof legendOf>>;
    expect(legend.rows.map((r) => [r.label, r.count])).toEqual([['with evidence', 1], ['without evidence', 1]]);
    expect((legendOf('doc-map', { ...NO_OVERLAYS, docMap: docMapFacts({ coverage: null }) }) as NonNullable<ReturnType<typeof legendOf>>).note).toContain('no coverage yet');
  });

  it('has no legend for an overlay that is off', () => {
    expect(legendOf('hotspots', NO_OVERLAYS)).toBeNull();
  });

  it('states facts and gives no advice: not in a legend, a row label, or a tooltip', () => {
    const texts: string[] = [];
    for (const name of OVERLAY_NAMES) {
      const legend = legendOf(name, all) as NonNullable<ReturnType<typeof legendOf>>;
      texts.push(legend.title, legend.note, ...legend.rows.map((r) => r.label));
    }
    const members = [fileInfo('f1.js'), fileInfo('a.js'), fileInfo('b.js')];
    texts.push(entryMarks(members, all, false)?.title ?? '');
    const withDirs = { ...all, hotspots: hotspotsFacts({ files: [{ path: 'f1.js', score: 100 }, { path: 'a.js', score: 50 }, { path: 'b.js', score: 9 }], directories: [{ path: 'src', score: 300 }, { path: 'lib', score: 40 }] }) };
    const rules = hotspotsRules([
      { id: 'c', kind: 'cluster', dir: null, members }, { id: 'd', kind: 'container', dir: 'src', members }, { id: 'x', kind: 'fold', dir: null, members: [members[0]] }, { id: 'y', kind: 'container', dir: 'zzz', members: [members[1]] }, { id: 'n', kind: 'fold', dir: null, members: [fileInfo('none.js')] },
    ], withDirs.hotspots);
    for (const [id, hot] of rules.byEntry) texts.push(entryMarks(id === 'n' ? [fileInfo('none.js')] : members, withDirs, true, hot)?.title ?? '');
    texts.push(legendOf('hotspots', withDirs, rules.scales)?.note ?? '');
    texts.push(nodeMarks('function:x:a', all)?.title ?? '', overlayAvailability(undefined).text ?? '');
    for (const block of legendBlocks(['hotspots', 'unused', 'doc-map'], NO_OVERLAYS, { hotspots: { status: 'not-run' }, unused: { status: 'unreadable' }, 'doc-map': { status: 'included' } }, { pending: true, error: null })) texts.push(block.title, block.note);
    for (const text of texts) {
      expect(text, text).not.toMatch(ADVICE);
      expect(text, text).not.toMatch(IMPERATIVE);
    }
    expect(texts.join('\n').length).toBeGreaterThan(500);
  });

  it('catches advice when there is some (the check sees what it is looking for)', () => {
    expect(IMPERATIVE.test('Functions that are unused are safe to review')).toBe(true);
    expect(ADVICE.test('This is safe to delete')).toBe(true);
  });
});

describe('the legend of the overlays that are on', () => {
  const hotspots = hotspotsFacts({ files: [{ path: 'a.js', score: 5 }, { path: 'b.js', score: 9 }] });
  const facts: OverlayFacts = { ...NO_OVERLAYS, hotspots };
  const idle = { pending: false, error: null };

  it('has a block for each overlay that is on, in the fixed order, and none for the others', () => {
    const blocks = legendBlocks(['unused', 'hotspots'], facts, { hotspots: { status: 'included' }, unused: { status: 'not-run' } }, idle);
    expect(blocks.map((b) => b.overlay)).toEqual(['hotspots', 'unused']);
    expect(legendBlocks([], facts, {}, idle)).toEqual([]);
  });

  it('says a product that was not run or cannot be read marks nothing', () => {
    const blocks = legendBlocks(['hotspots', 'unused', 'doc-map'], NO_OVERLAYS, { hotspots: { status: 'not-run' }, unused: { status: 'unreadable' } }, idle);
    expect(blocks.map((b) => b.note)).toEqual([
      'The hotspots product is not run: nothing is marked.',
      'The unused product is unreadable: nothing is marked.',
      'The doc map product is not run: nothing is marked.',
    ]);
    expect(blocks.every((b) => b.rows.length === 0)).toBe(true);
  });

  it('says it is reading a product that is on and not yet here, and why one could not be read', () => {
    expect(legendBlocks(['hotspots'], NO_OVERLAYS, { hotspots: { status: 'included' } }, { pending: true, error: null })[0].note).toBe('Reading the product.');
    expect(legendBlocks(['hotspots'], NO_OVERLAYS, { hotspots: { status: 'included' } }, { pending: false, error: 'the payload is damaged' })[0].note).toContain('could not be read: the payload is damaged');
  });

  it('names the revision of a product made at another one', () => {
    const [block] = legendBlocks(['hotspots'], facts, { hotspots: { status: 'different-revision', revision: 'git:abc' } }, idle);
    expect(block.note).toContain('The product was made at git:abc, not at the source snapshot.');
    expect(block.rows.length).toBeGreaterThan(0);
  });
});

describe('which overlays can be turned on', () => {
  it('disables an overlay whose product was not run, and says so', () => {
    expect(overlayAvailability({ status: 'not-run' })).toEqual({ enabled: false, text: 'not run' });
    expect(overlayAvailability(null)).toEqual({ enabled: false, text: 'not run' });
    expect(overlayAvailability({ status: 'unreadable', reason: 'bad json' })).toEqual({ enabled: false, text: 'unreadable' });
  });

  it('enables an overlay whose product is in the page, also one made at another revision', () => {
    expect(overlayAvailability({ status: 'included' })).toEqual({ enabled: true, text: null });
    expect(overlayAvailability({ status: 'different-revision' })).toEqual({ enabled: true, text: null });
  });
});

describe('the overlays in the address', () => {
  it('writes the ones that are on in the fixed order, and none as no parameter', () => {
    expect(overlayParam(['unused', 'hotspots'])).toBe('hotspots,unused');
    expect(overlayParam([])).toBeNull();
    expect(parseOverlays(overlayParam(['doc-map', 'unused']))).toEqual(['unused', 'doc-map']);
    expect(parseOverlays(null)).toEqual([]);
    expect(parseOverlays('hotspots,bogus,hotspots')).toEqual(['hotspots']);
  });

  it('turns one on or off and leaves the others', () => {
    let on: OverlayName[] = [];
    on = toggleOverlay(on, 'unused', true);
    on = toggleOverlay(on, 'hotspots', true);
    expect(on).toEqual(['hotspots', 'unused']);
    expect(toggleOverlay(on, 'hotspots', false)).toEqual(['unused']);
    expect(toggleOverlay(on, 'unused', true)).toEqual(['hotspots', 'unused']);
  });
});

describe('the overlay colours (design D8)', () => {
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/index.css'), 'utf-8');
  const theme = /@theme\s+static\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
  const token = (name: string): string => new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(theme)?.[1] ?? '';
  const channel = (v: number) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  it('has a fill for each level, getting darker with the band, with the page ink readable on each', () => {
    const fills = [1, 2, 3, 4].map((level) => token(`hot-${level}`));
    expect(fills.every((hex) => hex !== '')).toBe(true);
    for (let i = 1; i < fills.length; i += 1) expect(luminance(fills[i])).toBeLessThan(luminance(fills[i - 1]));
    for (const hex of fills) expect(contrast(token('ink-soft'), hex), hex).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps white text readable on every chip, and the chips apart', () => {
    const chips = ['unused-high', 'unused-medium', 'unused-low', 'evidence'].map(token);
    expect(chips.every((hex) => hex !== '')).toBe(true);
    for (const hex of chips) expect(contrast('#ffffff', hex), hex).toBeGreaterThanOrEqual(4.5);
    expect(new Set(chips.map((hex) => hex.toLowerCase())).size).toBe(chips.length);
  });

  it('has a stylesheet rule for each fill level', () => {
    for (let level = 1; level <= HOT_LEVELS; level += 1) expect(css).toContain(`.xv-node[data-xv-hot="${level}"]`);
  });
});
