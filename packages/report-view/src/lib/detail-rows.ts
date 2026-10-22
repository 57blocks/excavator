/**
 * The row links and the path filter of the detail pages (openspec:
 * changes/viewer-learn, design D5; spec "Detail page row panels and links"):
 * `row` names one row of a page's table (an unused function's node id, a
 * hotspots file path, a doc-map unit number) and `prefix` keeps the rows whose
 * path is under a directory. Both live in the hash, so back, forward, reload
 * and a pasted link restore them. Pure functions.
 */

import { buildHash, type Route } from './route';
import { sortRows, type SortKey, type SortState } from './table';

export interface DetailParams {
  row: string | null;
  prefix: string | null;
}

const nonEmpty = (value: string | undefined) => (typeof value === 'string' && value !== '' ? value : null);

/** The `row` and `prefix` of a route's parameters; an empty value is none. */
export function detailParams(params: Readonly<Record<string, string>>): DetailParams {
  return { row: nonEmpty(params.row), prefix: nonEmpty(params.prefix) };
}

/**
 * The hash of the route with `changes` applied to its parameters: a string sets one, null takes it off, and
 * every other parameter is kept as it is.
 */
export function withParams(route: Pick<Route, 'page' | 'rest' | 'params'>, changes: Readonly<Record<string, string | null | undefined>>): string {
  const params: Record<string, string | null | undefined> = { ...route.params };
  for (const key of Object.keys(changes)) params[key] = changes[key];
  return buildHash(route.page, params, route.rest);
}

/** A prefix as a directory path with no leading `./` and no trailing slash; null when it names the project root or nothing. */
export function normalizePrefix(prefix: string | null | undefined): string | null {
  if (typeof prefix !== 'string') return null;
  const path = prefix.trim().replace(/^(\.\/)+/, '').replace(/\/+$/, '');
  return path === '' || path === '.' ? null : path;
}

/** Whether `path` is the prefix or below it, by whole path segments (`srcx/a` is not under `src`). Every path is under no prefix. */
export function underPrefix(path: string | null | undefined, prefix: string | null | undefined): boolean {
  const dir = normalizePrefix(prefix);
  if (dir === null) return true;
  if (typeof path !== 'string') return false;
  return path === dir || path.startsWith(`${dir}/`);
}

/** The rows whose path (`pathOf`) is under the prefix; all of them when there is no prefix. A row without a path is left out by a prefix. */
export function filterByPrefix<T>(rows: readonly T[], pathOf: (row: T) => string | null | undefined, prefix: string | null | undefined): T[] {
  if (normalizePrefix(prefix) === null) return [...rows];
  return rows.filter((row) => underPrefix(pathOf(row), prefix));
}

/**
 * Where the row that `isRow` picks sits once the rows are sorted the way the table sorts them: its 1-based page of
 * `pageSize` rows and its 0-based index. Null when no row matches.
 */
export function pageOfRow<T>(rows: readonly T[], keyOf: ((row: T) => SortKey) | null, sort: SortState, isRow: (row: T) => boolean, pageSize: number): { page: number; index: number } | null {
  const sorted = keyOf === null || sort.column < 0 ? rows : sortRows(rows, keyOf, sort.dir);
  const index = sorted.findIndex(isRow);
  return index < 0 ? null : { page: Math.floor(index / pageSize) + 1, index };
}
