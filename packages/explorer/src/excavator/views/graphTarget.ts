/**
 * Which nodes the structural view draws: the nodes a layer lists (files, at the fixed file level), never functions
 * or classes, and a node's container from the graph's `contains` edges.
 */

const SUB_FILE_TYPES = new Set(["function", "class"]);

/**
 * Whether the layer view draws a node of this type that its layer lists: one of
 * `visibleTypes`, and never a function or class (the graph draws files). GraphView
 * filters a layer's nodes by this rule, so a node is judged drawn exactly when the
 * graph draws it.
 */
export function drawnInLayer(type: string, visibleTypes: ReadonlySet<string>): boolean {
  return visibleTypes.has(type) && !SUB_FILE_TYPES.has(type);
}

/** The parent map of a graph's `contains` edges; a node with two containers keeps the first. */
export function containersOf(edges: ReadonlyArray<{ type: string; source: string; target: string }>): Map<string, string> {
  const parentOf = new Map<string, string>();
  for (const edge of edges) if (edge.type === "contains" && !parentOf.has(edge.target)) parentOf.set(edge.target, edge.source);
  return parentOf;
}
