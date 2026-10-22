import { describe, expect, it } from 'vitest';

import { detailParams, filterByPrefix, normalizePrefix, pageOfRow, underPrefix, withParams } from '../src/lib/detail-rows';
import { parseRoute } from '../src/lib/route';
import type { SortState } from '../src/lib/table';

const plain = (value: unknown) => JSON.parse(JSON.stringify(value));

describe('row and prefix links', () => {
  it.each([
    ['unused', { row: 'function:src/a b.js:run', prefix: 'src/a b' }],
    ['hotspots', { view: 'files', row: 'src/util/x&y=z.js' }],
    ['doc-map', { row: '12' }],
    ['unused', { prefix: 'src' }],
  ] as [string, Record<string, string>][])('round-trips the parameters of %s through the address', (page, params) => {
    const hash = withParams(parseRoute(`#/${page}`), params);
    const route = parseRoute(hash);
    expect(route.page).toBe(page);
    expect(plain(route.params)).toEqual(params);
    expect(detailParams(route.params)).toEqual({ row: params.row ?? null, prefix: params.prefix ?? null });
  });

  it('keeps the other parameters of the route and drops a parameter set to null', () => {
    const route = parseRoute('#/hotspots?view=files&row=a.js&prefix=src');
    expect(plain(parseRoute(withParams(route, { row: null })).params)).toEqual({ view: 'files', prefix: 'src' });
    expect(plain(parseRoute(withParams(route, { view: 'pairs', row: null })).params)).toEqual({ view: 'pairs', prefix: 'src' });
  });

  it('reads an empty row or prefix as none', () => {
    expect(detailParams(parseRoute('#/unused?row=&prefix=').params)).toEqual({ row: null, prefix: null });
  });
});

describe('the prefix filter', () => {
  const rows = ['src/a.js', 'src/core/b.js', 'srcx/c.js', 'lib/d.py', 'src'].map((path) => ({ path }));

  it('keeps the paths under the prefix, and the prefix itself, but not a sibling that only starts with the same letters', () => {
    expect(filterByPrefix(rows, (r) => r.path, 'src').map((r) => r.path)).toEqual(['src/a.js', 'src/core/b.js', 'src']);
    expect(filterByPrefix(rows, (r) => r.path, 'src/').map((r) => r.path)).toEqual(['src/a.js', 'src/core/b.js', 'src']);
    expect(filterByPrefix(rows, (r) => r.path, 'src/core').map((r) => r.path)).toEqual(['src/core/b.js']);
  });

  it('counts the rows an independent count over the paths finds', () => {
    const paths = ['a/x', 'a/y/z', 'ab/x', 'b/a/x', 'a'];
    const independent = paths.filter((p) => p.split('/')[0] === 'a').length;
    expect(filterByPrefix(paths.map((path) => ({ path })), (r) => r.path, 'a')).toHaveLength(independent);
  });

  it('keeps every row when there is no prefix, or when the prefix is the project root', () => {
    for (const prefix of [null, '', '.', './', '/']) expect(filterByPrefix(rows, (r) => r.path, prefix)).toHaveLength(rows.length);
    expect(normalizePrefix('./src/')).toBe('src');
    expect(normalizePrefix('.')).toBeNull();
  });

  it('leaves out a row without a path when there is a prefix', () => {
    expect(filterByPrefix([{ path: null }, { path: 'src/a.js' }], (r) => r.path, 'src')).toEqual([{ path: 'src/a.js' }]);
    expect(underPrefix(null, null)).toBe(true);
    expect(underPrefix(null, 'src')).toBe(false);
  });
});

describe('the page of a row', () => {
  const rows = Array.from({ length: 45 }, (_, i) => ({ id: `r${i}`, score: (i * 7) % 45 }));
  const byScore = (r: { score: number }) => r.score;

  it('is the page the row sits on in the order the rows came in', () => {
    const none: SortState = { column: -1, dir: 1 };
    expect(pageOfRow(rows, null, none, (r) => r.id === 'r0', 10)).toEqual({ page: 1, index: 0 });
    expect(pageOfRow(rows, null, none, (r) => r.id === 'r44', 10)).toEqual({ page: 5, index: 44 });
  });

  it('is the page the row sits on under the current sort', () => {
    const descending: SortState = { column: 1, dir: -1 };
    // r0 has score 0: last when the highest come first.
    expect(pageOfRow(rows, byScore, descending, (r) => r.id === 'r0', 10)).toEqual({ page: 5, index: 44 });
    const ascending: SortState = { column: 1, dir: 1 };
    expect(pageOfRow(rows, byScore, ascending, (r) => r.id === 'r0', 10)).toEqual({ page: 1, index: 0 });
    const top = [...rows].sort((a, b) => b.score - a.score)[13];
    expect(pageOfRow(rows, byScore, descending, (r) => r.id === top.id, 10)).toEqual({ page: 2, index: 13 });
  });

  it('is null for a row that is not among the rows', () => {
    expect(pageOfRow(rows, null, { column: -1, dir: 1 }, (r) => r.id === 'missing', 10)).toBeNull();
  });
});
