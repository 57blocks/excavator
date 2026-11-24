import { describe, expect, it } from 'vitest';

import { coChanged, topFiles } from '../hotspots-charts';

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

