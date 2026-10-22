/**
 * What the graph page keeps in the address (openspec: changes/viewer-app, design
 * D7; spec "Shortcuts and history"): the level (`path`, `fold`), the selected
 * node (or the selected cluster, directory or fold of the level), the focus
 * flag, and the two ends of a path with the way it follows edges. History moves
 * between these because each change is a new entry, and a reload reads them back.
 * The overlays that are on and the filters are kept there too, so a reload or a
 * pasted link restores them. `escapeStep` says what Esc closes next.
 */

import { filterParams, NO_FILTERS, parseFilters, type GraphFilters } from './graph-filters';
import { overlayParam, parseOverlays, type OverlayName } from './overlay-names';
import { buildHash } from './route';

export interface GraphState {
  /** The level: '' is the top. */
  path: string;
  fold: string | null;
  node: string | null;
  /** The selected cluster, directory or fold of the level; never set together with `node`. */
  entry: string | null;
  /** The view shows only `node` and its neighbours. */
  focus: boolean;
  /** The ends of the path to highlight; both are set, or neither. */
  from: string | null;
  to: string | null;
  /** The path follows edges only from source to target. */
  directed: boolean;
  /** The product overlays that are on, in the fixed order. */
  overlays: readonly OverlayName[];
  filters: GraphFilters;
}

export const TOP_LEVEL: GraphState = { path: '', fold: null, node: null, entry: null, focus: false, from: null, to: null, directed: false, overlays: [], filters: NO_FILTERS };

type Params = Record<string, string | null | undefined>;

/** The state a route's parameters name; a focus without a node, an entry beside a node, and half a path, are dropped. */
export function parseGraphState(params: Params): GraphState {
  const node = params.node ? params.node : null;
  const from = params.from ? params.from : null;
  const to = params.to ? params.to : null;
  const both = from !== null && to !== null;
  return {
    path: params.path ?? '',
    fold: params.fold ? params.fold : null,
    node,
    entry: node === null && params.entry ? params.entry : null,
    focus: params.focus === '1' && node !== null,
    from: both ? from : null,
    to: both ? to : null,
    directed: both && params.dir === '1',
    overlays: parseOverlays(params.overlay),
    filters: parseFilters(params),
  };
}

/** The hash of the graph page for `state`; fields the state leaves out are those of the top level. */
export function graphHash(state: Partial<GraphState> = {}): string {
  const s = { ...TOP_LEVEL, ...state };
  const both = s.from !== null && s.to !== null;
  return buildHash('graph', {
    path: s.path === '' ? null : s.path,
    fold: s.fold,
    node: s.node,
    entry: s.node === null ? s.entry : null,
    focus: s.focus && s.node !== null ? '1' : null,
    from: both ? s.from : null,
    to: both ? s.to : null,
    dir: both && s.directed ? '1' : null,
    overlay: overlayParam(s.overlays),
    ...filterParams(s.filters),
  });
}

export type EscapeStep = 'overlay' | 'drawer' | 'focus' | 'path' | 'selection' | 'level' | 'none';

export interface EscapeState {
  /** A dialog, menu or result list is open. */
  overlay: boolean;
  drawer: boolean;
  focus: boolean;
  /** A path is highlighted. */
  path: boolean;
  selection: boolean;
  /** The level has a parent to go up to. */
  canGoUp: boolean;
}

/** What Esc closes, from the inside out: dialog, code drawer, focus, path, selection, one level. */
export function escapeStep(state: EscapeState): EscapeStep {
  if (state.overlay) return 'overlay';
  if (state.drawer) return 'drawer';
  if (state.focus) return 'focus';
  if (state.path) return 'path';
  if (state.selection) return 'selection';
  if (state.canGoUp) return 'level';
  return 'none';
}
