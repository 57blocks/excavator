/**
 * The three modes of the graph pages (openspec: changes/viewer-learn, design D1;
 * spec "Three modes"): Overview, Learn and Deep dive, kept in the hash as `mode`
 * (Learn, the default, is left out). Overview draws no function or class nodes
 * on the structure graph; the other two draw everything. A mode never changes a
 * count: it decides only what is drawn. A search hit or a selection of a node
 * that Overview hides switches to Deep dive, so the node can be shown.
 * Pure functions.
 */

import { buildHash, parseRoute } from './route';

export const MODES = ['overview', 'learn', 'deep'] as const;
export type Mode = (typeof MODES)[number];

export const DEFAULT_MODE: Mode = 'learn';

export const MODE_LABELS: Readonly<Record<Mode, string>> = { overview: 'Overview', learn: 'Learn', deep: 'Deep dive' };

/** The node types Overview does not draw. */
export const HIDDEN_IN_OVERVIEW: ReadonlySet<string> = new Set(['function', 'class']);

/** The note the graph carries in Overview. */
export const OVERVIEW_NOTE = 'Overview: function and class nodes are hidden. Every count still includes them.';

/** The mode a hash parameter names; anything else is the default. */
export function parseMode(value: string | null | undefined): Mode {
  return (MODES as readonly string[]).includes(value ?? '') ? (value as Mode) : DEFAULT_MODE;
}

/** The mode as a hash parameter: null for the default, so an address without a mode is Learn. */
export function modeParam(mode: Mode): string | null {
  return mode === DEFAULT_MODE ? null : mode;
}

/** Whether `mode` leaves out nodes of `type` from what the structure graph draws. */
export function hiddenByMode(mode: Mode, type: string | undefined): boolean {
  return mode === 'overview' && type !== undefined && HIDDEN_IN_OVERVIEW.has(type);
}

/** The node types `mode` hides, joined with the types the filters hide. */
export function hiddenTypes(mode: Mode, filtered: ReadonlySet<string>): ReadonlySet<string> {
  if (mode !== 'overview') return filtered;
  return new Set([...filtered, ...HIDDEN_IN_OVERVIEW]);
}

/**
 * The mode to show node `type` in, when it is chosen from search or selected: the same mode, unless that mode hides
 * the node, in which case Deep dive. `switched` names the mode that was left.
 */
export function modeForNode(mode: Mode, type: string | undefined): { mode: Mode; switched: Mode | null } {
  return hiddenByMode(mode, type) ? { mode: 'deep', switched: mode } : { mode, switched: null };
}

/** `hash` with its `mode` parameter set to `mode` (taken off for the default); every other part is kept. */
export function withMode(hash: string, mode: Mode): string {
  const route = parseRoute(hash);
  const params: Record<string, string | null> = { ...route.params };
  delete params.mode;
  params.mode = modeParam(mode);
  return buildHash(route.page, params, route.rest);
}
