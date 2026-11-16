/**
 * The page's routes live in the URL fragment so the back button and shared links work: `#/` (the home page, the
 * map), `#/domain/<id>` (a domain page), `#/chapter/<block>` (a chapter written as Markdown), `#/data` and `#/dictionaries` (technical view only),
 * `#/history` and `#/coverage`, and `#/problems` with `#/problems/remedies` (the problems page and its remedies tab; a query after `?`
 * holds its filters: `?domain=d1&feature=F7&type=defect&level=P0&q=text`). A page that has both views puts the view in front of each (`#/technical/chapter/F1`);
 * a page with one view has no prefix, and a fragment without one is the first view. Parsing never throws: a fragment
 * that names no route is `not-found`.
 */

import { VIEWS } from './types';
import type { View } from './types';

/** The filters of the problems page, one value each; a value is a string as written, and one the data does not know matches nothing. */
export interface ProblemFilters { domain?: string; feature?: string; type?: string; level?: string; q?: string }
export type ProblemsTab = 'list' | 'remedies';

/** The filter keys in the order the address writes them. */
export const FILTER_KEYS = ['domain', 'feature', 'type', 'level', 'q'] as const;

export type RouteBody =
  | { name: 'home' }
  | { name: 'domain'; id: string }
  | { name: 'chapter'; id: string }
  | { name: 'data' }
  | { name: 'dictionaries' }
  | { name: 'history' }
  | { name: 'coverage' }
  | { name: 'problems'; tab: ProblemsTab; filters: ProblemFilters }
  | { name: 'not-found'; hash: string };

/** A route with the view its fragment names, when it names one. */
export type Route = RouteBody & { view?: View };

function decode(part: string): string | null {
  try {
    return decodeURIComponent(part);
  } catch {
    return null;
  }
}

const SINGLE: Record<string, RouteBody> = {
  data: { name: 'data' },
  dictionaries: { name: 'dictionaries' },
  history: { name: 'history' },
  coverage: { name: 'coverage' },
};

/** The filters a query holds: the first value of each known key; an unknown key, an empty value and an undecodable one are ignored. */
export function parseFilters(query: string): ProblemFilters {
  const filters: ProblemFilters = {};
  for (const pair of query.split('&')) {
    const at = pair.indexOf('=');
    if (at < 0) continue;
    const key = decode(pair.slice(0, at));
    const value = decode(pair.slice(at + 1));
    if (key === null || value === null || value === '') continue;
    if ((FILTER_KEYS as readonly string[]).includes(key) && filters[key as keyof ProblemFilters] === undefined) filters[key as keyof ProblemFilters] = value;
  }
  return filters;
}

function parseBody(rest: string[], hash: string, query: string | null): RouteBody {
  if (rest.length >= 1 && rest[0] === 'problems') {
    if (rest.length === 1) return { name: 'problems', tab: 'list', filters: parseFilters(query ?? '') };
    if (rest.length === 2 && rest[1] === 'remedies') return { name: 'problems', tab: 'remedies', filters: parseFilters(query ?? '') };
    return { name: 'not-found', hash };
  }
  if (query !== null) return { name: 'not-found', hash };
  if (rest.length === 0) return { name: 'home' };
  if (rest.length === 1 && Object.prototype.hasOwnProperty.call(SINGLE, rest[0])) return SINGLE[rest[0]];
  if (rest.length === 2 && (rest[0] === 'chapter' || rest[0] === 'domain')) {
    const id = decode(rest[1]);
    if (id !== null && id !== '') return { name: rest[0], id };
  }
  return { name: 'not-found', hash };
}

/** The route of `location.hash` (with or without the leading `#`). */
export function parseHash(hash: string): Route {
  const text = hash.startsWith('#') ? hash.slice(1) : hash;
  const queryAt = text.indexOf('?');
  const path = queryAt < 0 ? text : text.slice(0, queryAt);
  const query = queryAt < 0 ? null : text.slice(queryAt + 1);
  const parts = (path === '' ? '/' : path).split('/');
  if (parts[0] !== '') return { name: 'not-found', hash };
  let rest = parts.slice(1).filter((part, at, all) => !(part === '' && at === all.length - 1));
  let view: View | undefined;
  if (rest.length > 0 && (VIEWS as readonly string[]).includes(rest[0])) {
    view = rest[0] as View;
    rest = rest.slice(1);
  }
  const body = parseBody(rest, hash, query);
  return view === undefined ? body : { ...body, view };
}

function segments(route: RouteBody): string[] {
  switch (route.name) {
    case 'chapter': return ['chapter', encodeURIComponent(route.id)];
    case 'domain': return ['domain', encodeURIComponent(route.id)];
    case 'data': return ['data'];
    case 'dictionaries': return ['dictionaries'];
    case 'history': return ['history'];
    case 'coverage': return ['coverage'];
    case 'problems': return route.tab === 'remedies' ? ['problems', 'remedies'] : ['problems'];
    case 'home': return [];
    case 'not-found': return [];
  }
}

/** The query of the filters: the keys in a fixed order, an empty value left out; '' when there is none. */
function queryOf(filters: ProblemFilters): string {
  const pairs = FILTER_KEYS.flatMap((key) => { const value = filters[key]; return value === undefined || value === '' ? [] : [`${key}=${encodeURIComponent(value)}`]; });
  return pairs.length === 0 ? '' : `?${pairs.join('&')}`;
}

/** The fragment of a route; `prefix` is the view to put in front, null for a page with one view. */
export function routeHash(route: RouteBody, prefix: View | null): string {
  const parts = prefix === null ? segments(route) : [prefix, ...segments(route)];
  const base = parts.length === 0 ? '#/' : `#/${parts.join('/')}`;
  return route.name === 'problems' ? `${base}${queryOf(route.filters)}` : base;
}
