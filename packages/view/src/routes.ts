// Page state lives in location.hash (no history API, works from file://).
// Shapes: #/overview, #/structure, #/graph, #/coverage[?scope=<scope>],
// #/search[?q=<query>], #/semantics, #/node/<encoded id>, #/dir/<path> (a
// directory or file in the structure treemap, each path segment
// URI-encoded; `#/dir/` alone is the tree root). An empty hash is the overview;
// anything else is an explicit "unknown" route, never a silent redirect.
import { useEffect, useState } from 'react';

export const SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'structure', label: 'Structure' },
  { id: 'graph', label: 'Graph' },
  { id: 'coverage', label: 'Coverage & Gaps' },
  { id: 'search', label: 'Search' },
  { id: 'semantics', label: 'Semantics' },
] as const;

export type SectionId = (typeof SECTIONS)[number]['id'];

export type Route =
  | { kind: 'section'; section: SectionId; params: URLSearchParams }
  | { kind: 'node'; id: string }
  | { kind: 'dir'; path: string }
  | { kind: 'unknown'; hash: string };

const SECTION_IDS = new Set<string>(SECTIONS.map((s) => s.id));

export function parseHash(hash: string): Route {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (raw === '' || raw === '/') return { kind: 'section', section: 'overview', params: new URLSearchParams() };
  if (!raw.startsWith('/')) return { kind: 'unknown', hash };
  const [path, query = ''] = splitOnce(raw.slice(1), '?');
  if (path.startsWith('node/')) {
    const encoded = path.slice('node/'.length);
    if (encoded === '') return { kind: 'unknown', hash };
    try {
      return { kind: 'node', id: decodeURIComponent(encoded) };
    } catch {
      return { kind: 'unknown', hash };
    }
  }
  if (path === 'dir' || path.startsWith('dir/')) {
    const encoded = path.slice('dir'.length).replace(/^\/+|\/+$/g, '');
    try {
      return { kind: 'dir', path: encoded === '' ? '' : encoded.split('/').map(decodeURIComponent).join('/') };
    } catch {
      return { kind: 'unknown', hash };
    }
  }
  if (SECTION_IDS.has(path)) return { kind: 'section', section: path as SectionId, params: new URLSearchParams(query) };
  return { kind: 'unknown', hash };
}

export function sectionHash(section: SectionId, params?: Record<string, string | null>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) if (value !== null && value !== '') query.set(key, value);
  const text = query.toString();
  return `#/${section}${text ? `?${text}` : ''}`;
}

export function nodeHash(id: string): string {
  return `#/node/${encodeURIComponent(id)}`;
}

/** `#/dir/<path>`; the root ('') is the plain structure section. */
export function dirHash(path: string): string {
  return path === '' ? '#/structure' : `#/dir/${path.split('/').map(encodeURIComponent).join('/')}`;
}

function splitOnce(text: string, separator: string): [string, string?] {
  const at = text.indexOf(separator);
  return at < 0 ? [text] : [text.slice(0, at), text.slice(at + 1)];
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function routeName(route: Route): string {
  return route.kind === 'section' ? route.section : route.kind;
}

/** The nav section a route belongs to (a directory is part of Structure). */
export function routeSection(route: Route): SectionId | null {
  if (route.kind === 'section') return route.section;
  return route.kind === 'dir' ? 'structure' : null;
}
