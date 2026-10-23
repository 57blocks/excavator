/**
 * The addresses the graph page moves between (openspec: changes/viewer-app,
 * design D7): drilling into a level, selecting a node where it lives, and the
 * steps Esc takes. Every move is the hash of a new state, so the browser's
 * history holds it. The overlays and the filters stay through every move; a path
 * stays through a drill-down and a selection; a selection, a focus and a selected
 * entry stay with the level they were made at.
 */

import type { GraphIndex } from '../data/indexes';
import type { GraphFilters } from './graph-filters';
import { graphHash, type GraphState } from './graph-state';
import type { OverlayName } from './overlay-names';
import { locateFile, type Level, type Structure } from './graph-structure';

/** Go to the level `path` (and `fold`), keeping the path that is highlighted, the overlays, the filters and the mode. */
export function levelHash(state: GraphState, path: string, fold: string | null): string {
  return graphHash({ path, fold, from: state.from, to: state.to, directed: state.directed, overlays: state.overlays, filters: state.filters, mode: state.mode });
}

/** The state with `overlays` on; the rest of the view stays where it is. */
export function overlaysHash(state: GraphState, overlays: readonly OverlayName[]): string {
  return graphHash({ ...state, overlays });
}

/** The state under `filters`; the rest of the view stays where it is. */
export function filtersHash(state: GraphState, filters: GraphFilters): string {
  return graphHash({ ...state, filters });
}

/** Select the cluster, directory or fold `entry` of the level. */
export function entryHash(state: GraphState, entry: string): string {
  return graphHash({ ...state, node: null, entry, focus: false });
}

/**
 * Select node `nodeId`. In a focus view the focus moves to it and the level stays; elsewhere the
 * view goes to the level that draws the node's file, so the node is on screen.
 */
export function selectHash(state: GraphState, index: Pick<GraphIndex, 'owningFile'>, structure: Structure, nodeId: string): string {
  if (state.focus) return graphHash({ ...state, node: nodeId, entry: null });
  const file = index.owningFile.get(nodeId);
  const where = file === undefined ? null : locateFile(structure, file);
  return graphHash({ ...state, ...(where ?? {}), node: nodeId, entry: null });
}

/** The state with no selection and no focus. */
export function clearSelectionHash(state: GraphState): string {
  return graphHash({ ...state, node: null, entry: null, focus: false });
}

export function setFocusHash(state: GraphState, focus: boolean): string {
  return graphHash({ ...state, focus });
}

export function clearPathHash(state: GraphState): string {
  return graphHash({ ...state, from: null, to: null, directed: false });
}

export function setPathHash(state: GraphState, from: string, to: string, directed: boolean): string {
  return graphHash({ ...state, from, to, directed, focus: false });
}

/** The level one step above `level`; null at the top. */
export function parentLevel(level: Level): { path: string; fold: string | null } | null {
  const crumbs = level.crumbs;
  return crumbs.length > 1 ? { path: crumbs[crumbs.length - 2].path, fold: crumbs[crumbs.length - 2].fold } : null;
}
