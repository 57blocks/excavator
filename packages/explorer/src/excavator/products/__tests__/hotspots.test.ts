import { describe, expect, it } from 'vitest';

import { NOT_PROVIDED } from '../format';
import {
  coChangeText, conservationText, dateText, filterRows, maxScore, notices, numberField, plainField, scoreShare, sparkBars, timeKey, windowText, yearSeries, yearText,
} from '../hotspots';

// The pure parts of the report view's hotspots test; the parts that render report-view components are not copied.
const file = (path: string, over: Record<string, unknown> = {}) => ({ path, commits: 3, authors: 1, added: 10, removed: 2, lastChanged: '2026-01-02T03:04:05+00:00', lines: 100, score: 300, lineageConflicts: 0, ...over });

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
