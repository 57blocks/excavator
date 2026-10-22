/**
 * The edges at one node, as the sidebar lists them (openspec: changes/viewer-app,
 * design D5): outgoing and incoming, each grouped by edge type, largest group
 * first, and inside a group by the name of the node at the other end. An edge
 * whose other end is not a node of the graph stays in the list with no node.
 */

import type { GraphEdge, GraphNode } from '../data/graph';
import type { GraphIndex } from '../data/indexes';

export interface EdgeEnd {
  edge: GraphEdge;
  /** The id at the other end of the edge. */
  otherId: string;
  /** The node at the other end; null when the graph has no such node. */
  other: GraphNode | null;
}

export interface EdgeGroup {
  type: string;
  ends: EdgeEnd[];
}

export interface NodeEdges {
  out: EdgeGroup[];
  in: EdgeGroup[];
  outTotal: number;
  inTotal: number;
}

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function groupEnds(edges: readonly GraphEdge[], otherOf: (edge: GraphEdge) => string, index: Pick<GraphIndex, 'nodesById'>): EdgeGroup[] {
  const groups = new Map<string, EdgeEnd[]>();
  for (const edge of edges) {
    const otherId = otherOf(edge);
    const end: EdgeEnd = { edge, otherId, other: index.nodesById.get(otherId) ?? null };
    const list = groups.get(edge.type);
    if (list) list.push(end);
    else groups.set(edge.type, [end]);
  }
  return [...groups]
    .map(([type, ends]) => ({ type, ends: ends.sort((a, b) => byText(a.other?.name ?? a.otherId, b.other?.name ?? b.otherId) || byText(a.otherId, b.otherId)) }))
    .sort((a, b) => b.ends.length - a.ends.length || byText(a.type, b.type));
}

/** The outgoing and incoming edges of `nodeId`, grouped by type. */
export function nodeEdges(index: Pick<GraphIndex, 'nodesById' | 'outEdges' | 'inEdges'>, nodeId: string): NodeEdges {
  const out = index.outEdges.get(nodeId) ?? [];
  const into = index.inEdges.get(nodeId) ?? [];
  return {
    out: groupEnds(out, (edge) => edge.target, index),
    in: groupEnds(into, (edge) => edge.source, index),
    outTotal: out.length,
    inTotal: into.length,
  };
}
