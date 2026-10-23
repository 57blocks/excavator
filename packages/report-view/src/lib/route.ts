/**
 * Hash routes (openspec: changes/viewer-app, design D7): `#/<page>?k=v`, and
 * `#/reports/<name>`. parseRoute and buildHash are pure and inverse to each
 * other; the hash is the only place the view state lives, so history, reload
 * and a pasted link all restore it.
 */

export interface Route {
  page: string;
  /** What follows the page name in the path, joined with `/`. */
  rest: string;
  params: Record<string, string>;
}

/** The page an empty hash opens; the viewer falls back to the Products page when it has no knowledge graph to draw. */
export const DEFAULT_PAGE = 'graph';

/** True for a hash that names no page: the viewer was opened without a route. */
export function isBareHash(hash: string): boolean {
  return hash === '' || hash === '#' || hash === '#/';
}

function decode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * parseRoute('#/code/x?path=a%2Fb&lines=3-9') gives
 * { page: 'code', rest: 'x', params: { path: 'a/b', lines: '3-9' } }.
 * An empty hash gives the default page's route; the page name is returned as typed otherwise.
 * The first of a repeated key wins.
 */
export function parseRoute(hash: unknown): Route {
  let text = typeof hash === 'string' ? hash : '';
  if (text.startsWith('#')) text = text.slice(1);
  const queryAt = text.indexOf('?');
  const path = queryAt === -1 ? text : text.slice(0, queryAt);
  const query = queryAt === -1 ? '' : text.slice(queryAt + 1);
  const segments = path.split('/').filter((segment) => segment !== '');
  const params: Record<string, string> = Object.create(null);
  for (const pair of query.split('&')) {
    if (pair === '') continue;
    const eq = pair.indexOf('=');
    const key = decode(eq === -1 ? pair : pair.slice(0, eq));
    const value = eq === -1 ? '' : decode(pair.slice(eq + 1).replace(/\+/g, ' '));
    if (!(key in params)) params[key] = value;
  }
  return {
    page: segments.length === 0 ? DEFAULT_PAGE : decode(segments[0]),
    rest: segments.slice(1).map(decode).join('/'),
    params,
  };
}

/** The inverse of parseRoute: buildHash('code', { path: 'a/b', lines: '3-9' }) is '#/code?path=a%2Fb&lines=3-9'. A null or undefined value is left out. */
export function buildHash(page: string, params: Record<string, string | null | undefined> = {}, rest = ''): string {
  let hash = `#/${encodeURIComponent(page)}`;
  if (rest) hash += `/${rest.split('/').map(encodeURIComponent).join('/')}`;
  const keys = Object.keys(params).filter((key) => params[key] !== null && params[key] !== undefined);
  if (keys.length > 0) hash += `?${keys.map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key] as string)}`).join('&')}`;
  return hash;
}

/** Pages that moved to a new name: an old bookmark still opens the page (openspec: changes/viewer-learn, design D9). */
const MOVED_PAGES: Readonly<Record<string, string>> = { overview: 'products' };

/**
 * The hash a moved page's hash is replaced with, or null when the page has not moved:
 * redirectHash('#/overview?x=1') is '#/products?x=1'. What follows the page name is kept as written.
 */
export function redirectHash(hash: string): string | null {
  const route = parseRoute(hash);
  if (!Object.hasOwn(MOVED_PAGES, route.page)) return null;
  const queryAt = hash.indexOf('?');
  const query = queryAt === -1 ? '' : hash.slice(queryAt);
  const rest = route.rest ? `/${route.rest.split('/').map(encodeURIComponent).join('/')}` : '';
  return `#/${MOVED_PAGES[route.page]}${rest}${query}`;
}
