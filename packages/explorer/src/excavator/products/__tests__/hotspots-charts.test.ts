import { describe, expect, it } from 'vitest';

import { coChanged, projectYears, scoreHistogram, topFiles } from '../hotspots-charts';

describe('commits per year of the project', () => {
  it('takes the per-year counts of the project root row, in year order, and sums them to its commits', () => {
    const product = {
      directories: [
        { path: 'src', commits: 13, commitsByYear: { 2025: 6, 2026: 7 } },
        { path: '.', commits: 15, commitsByYear: { 2026: 8, 2024: 1, 2025: 6 } },
      ],
    };
    const years = projectYears(product);
    expect(years).toEqual({ state: 'provided', points: [{ label: '2024', value: 1 }, { label: '2025', value: 6 }, { label: '2026', value: 8 }], total: 15 });
  });

  it('does not add up the directories: a commit that changed two of them would count twice', () => {
    const product = { directories: [{ path: 'a', commitsByYear: { 2025: 1 } }, { path: 'b', commitsByYear: { 2025: 1 } }, { path: '.', commitsByYear: { 2025: 1 } }] };
    expect(projectYears(product)).toMatchObject({ total: 1 });
  });

  it('says the product does not provide them when there is no root row or the root row has no per-year field, never 0', () => {
    expect(projectYears({ directories: [{ path: 'src', commitsByYear: { 2025: 6 } }] })).toEqual({ state: 'not-provided' });
    expect(projectYears({ directories: [{ path: '.', commits: 4 }] })).toEqual({ state: 'not-provided' });
    expect(projectYears({})).toEqual({ state: 'not-provided' });
    expect(projectYears({ directories: [{ path: '.', commitsByYear: { 2025: 'x' } }] })).toEqual({ state: 'not-provided' });
  });

  it('says there is no history when the product writes null for it', () => {
    expect(projectYears({ directories: [{ path: '.', commitsByYear: null }] })).toEqual({ state: 'no-history' });
  });
});

describe('the files most often changed together with a file', () => {
  const pairs = [
    { a: 'x.js', b: 'y.js', together: 4 },
    { a: 'z.js', b: 'x.js', together: 9 },
    { a: 'x.js', b: 'w.js', together: 4 },
    { a: 'y.js', b: 'z.js', together: 20 },
    { a: 'x.js', b: 'v.js', together: 2 },
    { a: 'x.js', b: 'u.js' },
  ];

  it('lists the other file of each pair, most shared commits first, ties by path', () => {
    expect(coChanged(pairs, 'x.js', 10)).toEqual([{ path: 'z.js', together: 9 }, { path: 'w.js', together: 4 }, { path: 'y.js', together: 4 }, { path: 'v.js', together: 2 }]);
  });

  it('keeps the top n', () => {
    expect(coChanged(pairs, 'x.js', 2).map((p) => p.path)).toEqual(['z.js', 'w.js']);
  });

  it('lists nothing for a file in no pair', () => {
    expect(coChanged(pairs, 'q.js', 3)).toEqual([]);
    expect(coChanged(undefined, 'x.js', 3)).toEqual([]);
  });
});

describe('the files with the highest scores', () => {
  it('lists them by score, highest first, ties by path, leaving out a file without a score', () => {
    const files = [{ path: 'b', score: 5 }, { path: 'a', score: 5 }, { path: 'c', score: null }, { path: 'd', score: 90 }, { path: 'e', score: 1 }];
    expect(topFiles(files, 3)).toEqual([{ path: 'd', score: 90 }, { path: 'a', score: 5 }, { path: 'b', score: 5 }]);
  });
});

describe('the distribution of file scores', () => {
  it('bins the scores from 0 to the highest and counts the files without a score apart', () => {
    const hist = scoreHistogram([{ score: 90 }, { score: 40 }, { score: 5 }, { score: 3 }, { score: null }, {}]);
    expect(hist.state).toBe('bins');
    if (hist.state !== 'bins') return;
    expect(hist.values).toEqual([90, 40, 5, 3]);
    expect(hist.edges[0]).toBe(0);
    expect(hist.edges[hist.edges.length - 1]).toBe(90);
    expect(hist.withoutScore).toBe(2);
  });

  it('has no bins when no file has a score above 0', () => {
    expect(scoreHistogram([{ score: 0 }, { score: null }])).toEqual({ state: 'none', withoutScore: 1, scored: 1 });
    expect(scoreHistogram([])).toEqual({ state: 'none', withoutScore: 0, scored: 0 });
  });
});
