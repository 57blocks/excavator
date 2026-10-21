/**
 * The graph's filters (openspec: changes/viewer-app, design D8; spec "Search,
 * filters, focus and paths"): node types, edge types and layers can be hidden.
 *   - Node types and layers are kept as the sets that are hidden.
 *   - Edge types are kept as the set that is shown, or null for the default:
 *     a level draws `imports`, `calls` and `exports`; a focus view draws every
 *     type, since there the edges to one node are the point.
 *   - `contains` is nesting at a level, never a line, so it is a choice only
 *     in a focus view.
 * The count the filter button shows is the number of choices that are off.
 */

import type { GraphEdge, GraphNode } from '../data/graph';
import { DEFAULT_EDGE_TYPES } from './graph-edges';
import type { Structure } from './graph-structure';

export interface GraphFilters {
  /** Node types that are hidden. */
  nodeTypes: ReadonlySet<string>;
  /** Edge types that are shown; null is the default of the view. */
  edgeTypes: ReadonlySet<string> | null;
  /** Layer (group) keys that are hidden. */
  layers: ReadonlySet<string>;
}

export const NO_FILTERS: GraphFilters = { nodeTypes: new Set(), edgeTypes: null, layers: new Set() };

/** What the filters can choose from, in this graph. */
export interface FilterChoices {
  nodeTypes: readonly string[];
  edgeTypes: readonly string[];
  layers: readonly { key: string; label: string }[];
}

/** What this graph has to choose from: its node types and edge types, and its layers when it is grouped by layer. */
export function filterChoices(nodes: Iterable<GraphNode>, edges: readonly GraphEdge[], structure: Pick<Structure, 'mode' | 'groups'>): FilterChoices {
  const nodeTypes = new Set<string>();
  for (const node of nodes) nodeTypes.add(node.type);
  const edgeTypes = new Set<string>();
  for (const edge of edges) edgeTypes.add(edge.type);
  return {
    nodeTypes: [...nodeTypes].sort(),
    edgeTypes: [...edgeTypes].sort(),
    layers: structure.mode === 'layers' ? structure.groups.map((group) => ({ key: group.key, label: group.label })) : [],
  };
}

/** The edge types the filter lists: all of them in a focus view, and in a level without `contains`, which is nesting. */
export function filterableEdgeTypes(edgeTypes: readonly string[], focus: boolean): string[] {
  return edgeTypes.filter((type) => focus || type !== 'contains');
}

/** The edge types drawn under `filters` (the default of the view when none were chosen). */
export function shownEdgeTypes(filters: GraphFilters, edgeTypes: readonly string[], focus: boolean): Set<string> {
  const listed = filterableEdgeTypes(edgeTypes, focus);
  if (filters.edgeTypes !== null) return new Set(listed.filter((type) => filters.edgeTypes?.has(type)));
  return new Set(focus ? listed : listed.filter((type) => DEFAULT_EDGE_TYPES.has(type)));
}

/** How many choices are off: hidden node types and layers the graph has, and edge types it has that are not shown. */
export function hiddenCount(filters: GraphFilters, choices: FilterChoices, focus: boolean): number {
  const nodeTypes = choices.nodeTypes.filter((type) => filters.nodeTypes.has(type)).length;
  const layers = choices.layers.filter((layer) => filters.layers.has(layer.key)).length;
  const listed = filterableEdgeTypes(choices.edgeTypes, focus);
  const shown = shownEdgeTypes(filters, choices.edgeTypes, focus);
  return nodeTypes + layers + listed.filter((type) => !shown.has(type)).length;
}

const flip = (set: ReadonlySet<string>, value: string): Set<string> => {
  const next = new Set(set);
  if (!next.delete(value)) next.add(value);
  return next;
};

export const toggleNodeType = (filters: GraphFilters, type: string): GraphFilters => ({ ...filters, nodeTypes: flip(filters.nodeTypes, type) });

export const toggleLayer = (filters: GraphFilters, key: string): GraphFilters => ({ ...filters, layers: flip(filters.layers, key) });

/** Toggle an edge type; the first choice turns the view's default into an explicit set. */
export function toggleEdgeType(filters: GraphFilters, type: string, edgeTypes: readonly string[], focus: boolean): GraphFilters {
  return { ...filters, edgeTypes: flip(shownEdgeTypes(filters, edgeTypes, focus), type) };
}
