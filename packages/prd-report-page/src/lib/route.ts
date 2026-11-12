/**
 * The page's routes live in the URL fragment (design D5): `#/`,
 * `#/feature/<id>` (optionally `?finding=<finding id>`, the card to scroll to), `#/findings?class=<c>&priority=<p>&feature=<id>&q=<text>` and
 * `#/coverage`. Parsing never throws: a fragment that names no route is
 * `not-found`, and a filter value that is not one of the known ones is
 * dropped, so a shared link with a typo still opens the page.
 */

export type ClassFilter = 'all' | 'product' | 'technical';

/** A level the page filters on; `unranked` is a finding whose priority is null. */
export type PriorityFilter = 'all' | 'P0' | 'P1' | 'P2' | 'unranked';

export interface FindingsFilters {
  class: ClassFilter;
  priority: PriorityFilter;
  /** A feature id, or '' for every feature. */
  feature: string;
  q: string;
}

export type Route =
  | { name: 'overview' }
  | { name: 'feature'; id: string; finding?: string }
  | { name: 'findings'; filters: FindingsFilters }
  | { name: 'coverage' }
  | { name: 'not-found'; hash: string };

export const NO_FILTERS: FindingsFilters = Object.freeze({ class: 'all', priority: 'all', feature: '', q: '' });

const CLASSES: readonly ClassFilter[] = ['all', 'product', 'technical'];
const PRIORITIES: readonly PriorityFilter[] = ['all', 'P0', 'P1', 'P2', 'unranked'];

function decode(part: string): string | null {
  try {
    return decodeURIComponent(part);
  } catch {
    return null;
  }
}

/** The route of `location.hash` (with or without the leading `#`). */
export function parseHash(hash: string): Route {
  const text = hash.startsWith('#') ? hash.slice(1) : hash;
  const [rawPath, ...queryParts] = text.split('?');
  const query = queryParts.join('?');
  const path = rawPath === '' ? '/' : rawPath;
  const parts = path.split('/').filter((part, at) => !(part === '' && at > 0));
  if (parts[0] !== '') return { name: 'not-found', hash };
  const rest = parts.slice(1);
  if (rest.length === 0) return { name: 'overview' };
  if (rest.length === 1 && rest[0] === 'coverage') return { name: 'coverage' };
  if (rest.length === 1 && rest[0] === 'findings') return { name: 'findings', filters: parseFilters(query) };
  if (rest.length === 2 && rest[0] === 'feature') {
    const id = decode(rest[1]);
    if (id !== null && id !== '') {
      const finding = new URLSearchParams(query).get('finding');
      return finding === null || finding === '' ? { name: 'feature', id } : { name: 'feature', id, finding };
    }
  }
  return { name: 'not-found', hash };
}

function parseFilters(query: string): FindingsFilters {
  const params = new URLSearchParams(query);
  const wanted = params.get('class') ?? 'all';
  const level = params.get('priority') ?? 'all';
  return {
    class: (CLASSES as readonly string[]).includes(wanted) ? (wanted as ClassFilter) : 'all',
    priority: (PRIORITIES as readonly string[]).includes(level) ? (level as PriorityFilter) : 'all',
    feature: params.get('feature') ?? '',
    q: params.get('q') ?? '',
  };
}

/** The fragment of a route; `parseHash(serializeRoute(route))` gives the route back (a not-found keeps its own text). */
export function serializeRoute(route: Route): string {
  switch (route.name) {
    case 'overview':
      return '#/';
    case 'coverage':
      return '#/coverage';
    case 'feature': {
      const base = `#/feature/${encodeURIComponent(route.id)}`;
      return route.finding === undefined || route.finding === '' ? base : `${base}?${new URLSearchParams({ finding: route.finding }).toString()}`;
    }
    case 'findings': {
      const params = new URLSearchParams();
      if (route.filters.class !== 'all') params.set('class', route.filters.class);
      if (route.filters.priority !== 'all') params.set('priority', route.filters.priority);
      if (route.filters.feature !== '') params.set('feature', route.filters.feature);
      if (route.filters.q !== '') params.set('q', route.filters.q);
      const query = params.toString();
      return query === '' ? '#/findings' : `#/findings?${query}`;
    }
    case 'not-found':
      return route.hash;
  }
}

/** The fragment of a feature page; `finding` names the card the page scrolls to. */
export const featureHash = (id: string, finding?: string): string => serializeRoute({ name: 'feature', id, finding });
export const findingsHash = (filters: Partial<FindingsFilters> = {}): string => serializeRoute({ name: 'findings', filters: { ...NO_FILTERS, ...filters } });

/**
 * The finding card a route scrolls to (design D5): the route's `finding` when it
 * is one of the feature's own findings, else '' (no scroll). A non-feature
 * route, a missing or empty `finding`, and another feature's finding all give ''.
 */
export function scrollTarget(route: Route, findingsOfFeature: readonly { id: string }[]): string {
  if (route.name !== 'feature' || route.finding === undefined || route.finding === '') return '';
  return findingsOfFeature.some((item) => item.id === route.finding) ? route.finding : '';
}
