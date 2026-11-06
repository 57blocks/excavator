/**
 * The page's routes live in the URL fragment so the back button and shared
 * links work: `#/`, `#/feature/<id>`, `#/domain/<id>`, `#/role/<label>`,
 * `#/application/<dir>`, `#/system/<name>`, `#/matrix/roles`,
 * `#/matrix/applications`, `#/notifications`, `#/jobs`, `#/coverage` and (technical view only) `#/data` and `#/dictionaries`. A page
 * that has both views puts the view in front of each (`#/technical/feature/F1`);
 * a page with one view has no prefix, and a fragment without one is the first
 * view. Parsing never throws: a fragment that names no route is `not-found`.
 */

import { VIEWS } from './types';
import type { View } from './types';

export type RouteBody =
  | { name: 'overview' }
  | { name: 'feature'; id: string }
  | { name: 'domain'; id: string }
  | { name: 'role'; label: string }
  | { name: 'application'; dir: string }
  | { name: 'system'; system: string }
  | { name: 'roles-matrix' }
  | { name: 'applications-matrix' }
  | { name: 'notifications' }
  | { name: 'jobs' }
  | { name: 'coverage' }
  | { name: 'data' }
  | { name: 'dictionaries' }
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

const KEYED: Record<string, (value: string) => RouteBody> = {
  feature: (id) => ({ name: 'feature', id }),
  domain: (id) => ({ name: 'domain', id }),
  role: (label) => ({ name: 'role', label }),
  application: (dir) => ({ name: 'application', dir }),
  system: (system) => ({ name: 'system', system }),
};

function parseBody(rest: string[], hash: string): RouteBody {
  if (rest.length === 0) return { name: 'overview' };
  if (rest.length === 1 && rest[0] === 'coverage') return { name: 'coverage' };
  if (rest.length === 1 && rest[0] === 'notifications') return { name: 'notifications' };
  if (rest.length === 1 && rest[0] === 'jobs') return { name: 'jobs' };
  if (rest.length === 1 && rest[0] === 'data') return { name: 'data' };
  if (rest.length === 1 && rest[0] === 'dictionaries') return { name: 'dictionaries' };
  if (rest.length === 2 && rest[0] === 'matrix' && rest[1] === 'roles') return { name: 'roles-matrix' };
  if (rest.length === 2 && rest[0] === 'matrix' && rest[1] === 'applications') return { name: 'applications-matrix' };
  if (rest.length === 2 && Object.prototype.hasOwnProperty.call(KEYED, rest[0])) {
    const value = decode(rest[1]);
    if (value !== null && value !== '') return KEYED[rest[0]](value);
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
    case 'overview': return [];
    case 'feature': return ['feature', encodeURIComponent(route.id)];
    case 'domain': return ['domain', encodeURIComponent(route.id)];
    case 'role': return ['role', encodeURIComponent(route.label)];
    case 'application': return ['application', encodeURIComponent(route.dir)];
    case 'system': return ['system', encodeURIComponent(route.system)];
    case 'roles-matrix': return ['matrix', 'roles'];
    case 'applications-matrix': return ['matrix', 'applications'];
    case 'notifications': return ['notifications'];
    case 'jobs': return ['jobs'];
    case 'coverage': return ['coverage'];
    case 'data': return ['data'];
    case 'dictionaries': return ['dictionaries'];
    case 'not-found': return [];
  }
}

/** The fragment of a route; `prefix` is the view to put in front, null for a page with one view. */
export function routeHash(route: RouteBody, prefix: View | null): string {
  const parts = prefix === null ? segments(route) : [prefix, ...segments(route)];
  return parts.length === 0 ? '#/' : `#/${parts.join('/')}`;
}

/** The pages only the technical view has: the application and external-system pages, the applications-by-domain matrix, the data page and the dictionaries page. */
const TECHNICAL_ONLY: readonly RouteBody['name'][] = ['application', 'system', 'applications-matrix', 'data', 'dictionaries'];

export const isInView = (route: RouteBody, view: View): boolean => view === 'technical' || !TECHNICAL_ONLY.includes(route.name);
