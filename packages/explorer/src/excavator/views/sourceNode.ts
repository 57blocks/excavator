import type { GraphNode } from "../../core/types";

/**
 * A node for the code viewer to show a file that no graph node stands for
 * (openspec: changes/explorer-products, design D4): a product row's file need not
 * be in the knowledge graph, and its source is inlined by path. The viewer reads
 * `filePath` and `lineRange` of the node it is given, so this carries just those.
 */

export interface SourceTarget {
  path: string;
  range: [number, number] | null;
}

export const sourceNodeId = (path: string): string => `source:${path}`;

export function sourceNode(target: SourceTarget): GraphNode {
  return {
    id: sourceNodeId(target.path),
    type: "file",
    name: target.path.split("/").pop() || target.path,
    summary: "",
    tags: [],
    complexity: "simple",
    filePath: target.path,
    ...(target.range ? { lineRange: target.range } : {}),
  };
}
