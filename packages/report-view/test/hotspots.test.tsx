import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { scoreCell } from '../src/components/ScoreCell';
import { sparkline } from '../src/components/Sparkline';
import { NOT_PROVIDED } from '../src/lib/format';
import {
  coChangeText, conservationText, dateText, filterRows, maxScore, notices, numberField, plainField, scoreShare, sparkBars, timeKey, windowText, yearSeries, yearText,
} from '../src/lib/hotspots';
import { initialSortState, tableView } from '../src/lib/table';
import { statColumns, TABLES, type Row } from '../src/pages/hotspots-tables';

const file = (path: string, over: Record<string, unknown> = {}) => ({ path, commits: 3, authors: 1, added: 10, removed: 2, lastChanged: '2026-01-02T03:04:05+00:00', lines: 100, score: 300, lineageConflicts: 0, ...over });
const cell = (node: unknown) => renderToStaticMarkup(<>{node as never}</>);

describe('windowText', () => {
  it('says whole history or the window the product records', () => {
    expect(windowText({ since: null, sinceUtc: null })).toBe('whole history');
    expect(windowText(undefined)).toBe('whole history');
    expect(windowText({ since: '2025-01-01', sinceUtc: '2025-01-01T00:00:00Z' })).toBe('since 2025-01-01 (2025-01-01T00:00:00Z)');
    expect(windowText({ since: '2025-01-01' })).toBe('since 2025-01-01');
  });
});

describe('fields a product may lack', () => {
  it('says a field is not provided when it is absent, shows empty for null, and keeps 0 as 0', () => {
    expect(numberField(undefined)).toBe('not provided by the product');
    expect(numberField(null)).toBeNull();
    expect(numberField(0)).toBe('0');
    expect(numberField(1234567)).toBe('1,234,567');
    expect(plainField(undefined)).toBe(NOT_PROVIDED);
    expect(plainField(0.33)).toBe('0.33');
    expect(dateText(undefined)).toBe(NOT_PROVIDED);
    expect(dateText(null)).toBeNull();
    expect(dateText('2026-09-02T14:19:41+08:00')).toBe('2026-09-02');
  });

  it('orders times by the instant, not by the text', () => {
    expect(timeKey('2026-01-01T00:00:00+08:00') as number).toBeLessThan(timeKey('2026-01-01T00:00:00+00:00') as number);
    expect(timeKey(null)).toBeNull();
    expect(timeKey('not a time')).toBeNull();
  });
});

describe('score', () => {
  it('finds the highest score and each score as a share of it', () => {
    const rows = [file('a', { score: 50 }), file('b', { score: 200 }), file('c', { score: null })];
    expect(maxScore(rows)).toBe(200);
    expect(scoreShare(50, 200)).toBe(25);
    expect(scoreShare(200, 200)).toBe(100);
    expect(scoreShare(null, 200)).toBeNull();
    expect(scoreShare(5, null)).toBeNull();
    expect(maxScore([file('x', { score: null })])).toBeNull();
    expect(maxScore([])).toBeNull();
  });

  it('draws the score of a row beside a bar as wide as its share of the highest', () => {
    const out = cell(scoreCell(4500, 9000));
    expect(out).toContain('width:50%');
    expect(out).toContain('>4,500<');
    expect(scoreCell(null, 9000)).toBeNull();
    expect(scoreCell(undefined, 9000)).toBe(NOT_PROVIDED);
  });
});

describe('the sparkline', () => {
  const byYear = { 2022: 118, 2020: 0, 2021: 0, 2023: 457 };

  it('orders years numerically and keeps their values', () => {
    expect(yearSeries(byYear)).toEqual([{ year: '2020', commits: 0 }, { year: '2021', commits: 0 }, { year: '2022', commits: 118 }, { year: '2023', commits: 457 }]);
    expect(yearText(yearSeries(byYear) as never)).toBe('2020: 0, 2021: 0, 2022: 118, 2023: 457');
    expect(yearSeries(undefined)).toBeNull();
    expect(yearSeries(null)).toBeNull();
  });

  it('makes one bar per year, the highest as tall as the box, a year of 0 with no height', () => {
    const bars = sparkBars(yearSeries(byYear) as never, 84, 24, 1);
    expect(bars).toHaveLength(4);
    expect(bars.map((b) => b.height)).toEqual([0, 0, (118 / 457) * 24, 24]);
    expect(bars[3].y).toBe(0);
    expect(bars[0].y).toBe(24);
    expect(bars.map((b) => b.title)).toEqual(['2020: 0 commits', '2021: 0 commits', '2022: 118 commits', '2023: 457 commits']);
    expect(bars[1].x).toBeCloseTo(bars[0].x + bars[0].width + 1);
    expect(bars[3].x + bars[3].width).toBeCloseTo(84);
  });

  it('has no bar height when every year is 0, and no bars for no years', () => {
    expect(sparkBars([{ year: '2020', commits: 0 }], 84, 24, 1)[0].height).toBe(0);
    expect(sparkBars([], 84, 24, 1)).toEqual([]);
  });

  it('builds an svg with one rect per year and the exact numbers in titles', () => {
    const out = cell(sparkline(byYear));
    expect(out.startsWith('<svg')).toBe(true);
    expect(out.match(/<rect /g)).toHaveLength(4);
    expect(out.match(/<title>[^<]*<\/title>/g)).toEqual(['2020: 0 commits', '2021: 0 commits', '2022: 118 commits', '2023: 457 commits'].map((t) => `<title>${t}</title>`));
    expect(out).toContain('aria-label="Commits by year: 2020: 0, 2021: 0, 2022: 118, 2023: 457"');
  });

  it('says a product without commitsByYear does not provide it, and shows empty for null', () => {
    expect(sparkline(undefined)).toBe('not provided by the product');
    expect(sparkline(null)).toBeNull();
  });
});

describe('notices', () => {
  const base = { historyAvailable: true, noHistory: null, repos: [], counts: {} };

  it('has none for a product with history', () => {
    expect(notices(base)).toEqual([]);
  });

  it('says there is no history and why', () => {
    const [text] = notices({ ...base, historyAvailable: false, noHistory: { reason: 'not-a-repository', repositoryRoot: null, pathInRepository: null } });
    expect(text).toContain('There is no history to count.');
    expect(text).toContain('Reason: not-a-repository');
    const [inside] = notices({ ...base, historyAvailable: false, noHistory: { reason: 'inside-repository', repositoryRoot: '../..', pathInRepository: 'apps/web' } });
    expect(inside).toContain('inside-repository');
    expect(inside).toContain('"apps/web"');
    expect(inside).toContain('"../.."');
    expect(inside).not.toContain('not a Git repository');
    expect(notices({ ...base, historyAvailable: false })[0]).toContain('records no reason');
  });

  it('says a shallow clone gives lower bounds, with its boundary and earliest commit', () => {
    const list = notices({ ...base, repos: [{ path: 'svc', shallow: true, boundaryCommits: 2, earliestVisibleCommit: '2025-03-01T00:00:00Z' }, { path: 'ok', shallow: false }] });
    expect(list).toHaveLength(1);
    expect(list[0]).toBe('svc is a shallow clone: its counts are lower bounds. 2 boundary commit(s) are not counted, and nothing before 2025-03-01T00:00:00Z is visible.');
  });

  it('says files outside every repository have no history', () => {
    expect(notices({ ...base, counts: { filesWithoutHistory: 3 } })[0]).toContain('3 file(s)');
    expect(notices({ ...base, counts: { filesWithoutHistory: 0 } })).toEqual([]);
  });
});

describe('statements of the product', () => {
  it('writes the conservation line and whether it holds', () => {
    expect(conservationText({ changesRead: 100, attributed: 60, outsideSelection: 40 })).toBe('changes read (100) = attributed to selected files (60) + outside the selection (40): holds');
    expect(conservationText({ changesRead: 100, attributed: 60, outsideSelection: 41 })).toContain('does not hold');
    expect(conservationText(undefined)).toBeNull();
  });

  it("writes the pair rule in the product's own numbers", () => {
    expect(coChangeText({ maxFilesPerCommit: 30, minTogether: 3 })).toBe(
      'A pair counts the commits that changed both files. Commits that changed 2 to 30 selected files are counted; a pair is listed when its files changed together at least 3 times.',
    );
    expect(coChangeText(null)).toBeNull();
  });
});

describe('filterRows', () => {
  const rows = [file('src/A.go'), file('docs/b.md'), file('src/c.go')];
  it('keeps the paths that contain the text, ignoring case, and every row for an empty query', () => {
    expect(filterRows(rows, 'SRC/', [(r) => r.path]).map((r) => r.path)).toEqual(['src/A.go', 'src/c.go']);
    expect(filterRows(rows, '  ', [(r) => r.path])).toBe(rows);
    expect(filterRows(rows, 'zzz', [(r) => r.path])).toEqual([]);
  });

  it('looks in every field it is given', () => {
    const pairs = [{ a: 'x/1', b: 'y/2' }, { a: 'z/3', b: 'x/4' }, { a: 'q', b: 'r' }];
    expect(filterRows(pairs, 'x/', [(r) => r.a, (r) => r.b])).toHaveLength(2);
  });
});

describe('the tables of the page', () => {
  const labels = (name: keyof typeof TABLES) => TABLES[name].columns(100).map((c) => c.label);
  /** The first column's text of each row the table shows when built the way the page builds it. */
  function firstColumn(name: keyof typeof TABLES, rows: Row[], max: number | null = 800) {
    const columns = TABLES[name].columns(max);
    const sort = initialSortState(columns.map((c) => c.label), TABLES[name].initialSort);
    const key = columns[sort.column].key;
    return tableView(rows, key, sort, 1).shown.map((row) => cell(columns[0].render(row)).replace(/<[^>]*>/g, ''));
  }

  it('starts each table sorted by the intended column, named by label', () => {
    expect(TABLES.files.initialSort).toEqual({ label: 'Score', dir: -1 });
    expect(TABLES.directories.initialSort).toEqual({ label: 'Score', dir: -1 });
    expect(TABLES.pairs.initialSort).toEqual({ label: 'Together', dir: -1 });
    expect(TABLES.groups.initialSort).toEqual({ label: 'Score', dir: -1 });
    for (const name of Object.keys(TABLES) as (keyof typeof TABLES)[]) expect(labels(name), name).toContain(TABLES[name].initialSort.label);
  });

  it('puts the highest score first by default and a null score last', () => {
    const files = [file('low', { score: 10 }), file('binary', { score: null, lines: null, added: null, removed: null }), file('top', { score: 9000 }), file('mid', { score: 500 })];
    expect(firstColumn('files', files, 9000)).toEqual(['top', 'mid', 'low', 'binary']);
  });

  it('sorts a directory table by score when it is built the way the page builds it', () => {
    const rows = [
      { path: 'low', score: 5, commits: 900, commitsByYear: { 2020: 1, 2021: 2 } },
      { path: 'top', score: 800, commits: 1, commitsByYear: { 2020: 9, 2021: 0 } },
      { path: 'none', score: null, commits: 7, commitsByYear: null },
    ];
    expect(firstColumn('directories', rows)).toEqual(['top', 'low', 'none']);
  });

  it('sorts a pair table by the number of times the files changed together', () => {
    const rows = [{ a: 'x', b: 'y', together: 3 }, { a: 'p', b: 'q', together: 90 }, { a: 'm', b: 'n', together: 12 }];
    expect(firstColumn('pairs', rows, null)).toEqual(['90', '12', '3']);
  });

  it('puts the columns that are read first before the long ones', () => {
    expect(labels('directories').slice(0, 11)).toEqual(['Directory', 'Score', 'Commits', 'Authors', 'Commits by year', 'Files', 'Lines', 'Added', 'Removed', 'Last changed', 'Commits by people']);
    expect(labels('groups').slice(0, 11)).toEqual(['Group', 'Score', 'Commits', 'Authors', 'Commits by year', 'Files', 'Lines', 'Added', 'Removed', 'Last changed', 'Commits by people']);
    expect(labels('pairs')).toEqual(['Together', 'Share of A', 'Share of B', 'File A', 'Graph A', 'File B', 'Graph B']);
  });

  it('shows not provided for the by-year and share columns of an older product, and empty for a product with no history', () => {
    const columns = statColumns(100);
    const column = (name: string) => columns.find((c) => c.label === name)!;
    const old = { path: 'd', files: 1, commits: 1 };
    expect(column('Commits by year').render(old)).toBe('not provided by the product');
    expect(column('Top author share').render(old)).toBe('not provided by the product');
    expect(column('Commits by people').render(old)).toBe('not provided by the product');
    expect(column('Authors for 80%').render(old)).toBe('not provided by the product');
    const none = { path: 'd', commitsByYear: null, concentration: null };
    expect(column('Commits by year').render(none)).toBeNull();
    expect(column('Top author share').render(none)).toBeNull();
    const noPeople = { concentration: { commitsByPeople: 0, topAuthorShare: null, authorsFor80Percent: null } };
    expect(column('Commits by people').render(noPeople)).toBe('0');
    expect(column('Top author share').render(noPeople)).toBeNull();
    expect(column('Top author share').render({ concentration: { topAuthorShare: 0.33 } })).toBe('0.33');
  });

  it('sorts a directory by the commits of its latest year', () => {
    const column = statColumns(1).find((c) => c.label === 'Commits by year')!;
    expect(column.key({ commitsByYear: { 2020: 5, 2021: 9 } })).toBe(9);
    expect(column.key({ commitsByYear: {} })).toBeNull();
    expect(column.key({})).toBeNull();
  });
});
