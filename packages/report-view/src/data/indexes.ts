/**
 * Indexes over a parsed knowledge graph (openspec: changes/viewer-app, design
 * D3): nodes by id and by file path, incoming and outgoing edges per node,
 * and each node's owning file node.
 *
 * The owning file is found by walking `contains` edges backwards until a node
 * of type `file`; a node with no such chain falls back to `file:<filePath>`.
 * A node with neither has no owning file and is listed in `unowned`, as are
 * repeated node ids and edges whose ends are not nodes of the graph.
 *
 * When the Full-mode semantic payload is given (design D11), each node's
 * summary and tags and the layers are merged in `semantics`; see mergeSemantics.
 */

import type { GraphEdge, GraphNode, ParsedGraph } from './graph';
import { mergeSemantics, type MergedSemantics, type SemanticPayload } from './semantics';

export const FILE_NODE_PREFIX = 'file:';

export interface GraphIndex {
  nodesById: Map<string, GraphNode>;
  /** Every node whose `filePath` is the key, in graph order. */
  nodesByFilePath: Map<string, GraphNode[]>;
  outEdges: Map<string, GraphEdge[]>;
  inEdges: Map<string, GraphEdge[]>;
  /** Node id to the id of the file node that owns it; a file node owns itself. */
  owningFile: Map<string, string>;
  /** Ids of nodes with no owning file node. */
  unowned: string[];
  /** Node ids that occur more than once; the first occurrence is the one indexed. */
  duplicateNodeIds: string[];
  /** Edges with an end that is not a node of the graph (still in the edge tables). */
  danglingEdges: GraphEdge[];
  /** Summary, tags and layers, semantic payload first and the graph's own fields second. */
  semantics: MergedSemantics;
}

/** The id of the file node for `path`. */
export function fileNodeId(path: string): string {
  return `${FILE_NODE_PREFIX}${path}`;
}

function push<T>(map: Map<string, T[]>, key: string, value: T) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function buildIndex(graph: Pick<ParsedGraph, 'nodes' | 'edges'> & Partial<Pick<ParsedGraph, 'layers'>>, semantics?: SemanticPayload | null): GraphIndex {
  const nodesById = new Map<string, GraphNode>();
  const nodesByFilePath = new Map<string, GraphNode[]>();
  const duplicates = new Set<string>();
  for (const node of graph.nodes) {
    if (nodesById.has(node.id)) {
      duplicates.add(node.id);
      continue;
    }
    nodesById.set(node.id, node);
    if (typeof node.filePath === 'string' && node.filePath !== '') push(nodesByFilePath, node.filePath, node);
  }

  const outEdges = new Map<string, GraphEdge[]>();
  const inEdges = new Map<string, GraphEdge[]>();
  const containers = new Map<string, string[]>();
  const danglingEdges: GraphEdge[] = [];
  for (const edge of graph.edges) {
    push(outEdges, edge.source, edge);
    push(inEdges, edge.target, edge);
    if (!nodesById.has(edge.source) || !nodesById.has(edge.target)) danglingEdges.push(edge);
    else if (edge.type === 'contains') push(containers, edge.target, edge.source);
  }

  // Memo of the walk alone (never of the filePath fallback), so a node's owner does not depend on visiting order.
  const chainFile = new Map<string, string | null>();
  const resolving = new Set<string>();
  /** The file node above `id` through `contains` edges, first container first; null when none. */
  const fileAbove = (id: string): string | null => {
    const node = nodesById.get(id);
    if (!node) return null;
    if (node.type === 'file') return id;
    const known = chainFile.get(id);
    if (known !== undefined) return known;
    if (resolving.has(id)) return null;
    resolving.add(id);
    let found: string | null = null;
    for (const parent of containers.get(id) ?? []) {
      found = fileAbove(parent);
      if (found) break;
    }
    resolving.delete(id);
    chainFile.set(id, found);
    return found;
  };

  const owningFile = new Map<string, string>();
  const unowned: string[] = [];
  for (const node of nodesById.values()) {
    let owner = fileAbove(node.id);
    if (!owner && typeof node.filePath === 'string' && nodesById.get(fileNodeId(node.filePath))?.type === 'file') {
      owner = fileNodeId(node.filePath);
    }
    if (owner) owningFile.set(node.id, owner);
    else unowned.push(node.id);
  }

  return {
    nodesById,
    nodesByFilePath,
    outEdges,
    inEdges,
    owningFile,
    unowned,
    duplicateNodeIds: [...duplicates],
    danglingEdges,
    semantics: mergeSemantics(graph.nodes, graph.layers ?? [], semantics),
  };
}
