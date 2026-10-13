// Edge types the page names in its legend (artifact-view task 6.4). The list
// mirrors DETERMINISTIC_EDGE_TYPES in skills/excavator/retrieve.mjs (a test
// pins the two together). A type the graph carries that is not listed here is
// shown under OTHER_EDGE_TYPE, never dropped.

export const EDGE_TYPES = [
  'contains', 'imports', 'exports', 'calls', 'inherits', 'implements', 'overrides', 'mentions', 'references', 'injects',
] as const;

export const OTHER_EDGE_TYPE = 'other';

export type EdgeTypeKey = (typeof EDGE_TYPES)[number] | typeof OTHER_EDGE_TYPE;

const KNOWN = new Set<string>(EDGE_TYPES);

/** The legend entry an edge type belongs to: itself when listed, otherwise "other". */
export function edgeTypeKey(type: string): EdgeTypeKey {
  return KNOWN.has(type) ? (type as EdgeTypeKey) : OTHER_EDGE_TYPE;
}

/** The CSS custom property holding a legend entry's fixed color. */
export function edgeColorVar(type: string): string {
  return `--edge-${edgeTypeKey(type)}`;
}

/** Legend entries in fixed order, then "other". */
export const LEGEND_KEYS: EdgeTypeKey[] = [...EDGE_TYPES, OTHER_EDGE_TYPE];
