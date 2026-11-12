import { describe, expect, it } from 'vitest';

import { compareKeys, footerText, initialSortState, nextSort, pageBounds, PAGE_SIZE, sortRows, tableView } from '../table';

// A small seeded generator, so a failing case can be replayed.
function random(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('sortRows', () => {
  const rows = [{ n: 'b', v: 2 }, { n: 'a', v: 10 }, { n: 'c', v: null }, { n: 'd', v: 2 }, { n: 'e', v: 1 }];

  it('sorts numbers by value, not as text', () => {
    expect(sortRows(rows, (r) => r.v, 1).map((r) => r.n)).toEqual(['e', 'b', 'd', 'a', 'c']);
    expect(sortRows(rows, (r) => r.v, -1).map((r) => r.n)).toEqual(['a', 'b', 'd', 'e', 'c']);
  });

  it('puts rows without a key last in both directions and keeps equal keys in their order', () => {
    const none = [{ k: null, i: 0 }, { k: 'x', i: 1 }, { k: undefined, i: 2 }, { k: 'x', i: 3 }];
    expect(sortRows(none, (r) => r.k, 1).map((r) => r.i)).toEqual([1, 3, 0, 2]);
    expect(sortRows(none, (r) => r.k, -1).map((r) => r.i)).toEqual([1, 3, 0, 2]);
  });

  it('sorts text by code unit and leaves the input alone', () => {
    const input = [{ s: 'b' }, { s: 'B' }, { s: 'a' }];
    const copy = JSON.parse(JSON.stringify(input));
    expect(sortRows(input, (r) => r.s, 1).map((r) => r.s)).toEqual(['B', 'a', 'b']);
    expect(input).toEqual(copy);
  });

  it('puts numbers before text when a column mixes them', () => {
    expect(sortRows<{ k: string | number }>([{ k: 'x' }, { k: 3 }, { k: 'a' }, { k: 1 }], (r) => r.k, 1).map((r) => r.k)).toEqual([1, 3, 'a', 'x']);
    expect(compareKeys(1, 'a')).toBeLessThan(0);
  });

  it('keeps every row exactly once, over random rows', () => {
    const next = random(7);
    for (let round = 0; round < 50; round++) {
      const input = Array.from({ length: Math.floor(next() * 60) }, (_, i) => ({ i, k: next() < 0.2 ? null : Math.floor(next() * 5) }));
      for (const dir of [1, -1] as const) {
        const out = sortRows(input, (r) => r.k, dir);
        expect(out.map((r) => r.i).sort((a, b) => a - b)).toEqual(input.map((r) => r.i));
        const keys = out.map((r) => r.k).filter((k): k is number => k !== null);
        expect(keys).toEqual([...keys].sort((a, b) => (a - b) * dir));
      }
    }
  });
});

describe('pageBounds and footerText', () => {
  it('describes the first, a middle and the last page', () => {
    expect(pageBounds(450, 1, 200)).toEqual({ page: 1, pages: 3, from: 1, to: 200, total: 450 });
    expect(pageBounds(450, 2, 200)).toEqual({ page: 2, pages: 3, from: 201, to: 400, total: 450 });
    expect(pageBounds(450, 3, 200)).toEqual({ page: 3, pages: 3, from: 401, to: 450, total: 450 });
  });

  it('fills a page exactly without starting an empty one', () => {
    expect(pageBounds(400, 2, 200)).toEqual({ page: 2, pages: 2, from: 201, to: 400, total: 400 });
    expect(pageBounds(200, 1, 200)).toMatchObject({ pages: 1, from: 1, to: 200 });
    expect(pageBounds(201, 2, 200)).toMatchObject({ pages: 2, from: 201, to: 201 });
  });

  it('clamps a page that is out of range, and has no rows to show when there are none', () => {
    expect(pageBounds(450, 99, 200).page).toBe(3);
    expect(pageBounds(450, 0, 200).page).toBe(1);
    expect(pageBounds(450, -4, 200).page).toBe(1);
    expect(pageBounds(450, NaN, 200).page).toBe(1);
    expect(pageBounds(0, 5, 200)).toEqual({ page: 1, pages: 1, from: 0, to: 0, total: 0 });
  });

  it('writes the footer with an en dash and grouped digits', () => {
    const dash = String.fromCharCode(0x2013);
    expect(footerText(pageBounds(5019, 1, 200))).toBe(`Rows 1${dash}200 of 5,019`);
    expect(footerText(pageBounds(5019, 26, 200))).toBe(`Rows 5,001${dash}5,019 of 5,019`);
    expect(footerText(pageBounds(0, 1, 200))).toBe('No rows');
  });

  it('covers every row exactly once across the pages, over random sizes', () => {
    const next = random(11);
    for (let round = 0; round < 200; round++) {
      const total = Math.floor(next() * 1000);
      const size = 1 + Math.floor(next() * 250);
      const first = pageBounds(total, 1, size);
      let covered = 0;
      let last = 0;
      for (let page = 1; page <= first.pages; page++) {
        const b = pageBounds(total, page, size);
        if (total > 0) {
          expect(b.from).toBe(last + 1);
          expect(b.to - b.from + 1).toBeLessThanOrEqual(size);
          covered += b.to - b.from + 1;
          last = b.to;
        }
      }
      expect(covered).toBe(total);
    }
  });
});

describe('the table state (design D6: sort, paginate 200 a page, initial sort by column)', () => {
  const labels = ['Path', 'Score'];

  it('pages 200 rows at a time', () => {
    expect(PAGE_SIZE).toBe(200);
    const rows = Array.from({ length: 450 }, (_, i) => ({ i }));
    const sort = initialSortState(labels);
    const pages = [1, 2, 3].map((page) => tableView(rows, null, sort, page).shown.length);
    expect(pages).toEqual([200, 200, 50]);
    expect(tableView(rows, null, sort, 3).shown[0]).toEqual({ i: 400 });
  });

  it('starts sorted by the column of the label it is given, in the direction given', () => {
    expect(initialSortState(labels, { label: 'Score', dir: -1 })).toEqual({ column: 1, dir: -1 });
    expect(initialSortState(labels)).toEqual({ column: -1, dir: 1 });
    expect(initialSortState(labels, null)).toEqual({ column: -1, dir: 1 });
    const rows = [{ s: 5 }, { s: 900 }, { s: null }, { s: 40 }];
    const view = tableView(rows, (r) => r.s, initialSortState(labels, { label: 'Score', dir: -1 }), 1);
    expect(view.shown.map((r) => r.s)).toEqual([900, 40, 5, null]);
  });

  it('refuses an initial sort that names no column', () => {
    expect(() => initialSortState(labels, { label: 'Nope', dir: 1 })).toThrow(/names no column/);
  });

  it('flips the direction on the same column and starts a new column ascending', () => {
    expect(nextSort({ column: 1, dir: 1 }, 1)).toEqual({ column: 1, dir: -1 });
    expect(nextSort({ column: 1, dir: -1 }, 1)).toEqual({ column: 1, dir: 1 });
    expect(nextSort({ column: 1, dir: -1 }, 0)).toEqual({ column: 0, dir: 1 });
    expect(nextSort({ column: -1, dir: 1 }, 0)).toEqual({ column: 0, dir: 1 });
  });

  it('sorts every row before it pages, so the order holds across pages', () => {
    const rows = Array.from({ length: 450 }, (_, i) => ({ v: (i * 7919) % 450 }));
    const sort = { column: 0, dir: -1 as const };
    const all = [1, 2, 3].flatMap((page) => tableView(rows, (r) => r.v, sort, page).shown.map((r) => r.v));
    expect(all).toEqual(rows.map((r) => r.v).sort((a, b) => b - a));
  });
});
