/**
 * The focus view's node set (openspec: changes/viewer-app, design D4, D8; spec
 * "Search, filters, focus and paths"): a node and its 1-hop neighbours, the
 * distinct nodes at the other end of its incoming and outgoing edges of the
 * shown types. A neighbour that is hidden by a filter, or that is not a node
 * of the graph, is not one. At most FOCUS_LIMIT neighbours are drawn, the
 * first by name; the count of all of them is kept, so a cut is stated and not
 * hidden.
 */

import type { GraphEdge } from '../data/graph';
import type { GraphIndex } from '../data/indexes';

/** The most neighbours the focus view draws. */
export const FOCUS_LIMIT = 400;

export interface FocusSet {
  center: string;
  /** Every neighbour, ordered by name then id. */
  neighbours: string[];
  /** The neighbours that are drawn: the first FOCUS_LIMIT of `neighbours`. */
  drawn: string[];
  /** The distinct edges among the centre and the drawn neighbours. */
  edges: GraphEdge[];
}

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function focusSet(
  index: Pick<GraphIndex, 'nodesById' | 'outEdges' | 'inEdges'>,
  center: string,
  options: { edgeTypes: ReadonlySet<string>; nodeVisible?: (nodeId: string) => boolean; limit?: number },
): FocusSet {
  const { edgeTypes, nodeVisible = () => true, limit = FOCUS_LIMIT } = options;
  const found = new Set<string>();
  const addNeighbour = (otherId: string, edge: GraphEdge) => {
    if (otherId !== center && edgeTypes.has(edge.type) && index.nodesById.has(otherId) && nodeVisible(otherId)) found.add(otherId);
  };
  for (const edge of index.outEdges.get(center) ?? []) addNeighbour(edge.target, edge);
  for (const edge of index.inEdges.get(center) ?? []) addNeighbour(edge.source, edge);

  const nameOf = (id: string) => index.nodesById.get(id)?.name ?? id;
  const neighbours = [...found].sort((a, b) => byText(nameOf(a), nameOf(b)) || byText(a, b));
  const drawn = neighbours.slice(0, limit);

  const inSet = new Set([center, ...drawn]);
  const seen = new Set<string>();
  const edges: GraphEdge[] = [];
  for (const id of inSet) {
    for (const edge of index.outEdges.get(id) ?? []) {
      if (!edgeTypes.has(edge.type) || !inSet.has(edge.target)) continue;
      const key = `${edge.source.length}:${edge.source}${edge.target.length}:${edge.target}${edge.type}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push(edge);
    }
  }
  return { center, neighbours, drawn, edges };
}
