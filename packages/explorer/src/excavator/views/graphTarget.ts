/**
 * Where a table row's node is in the graph (openspec: changes/explorer-products,
 * design D4). The mapping is the report view's: an unused row's `id` is a node id,
 * a hotspots or doc-map file path is the file node `file:<path>`, and a directory
 * has no single node. A row whose node the graph does not have gets a message
 * instead of a button. The structural view draws only the nodes a layer lists
 * (files, at the fixed file level), so a node no layer lists is shown through the
 * nearest node that contains it and is drawn.
 */

export type GraphTarget =
  | { kind: "node"; nodeId: string }
  | { kind: "file"; path: string }
  | { kind: "directory"; path: string };

/** What the view says beside a row whose node the graph does not have. */
export const NOT_IN_GRAPH = "Not in the graph.";
/** What it says beside a directory row. */
export const NO_SINGLE_NODE = "No single node of the graph stands for this directory.";

export type Located =
  | { kind: "node"; nodeId: string }
  | { kind: "container"; nodeId: string; of: string }
  | { kind: "message"; message: string };

/** What the view says when a row's node and everything containing it are in no layer. */
export const NOT_DRAWN = "In the graph, but no layer draws it or a node that contains it.";

export const fileNodeId = (path: string): string => `file:${path}`;

const SUB_FILE_TYPES = new Set(["function", "class"]);

/**
 * Whether the layer view draws a node of this type that its layer lists: one of
 * `visibleTypes`, and no function or class for the non-technical persona
 * (Overview). GraphView filters a layer's nodes by this rule, so a row's node is
 * judged drawn exactly when the graph draws it.
 */
export function drawnInLayer(type: string, persona: string, visibleTypes: ReadonlySet<string>): boolean {
  return visibleTypes.has(type) && !(persona === "non-technical" && SUB_FILE_TYPES.has(type));
}

/** The nodes of the graph as the structural view draws them. */
export type GraphIndex = {
  /** Every node id of the knowledge graph. */
  nodeIds: ReadonlySet<string>;
  /** The node ids the structural view draws: listed by a layer and passing `drawnInLayer`. */
  drawn: ReadonlySet<string>;
  /** A node's container: the source of a `contains` edge that points at it. */
  parentOf: ReadonlyMap<string, string>;
};

/** The parent map of a graph's `contains` edges; a node with two containers keeps the first. */
export function containersOf(edges: ReadonlyArray<{ type: string; source: string; target: string }>): Map<string, string> {
  const parentOf = new Map<string, string>();
  for (const edge of edges) if (edge.type === "contains" && !parentOf.has(edge.target)) parentOf.set(edge.target, edge.source);
  return parentOf;
}

/**
 * The node to select for a row: the row's own node when a layer draws it, else
 * the nearest drawn node containing it, else the message to show.
 */
export function locate(target: GraphTarget, graph: GraphIndex): Located {
  if (target.kind === "directory") return { kind: "message", message: NO_SINGLE_NODE };
  const nodeId = target.kind === "file" ? fileNodeId(target.path) : target.nodeId;
  if (!graph.nodeIds.has(nodeId)) return { kind: "message", message: NOT_IN_GRAPH };
  if (graph.drawn.has(nodeId)) return { kind: "node", nodeId };
  const seen = new Set([nodeId]);
  for (let up = graph.parentOf.get(nodeId); up !== undefined && !seen.has(up); up = graph.parentOf.get(up)) {
    if (graph.drawn.has(up)) return { kind: "container", nodeId: up, of: nodeId };
    seen.add(up);
  }
  return { kind: "message", message: NOT_DRAWN };
}
