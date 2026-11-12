/**
 * The page's routes live in the URL fragment so the back button and shared links work: `#/` (the first page of the
 * outline), `#/chapter/<block>` (a chapter written as Markdown), `#/data` and `#/dictionaries` (technical view only),
 * `#/history` and `#/coverage`. A page that has both views puts the view in front of each (`#/technical/chapter/F1`);
 * a page with one view has no prefix, and a fragment without one is the first view. Parsing never throws: a fragment
 * that names no route is `not-found`.
 */

import { VIEWS } from './types';
import type { View } from './types';

export type RouteBody =
  | { name: 'home' }
  | { name: 'chapter'; id: string }
  | { name: 'data' }
  | { name: 'dictionaries' }
  | { name: 'history' }
  | { name: 'coverage' }
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

function parseBody(rest: string[], hash: string): RouteBody {
  if (rest.length === 0) return { name: 'home' };
  if (rest.length === 1 && Object.prototype.hasOwnProperty.call(SINGLE, rest[0])) return SINGLE[rest[0]];
  if (rest.length === 2 && rest[0] === 'chapter') {
    const id = decode(rest[1]);
    if (id !== null && id !== '') return { name: 'chapter', id };
  }
  return { name: 'not-found', hash };
}

/** The route of `location.hash` (with or without the leading `#`). */
export function parseHash(hash: string): Route {
  const text = hash.startsWith('#') ? hash.slice(1) : hash;
  const parts = (text === '' ? '/' : text).split('/');
  if (parts[0] !== '') return { name: 'not-found', hash };
  let rest = parts.slice(1).filter((part, at, all) => !(part === '' && at === all.length - 1));
  let view: View | undefined;
  if (rest.length > 0 && (VIEWS as readonly string[]).includes(rest[0])) {
    view = rest[0] as View;
    rest = rest.slice(1);
  }
  const body = parseBody(rest, hash);
  return view === undefined ? body : { ...body, view };
}

function segments(route: RouteBody): string[] {
  switch (route.name) {
    case 'chapter': return ['chapter', encodeURIComponent(route.id)];
    case 'data': return ['data'];
    case 'dictionaries': return ['dictionaries'];
    case 'history': return ['history'];
    case 'coverage': return ['coverage'];
    case 'home': return [];
    case 'not-found': return [];
  }
}

/** The fragment of a route; `prefix` is the view to put in front, null for a page with one view. */
export function routeHash(route: RouteBody, prefix: View | null): string {
  const parts = prefix === null ? segments(route) : [prefix, ...segments(route)];
  return parts.length === 0 ? '#/' : `#/${parts.join('/')}`;
}
