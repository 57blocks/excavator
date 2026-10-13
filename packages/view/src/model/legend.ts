// Rows of the edge type legend (artifact-view tasks 6.4, 7A.2): per legend
// key, how many edges the current level draws and how many its scope holds.
// A key with edges in the scope stays switchable even when none is drawn.
import { LEGEND_KEYS, edgeTypeKey, type EdgeTypeKey } from './edge-types';

export interface LegendRow {
  key: EdgeTypeKey;
  /** Edges represented by the links drawn on the canvas. */
  drawn: number;
  /** Edges of this key in the level's scope. */
  total: number;
  /** Switched off by the reader. */
  off: boolean;
  /** The switch is inert: nothing of this key in the scope (and it is not off). */
  disabled: boolean;
  /** "other": the unlisted type names it holds. */
  otherTypes: string[];
}

export function legendRows(drawn: Map<string, number>, totals: Map<string, number>, disabled: ReadonlySet<string>): LegendRow[] {
  const fold = (counts: Map<string, number>) => {
    const byKey = new Map<string, number>();
    for (const [type, n] of counts) byKey.set(edgeTypeKey(type), (byKey.get(edgeTypeKey(type)) ?? 0) + n);
    return byKey;
  };
  const drawnByKey = fold(drawn);
  const totalByKey = fold(totals);
  const otherTypes = [...new Set([...drawn.keys(), ...totals.keys()])].filter((t) => edgeTypeKey(t) === 'other').sort();
  return LEGEND_KEYS.map((key) => {
    const total = totalByKey.get(key) ?? 0;
    const off = disabled.has(key);
    return { key, drawn: drawnByKey.get(key) ?? 0, total, off, disabled: total === 0 && !off, otherTypes: key === 'other' ? otherTypes : [] };
  });
}

/**
 * Scope totals for the legend when the scope itself depends on the switches
 * (a neighborhood is walked over the enabled types only): enabled types count
 * in the filtered scope, switched-off types keep their total from the
 * unfiltered scope, so turning a type off never shows it as 0 / 0.
 */
export function legendTotals(filtered: Map<string, number>, unfiltered: Map<string, number> | null, disabled: ReadonlySet<string>): Map<string, number> {
  if (disabled.size === 0 || unfiltered === null) return filtered;
  const out = new Map<string, number>();
  for (const [type, n] of filtered) if (!disabled.has(edgeTypeKey(type))) out.set(type, n);
  for (const [type, n] of unfiltered) if (disabled.has(edgeTypeKey(type))) out.set(type, n);
  return out;
}
