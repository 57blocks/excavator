/**
 * The page's routes live in the URL fragment: `#/`, `#/feature/<id>`,
 * `#/notifications`, `#/jobs` and `#/coverage`, so the back button and shared links work. Parsing never
 * throws: a fragment that names no route is `not-found`.
 */

export type Route =
  | { name: 'overview' }
  | { name: 'feature'; id: string }
  | { name: 'notifications' }
  | { name: 'jobs' }
  | { name: 'coverage' }
  | { name: 'not-found'; hash: string };

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
  const parts = (text === '' ? '/' : text).split('/');
  if (parts[0] !== '') return { name: 'not-found', hash };
  const rest = parts.slice(1).filter((part, at, all) => !(part === '' && at === all.length - 1));
  if (rest.length === 0) return { name: 'overview' };
  if (rest.length === 1 && rest[0] === 'coverage') return { name: 'coverage' };
  if (rest.length === 1 && rest[0] === 'notifications') return { name: 'notifications' };
  if (rest.length === 1 && rest[0] === 'jobs') return { name: 'jobs' };
  if (rest.length === 2 && rest[0] === 'feature') {
    const id = decode(rest[1]);
    if (id !== null && id !== '') return { name: 'feature', id };
  }
  return { name: 'not-found', hash };
}

export const OVERVIEW_HASH = '#/';
export const COVERAGE_HASH = '#/coverage';
export const NOTIFICATIONS_HASH = '#/notifications';
export const JOBS_HASH = '#/jobs';
export const featureHash = (id: string): string => `#/feature/${encodeURIComponent(id)}`;
