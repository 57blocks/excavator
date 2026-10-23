/**
 * The Domain | Structural switch (openspec: changes/viewer-learn, design D2;
 * spec "Domain and structural switch"): the two views of the graph pages, each
 * returned to where it was. The place of each is its last address (level or
 * place, and selection); the switch goes there through the hash, in the mode
 * the page is in. Pure functions.
 */

import { parseRoute } from './route';
import { withMode, type Mode } from './view-mode';

export type GraphView = 'graph' | 'domain';

export const VIEW_LABELS: Readonly<Record<GraphView, string>> = { domain: 'Domain', graph: 'Structural' };

/** The last address of each view; null for a view not yet shown. */
export interface ViewPlaces {
  graph: string | null;
  domain: string | null;
}

/** The view a hash shows; null for a page that is neither. */
export function viewOf(hash: string): GraphView | null {
  const page = parseRoute(hash).page;
  return page === 'graph' || page === 'domain' ? page : null;
}

/** `places` with `hash` kept as the place of the view it shows; a hash of another page changes nothing. */
export function rememberPlace(places: ViewPlaces, hash: string): ViewPlaces {
  const view = viewOf(hash);
  if (view === null || places[view] === hash) return places;
  return { ...places, [view]: hash };
}

/** Where the switch to `target` goes: the place it was last left at (or its top), in `mode`. */
export function switchHash(target: GraphView, places: ViewPlaces, mode: Mode): string {
  return withMode(places[target] ?? `#/${target}`, mode);
}
