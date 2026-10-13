// Page state lives in location.hash (no history API, works from file://).
// Shapes: #/overview, #/structure, #/graph, #/graph/<dir> (a directory level
// of the graph), #/graph/file/<path> (a file's symbols), #/coverage[?scope=<scope>],
// #/search[?q=<query>], #/semantics, #/open (open a local .excavator
// directory), #/node/<encoded id>[?hops=2], #/dir/<path> (a
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
  | { kind: 'node'; id: string; hops?: number }
  | { kind: 'graph-dir'; path: string }
  | { kind: 'graph-file'; path: string }
  | { kind: 'dir'; path: string }
  /** Open a local .excavator directory (task 9.2). */
  | { kind: 'open' }
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
      const id = decodeURIComponent(encoded);
      const hops = new URLSearchParams(query).get('hops');
      return hops === '1' || hops === '2' ? { kind: 'node', id, hops: Number(hops) } : { kind: 'node', id };
    } catch {
      return { kind: 'unknown', hash };
    }
  }
  if (path.startsWith('graph/')) {
    // `graph/file/` is matched on the raw text; graphDirHash escapes a
    // top-level directory literally named "file", so the two never collide.
    const isFile = path.startsWith('graph/file/');
    const encoded = path.slice(isFile ? 'graph/file/'.length : 'graph/'.length).replace(/^\/+|\/+$/g, '');
    if (encoded === '') return isFile ? { kind: 'unknown', hash } : { kind: 'section', section: 'graph', params: new URLSearchParams(query) };
    try {
      const decoded = encoded.split('/').map(decodeURIComponent).join('/');
      return isFile ? { kind: 'graph-file', path: decoded } : { kind: 'graph-dir', path: decoded };
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
  if (path === 'open') return { kind: 'open' };
  if (SECTION_IDS.has(path)) return { kind: 'section', section: path as SectionId, params: new URLSearchParams(query) };
  return { kind: 'unknown', hash };
}

export function sectionHash(section: SectionId, params?: Record<string, string | null>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) if (value !== null && value !== '') query.set(key, value);
  const text = query.toString();
  return `#/${section}${text ? `?${text}` : ''}`;
}

export function nodeHash(id: string, hops?: number): string {
  return `#/node/${encodeURIComponent(id)}${hops === 2 ? '?hops=2' : ''}`;
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

/** `#/graph/<dir>`; the top ('') is `#/graph`. A first segment named "file" is escaped as `%66ile`. */
export function graphDirHash(path: string): string {
  if (path === '') return '#/graph';
  const encoded = encodePath(path);
  return `#/graph/${encoded === 'file' || encoded.startsWith('file/') ? `%66${encoded.slice(1)}` : encoded}`;
}

export function graphFileHash(path: string): string {
  return `#/graph/file/${encodePath(path)}`;
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

/** Graph routes: the member, directory, file and symbol levels. */
export function isGraphRoute(route: Route): boolean {
  return route.kind === 'graph-dir' || route.kind === 'graph-file' || route.kind === 'node' || (route.kind === 'section' && route.section === 'graph');
}

/** The nav section a route belongs to (a directory is part of Structure). */
export function routeSection(route: Route): SectionId | null {
  if (route.kind === 'section') return route.section;
  if (route.kind === 'graph-dir' || route.kind === 'graph-file') return 'graph';
  return route.kind === 'dir' ? 'structure' : null;
}
