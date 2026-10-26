/**
 * The sorting and paging of the tables (openspec: changes/viewer-app, design
 * D6; ported from the report-viewer table): pure functions, so the component
 * only draws what `tableView` returns. A table sorts by any column and pages
 * 200 rows at a time.
 */

import { EN_DASH, formatNumber } from './format';

export const PAGE_SIZE = 200;

/** What a column sorts by: a number, text, or nothing (a row without a key comes last in both directions). */
export type SortKey = number | string | null | undefined;

const typeRank = (value: SortKey) => (typeof value === 'number' ? 0 : 1);

/** Order two sort keys: numbers by value, text by code unit, numbers before text. */
export function compareKeys(a: number | string, b: number | string): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeRank(a) !== typeRank(b)) return typeRank(a) - typeRank(b);
  const x = String(a);
  const y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * A sorted copy of `rows` by `keyOf(row)`; `dir` is 1 (ascending) or -1. A row whose key is null or
 * undefined comes last in both directions; equal keys keep the order the rows came in.
 */
export function sortRows<T>(rows: readonly T[], keyOf: (row: T) => SortKey, dir: 1 | -1): T[] {
  const indexed = rows.map((row, index) => ({ row, index, key: keyOf(row) }));
  indexed.sort((a, b) => {
    const aNone = a.key === null || a.key === undefined;
    const bNone = b.key === null || b.key === undefined;
    if (aNone || bNone) return aNone === bNone ? a.index - b.index : aNone ? 1 : -1;
    return compareKeys(a.key as number | string, b.key as number | string) * dir || a.index - b.index;
  });
  return indexed.map((item) => item.row);
}

export interface PageBounds {
  page: number;
  pages: number;
  /** 1-based and inclusive; both 0 when there are no rows. */
  from: number;
  to: number;
  total: number;
}

/** Which rows page `page` (1-based) shows out of `total`: the page is clamped into range. */
export function pageBounds(total: number, page: number, size: number): PageBounds {
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  if (total === 0) return { page: 1, pages: 1, from: 0, to: 0, total: 0 };
  return { page: current, pages, from: (current - 1) * size + 1, to: Math.min(total, current * size), total };
}

export function footerText(bounds: PageBounds): string {
  if (bounds.total === 0) return 'No rows';
  return `Rows ${formatNumber(bounds.from)}${EN_DASH}${formatNumber(bounds.to)} of ${formatNumber(bounds.total)}`;
}

export interface SortState {
  /** Index into the columns, or -1 for the order the rows came in. */
  column: number;
  dir: 1 | -1;
}

/** The sort a table starts with: the column whose label is named, or none. Throws when no column has that label. */
export function initialSortState(labels: readonly string[], initial?: { label: string; dir: 1 | -1 } | null): SortState {
  if (!initial) return { column: -1, dir: 1 };
  const column = labels.indexOf(initial.label);
  if (column < 0) throw new Error(`initialSort names no column: ${initial.label}`);
  return { column, dir: initial.dir };
}

/** Clicking a column header: the same column flips direction, another starts ascending. */
export function nextSort(state: SortState, column: number): SortState {
  return state.column === column ? { column, dir: state.dir === 1 ? -1 : 1 } : { column, dir: 1 };
}

/** The rows one page of a table shows, with where the page sits among the sorted rows. */
export function tableView<T>(rows: readonly T[], keyOf: ((row: T) => SortKey) | null, sort: SortState, page: number, size = PAGE_SIZE) {
  const sorted = keyOf === null || sort.column < 0 ? rows : sortRows(rows, keyOf, sort.dir);
  const bounds = pageBounds(sorted.length, page, size);
  return { shown: sorted.slice(Math.max(0, bounds.from - 1), bounds.to), bounds };
}
