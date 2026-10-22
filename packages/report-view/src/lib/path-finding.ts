/**
 * The shortest path between two nodes (openspec: changes/viewer-app, design D8;
 * spec "Search, filters, focus and paths"): breadth first search along the
 * graph's edges of every type. The path can follow each edge either way
 * (undirected, the default) or only from source to target (directed). It
 * returns the nodes and the edge used between each two of them, or null when
 * the second node cannot be reached.
 */

import type { GraphEdge } from '../data/graph';
import type { GraphIndex } from '../data/indexes';

export interface GraphPath {
  nodes: string[];
  /** `edges[i]` joins `nodes[i]` and `nodes[i + 1]`. */
  edges: GraphEdge[];
}

export function shortestPath(index: Pick<GraphIndex, 'nodesById' | 'outEdges' | 'inEdges'>, from: string, to: string, { directed = false }: { directed?: boolean } = {}): GraphPath | null {
  if (!index.nodesById.has(from) || !index.nodesById.has(to)) return null;
  if (from === to) return { nodes: [from], edges: [] };
  const reached = new Map<string, { parent: string; edge: GraphEdge } | null>([[from, null]]);
  let frontier = [from];
  while (frontier.length > 0 && !reached.has(to)) {
    const next: string[] = [];
    for (const id of frontier) {
      const steps: [string, GraphEdge][] = [];
      for (const edge of index.outEdges.get(id) ?? []) steps.push([edge.target, edge]);
      if (!directed) for (const edge of index.inEdges.get(id) ?? []) steps.push([edge.source, edge]);
      for (const [other, edge] of steps) {
        if (reached.has(other) || !index.nodesById.has(other)) continue;
        reached.set(other, { parent: id, edge });
        next.push(other);
      }
    }
    frontier = next;
  }
  if (!reached.has(to)) return null;
  const nodes = [to];
  const edges: GraphEdge[] = [];
  for (let at = reached.get(to); at; at = reached.get(at.parent)) {
    nodes.push(at.parent);
    edges.push(at.edge);
  }
  return { nodes: nodes.reverse(), edges: edges.reverse() };
}
