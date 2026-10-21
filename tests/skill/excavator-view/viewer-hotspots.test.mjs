/** The Hotspots page's pure functions, its sparkline and its sorted tables, run in Node through `vm`. */

import { describe, expect, it } from 'vitest';

import { all, byTag, fakeDom, textOf } from './fake-dom.mjs';
import { load } from './viewer-load.mjs';

const plain = (value) => JSON.parse(JSON.stringify(value));
const XV = load({ document: fakeDom() });
const { hotspots } = XV;

const file = (path, over = {}) => ({ path, commits: 3, authors: 1, added: 10, removed: 2, lastChanged: '2026-01-02T03:04:05+00:00', lines: 100, score: 300, lineageConflicts: 0, ...over });

describe('windowText', () => {
  it('says whole history or the window the product records', () => {
    expect(hotspots.windowText({ since: null, sinceUtc: null })).toBe('whole history');
    expect(hotspots.windowText(undefined)).toBe('whole history');
    expect(hotspots.windowText({ since: '2025-01-01', sinceUtc: '2025-01-01T00:00:00Z' })).toBe('since 2025-01-01 (2025-01-01T00:00:00Z)');
    expect(hotspots.windowText({ since: '2025-01-01' })).toBe('since 2025-01-01');
  });
});

describe('fields a product may lack', () => {
  it('says a field is not provided when it is absent, shows empty for null, and keeps 0 as 0', () => {
    expect(hotspots.numberField(undefined)).toBe('not provided by the product');
    expect(hotspots.numberField(null)).toBeNull();
    expect(hotspots.numberField(0)).toBe('0');
    expect(hotspots.numberField(1234567)).toBe('1,234,567');
    expect(hotspots.plainField(undefined)).toBe(XV.NOT_PROVIDED);
    expect(hotspots.plainField(0.33)).toBe('0.33');
    expect(hotspots.dateText(undefined)).toBe(XV.NOT_PROVIDED);
    expect(hotspots.dateText(null)).toBeNull();
    expect(hotspots.dateText('2026-09-02T14:19:41+08:00')).toBe('2026-09-02');
  });

  it('orders times by the instant, not by the text', () => {
    expect(hotspots.timeKey('2026-01-01T00:00:00+08:00')).toBeLessThan(hotspots.timeKey('2026-01-01T00:00:00+00:00'));
    expect(hotspots.timeKey(null)).toBeNull();
    expect(hotspots.timeKey('not a time')).toBeNull();
  });
});

describe('score', () => {
  it('finds the highest score and each score as a share of it', () => {
    const rows = [file('a', { score: 50 }), file('b', { score: 200 }), file('c', { score: null })];
    expect(hotspots.maxScore(rows)).toBe(200);
    expect(hotspots.scoreShare(50, 200)).toBe(25);
    expect(hotspots.scoreShare(200, 200)).toBe(100);
    expect(hotspots.scoreShare(null, 200)).toBeNull();
    expect(hotspots.scoreShare(5, null)).toBeNull();
    expect(hotspots.maxScore([file('x', { score: null })])).toBeNull();
    expect(hotspots.maxScore([])).toBeNull();
  });
});

describe('the sparkline', () => {
  const byYear = { 2022: 118, 2020: 0, 2021: 0, 2023: 457 };

  it('orders years numerically and keeps their values', () => {
    expect(plain(hotspots.yearSeries(byYear))).toEqual([{ year: '2020', commits: 0 }, { year: '2021', commits: 0 }, { year: '2022', commits: 118 }, { year: '2023', commits: 457 }]);
    expect(hotspots.yearText(hotspots.yearSeries(byYear))).toBe('2020: 0, 2021: 0, 2022: 118, 2023: 457');
    expect(hotspots.yearSeries(undefined)).toBeNull();
    expect(hotspots.yearSeries(null)).toBeNull();
  });

  it('makes one bar per year, the highest as tall as the box, a year of 0 with no height', () => {
    const bars = hotspots.sparkBars(hotspots.yearSeries(byYear), 84, 24, 1);
    expect(bars).toHaveLength(4);
    expect(bars.map((b) => b.height)).toEqual([0, 0, (118 / 457) * 24, 24]);
    expect(bars[3].y).toBe(0);
    expect(bars[0].y).toBe(24);
    expect(bars.map((b) => b.title)).toEqual(['2020: 0 commits', '2021: 0 commits', '2022: 118 commits', '2023: 457 commits']);
    expect(bars[1].x).toBeCloseTo(bars[0].x + bars[0].width + 1);
    expect(bars[3].x + bars[3].width).toBeCloseTo(84);
  });

  it('has no bar height when every year is 0, and no bars for no years', () => {
    expect(hotspots.sparkBars([{ year: '2020', commits: 0 }], 84, 24, 1)[0].height).toBe(0);
    expect(hotspots.sparkBars([], 84, 24, 1)).toEqual([]);
  });

  it('builds an svg with one rect per year and the exact numbers in titles', () => {
    const svg = hotspots.sparkline(byYear);
    expect(svg.tag).toBe('svg');
    expect(svg.ns).toContain('w3.org');
    const rects = byTag(svg, 'rect');
    expect(rects).toHaveLength(4);
    expect(rects.map((r) => textOf(r))).toEqual(['2020: 0 commits', '2021: 0 commits', '2022: 118 commits', '2023: 457 commits']);
    expect(svg.attributes['aria-label']).toBe('Commits by year: 2020: 0, 2021: 0, 2022: 118, 2023: 457');
  });

  it('says a product without commitsByYear does not provide it, and shows empty for null', () => {
    expect(hotspots.sparkline(undefined)).toBe('not provided by the product');
    expect(hotspots.sparkline(null)).toBeNull();
  });
});

describe('notices', () => {
  const base = { historyAvailable: true, noHistory: null, repos: [], counts: {} };

  it('has none for a product with history', () => {
    expect(hotspots.notices(base)).toEqual([]);
  });

  it('says there is no history and why', () => {
    const [text] = hotspots.notices({ ...base, historyAvailable: false, noHistory: { reason: 'not-a-repository', repositoryRoot: null, pathInRepository: null } });
    expect(text).toContain('There is no history to count.');
    expect(text).toContain('Reason: not-a-repository');
    const [inside] = hotspots.notices({ ...base, historyAvailable: false, noHistory: { reason: 'inside-repository', repositoryRoot: '../..', pathInRepository: 'apps/web' } });
    expect(inside).toContain('inside-repository');
    expect(inside).toContain('"apps/web"');
    expect(inside).toContain('"../.."');
    expect(inside).not.toContain('not a Git repository');
    expect(hotspots.notices({ ...base, historyAvailable: false })[0]).toContain('records no reason');
  });

  it('says a shallow clone gives lower bounds, with its boundary and earliest commit', () => {
    const list = hotspots.notices({ ...base, repos: [{ path: 'svc', shallow: true, boundaryCommits: 2, earliestVisibleCommit: '2025-03-01T00:00:00Z' }, { path: 'ok', shallow: false }] });
    expect(list).toHaveLength(1);
    expect(list[0]).toBe('svc is a shallow clone: its counts are lower bounds. 2 boundary commit(s) are not counted, and nothing before 2025-03-01T00:00:00Z is visible.');
  });

  it('says files outside every repository have no history', () => {
    expect(hotspots.notices({ ...base, counts: { filesWithoutHistory: 3 } })[0]).toContain('3 file(s)');
    expect(hotspots.notices({ ...base, counts: { filesWithoutHistory: 0 } })).toEqual([]);
  });
});

describe('statements of the product', () => {
  it('writes the conservation line and whether it holds', () => {
    expect(hotspots.conservationText({ changesRead: 100, attributed: 60, outsideSelection: 40 })).toBe('changes read (100) = attributed to selected files (60) + outside the selection (40): holds');
    expect(hotspots.conservationText({ changesRead: 100, attributed: 60, outsideSelection: 41 })).toContain('does not hold');
    expect(hotspots.conservationText(undefined)).toBeNull();
  });

  it('writes the pair rule in the product\'s own numbers', () => {
    expect(hotspots.coChangeText({ maxFilesPerCommit: 30, minTogether: 3 })).toBe(
      'A pair counts the commits that changed both files. Commits that changed 2 to 30 selected files are counted; a pair is listed when its files changed together at least 3 times.');
    expect(hotspots.coChangeText(null)).toBeNull();
  });
});

describe('filterRows', () => {
  const rows = [file('src/A.go'), file('docs/b.md'), file('src/c.go')];
  it('keeps the paths that contain the text, ignoring case, and every row for an empty query', () => {
    expect(hotspots.filterRows(rows, 'SRC/', [(r) => r.path]).map((r) => r.path)).toEqual(['src/A.go', 'src/c.go']);
    expect(hotspots.filterRows(rows, '  ', [(r) => r.path])).toBe(rows);
    expect(hotspots.filterRows(rows, 'zzz', [(r) => r.path])).toEqual([]);
  });

  it('looks in every field it is given', () => {
    const pairs = [{ a: 'x/1', b: 'y/2' }, { a: 'z/3', b: 'x/4' }, { a: 'q', b: 'r' }];
    expect(hotspots.filterRows(pairs, 'x/', [(r) => r.a, (r) => r.b])).toHaveLength(2);
  });
});

describe('the tables', () => {
  const files = [file('low', { score: 10 }), file('binary', { score: null, lines: null, added: null, removed: null }), file('top', { score: 9000 }), file('mid', { score: 500 })];

  function firstColumnTexts(table) {
    const rows = byTag(table.el, 'tbody')[0].children;
    return rows.map((tr) => textOf(tr.children[0]));
  }

  const filesTable = (rows) => XV.dataTable({
    rows,
    initialSort: { label: 'Score', dir: -1 },
    columns: [
      { label: 'Path', key: (r) => r.path, render: (r) => r.path },
      { label: 'Score', num: true, key: (r) => r.score, render: (r) => hotspots.scoreCell(r.score, hotspots.maxScore(rows)) },
    ],
  });

  it('puts the highest score first by default and a null score last', () => {
    expect(firstColumnTexts(filesTable(files))).toEqual(['top', 'mid', 'low', 'binary']);
  });

  it('keeps a null score last when the order is reversed', () => {
    const table = filesTable(files);
    const sortButton = byTag(table.el, 'button')[1];
    sortButton.listeners.click();
    expect(firstColumnTexts(table)).toEqual(['low', 'mid', 'top', 'binary']);
  });

  it('draws the score of a row beside a bar as wide as its share of the highest', () => {
    const cell = hotspots.scoreCell(4500, 9000);
    const fill = all(cell).find((n) => n.attributes && n.attributes.class === 'xv-bar-fill');
    expect(fill.style.width).toBe('50%');
    expect(textOf(cell)).toBe('4,500');
    expect(hotspots.scoreCell(null, 9000)).toBeNull();
    expect(hotspots.scoreCell(undefined, 9000)).toBe('not provided by the product');
  });

  it('shows not provided for the by-year and share columns of an older product, and empty for a product with no history', () => {
    const columns = hotspots.statColumns(100);
    const label = (name) => columns.find((c) => c.label === name);
    const old = { path: 'd', files: 1, commits: 1 };
    expect(label('Commits by year').render(old)).toBe('not provided by the product');
    expect(label('Top author share').render(old)).toBe('not provided by the product');
    expect(label('Commits by people').render(old)).toBe('not provided by the product');
    expect(label('Authors for 80%').render(old)).toBe('not provided by the product');
    const none = { path: 'd', commitsByYear: null, concentration: null };
    expect(label('Commits by year').render(none)).toBeNull();
    expect(label('Top author share').render(none)).toBeNull();
    const noPeople = { concentration: { commitsByPeople: 0, topAuthorShare: null, authorsFor80Percent: null } };
    expect(label('Commits by people').render(noPeople)).toBe('0');
    expect(label('Top author share').render(noPeople)).toBeNull();
    expect(label('Top author share').render({ concentration: { topAuthorShare: 0.33 } })).toBe('0.33');
  });

  it('sorts a directory by the commits of its latest year', () => {
    const column = hotspots.statColumns(1).find((c) => c.label === 'Commits by year');
    expect(column.key({ commitsByYear: { 2020: 5, 2021: 9 } })).toBe(9);
    expect(column.key({ commitsByYear: {} })).toBeNull();
    expect(column.key({})).toBeNull();
  });
});

describe('the tables of the page', () => {
  const tables = hotspots.tables;
  const labels = (name) => tables[name].columns(100).map((c) => c.label);

  it('starts each table sorted by the intended column, named by label', () => {
    expect(plain(tables.files.initialSort)).toEqual({ label: 'Score', dir: -1 });
    expect(plain(tables.directories.initialSort)).toEqual({ label: 'Score', dir: -1 });
    expect(plain(tables.pairs.initialSort)).toEqual({ label: 'Together', dir: -1 });
    expect(plain(tables.groups.initialSort)).toEqual({ label: 'Score', dir: -1 });
    for (const name of Object.keys(tables)) expect(labels(name), name).toContain(tables[name].initialSort.label);
  });

  it('sorts a directory table by score when it is built the way the page builds it', () => {
    const rows = [
      { path: 'low', score: 5, commits: 900, commitsByYear: { 2020: 1, 2021: 2 } },
      { path: 'top', score: 800, commits: 1, commitsByYear: { 2020: 9, 2021: 0 } },
      { path: 'none', score: null, commits: 7, commitsByYear: null },
    ];
    const table = XV.dataTable({ rows, columns: tables.directories.columns(800), initialSort: tables.directories.initialSort });
    const bodyRows = byTag(table.el, 'tbody')[0].children;
    expect(bodyRows.map((tr) => textOf(tr.children[0]))).toEqual(['top', 'low', 'none']);
  });

  it('sorts a pair table by the number of times the files changed together', () => {
    const rows = [{ a: 'x', b: 'y', together: 3 }, { a: 'p', b: 'q', together: 90 }, { a: 'm', b: 'n', together: 12 }];
    const table = XV.dataTable({ rows, columns: tables.pairs.columns(), initialSort: tables.pairs.initialSort });
    expect(byTag(table.el, 'tbody')[0].children.map((tr) => textOf(tr.children[0]))).toEqual(['90', '12', '3']);
  });

  it('puts the columns that are read first before the long ones', () => {
    expect(labels('directories').slice(0, 11)).toEqual(['Directory', 'Score', 'Commits', 'Authors', 'Commits by year', 'Files', 'Lines', 'Added', 'Removed', 'Last changed', 'Commits by people']);
    expect(labels('groups').slice(0, 11)).toEqual(['Group', 'Score', 'Commits', 'Authors', 'Commits by year', 'Files', 'Lines', 'Added', 'Removed', 'Last changed', 'Commits by people']);
    expect(labels('pairs')).toEqual(['Together', 'Share of A', 'Share of B', 'File A', 'File B']);
  });

  it('refuses an initial sort that names no column', () => {
    expect(() => XV.dataTable({ rows: [], columns: [{ label: 'A', key: () => 1, render: () => 'a' }], initialSort: { label: 'Nope', dir: 1 } })).toThrow(/names no column/);
  });
});
