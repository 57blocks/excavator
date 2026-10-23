/**
 * Where a table row's node is in the graph (openspec: changes/explorer-products,
 * design D4). The mapping is the report view's: an unused row's `id` is a node id,
 * a hotspots or doc-map file path is the file node `file:<path>`, and a directory
 * has no single node. A row whose node the graph does not have gets a message
 * instead of a button.
 */

export type GraphTarget =
  | { kind: "node"; nodeId: string }
  | { kind: "file"; path: string }
  | { kind: "directory"; path: string };

/** What the view says beside a row whose node the graph does not have. */
export const NOT_IN_GRAPH = "Not in the graph.";
/** What it says beside a directory row. */
export const NO_SINGLE_NODE = "No single node of the graph stands for this directory.";

export type Located = { kind: "node"; nodeId: string } | { kind: "message"; message: string };

export const fileNodeId = (path: string): string => `file:${path}`;

/** The node the row stands for when `nodeIds` (the knowledge graph's nodes) holds it, else the message to show. */
export function locate(target: GraphTarget, nodeIds: ReadonlySet<string>): Located {
  if (target.kind === "directory") return { kind: "message", message: NO_SINGLE_NODE };
  const nodeId = target.kind === "file" ? fileNodeId(target.path) : target.nodeId;
  return nodeIds.has(nodeId) ? { kind: "node", nodeId } : { kind: "message", message: NOT_IN_GRAPH };
}
