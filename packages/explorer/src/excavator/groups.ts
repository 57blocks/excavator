import type { KnowledgeGraph, Layer } from "../core/types";
import { deriveContainers } from "../utils/containers";

/**
 * Where the layers the structural view draws come from (openspec:
 * changes/viewer-explorer, design D4a): the graph's own, or groups derived
 * here because the graph has none.
 */
export type LayerSource = "graph" | "folder" | "community";

const ROOT_GROUP = "~";

/**
 * The graph as the structural view needs it. The copy draws only layers at
 * the top level and nothing without them; a graph that has none (an analysis
 * that wrote no layers) gets one layer per group of its top-level nodes, the
 * nodes no `contains` edge points at, grouped by the copy's own
 * `deriveContainers`: by first folder after the common prefix, or by Louvain
 * communities when the folders do not split the nodes. Nodes it leaves
 * ungrouped go to the root group, so every top-level node is in exactly one
 * group. The graph passed in is not changed.
 */
export function withDerivedGroups(graph: KnowledgeGraph): { graph: KnowledgeGraph; layerSource: LayerSource } {
  if (graph.layers.length > 0 || graph.nodes.length === 0) return { graph, layerSource: "graph" };

  const contained = new Set(graph.edges.filter((edge) => edge.type === "contains").map((edge) => edge.target));
  const topLevel = graph.nodes.filter((node) => !contained.has(node.id));
  const topIds = new Set(topLevel.map((node) => node.id));
  const edges = graph.edges.filter((edge) => topIds.has(edge.source) && topIds.has(edge.target));
  const { containers, ungrouped } = deriveContainers(topLevel, edges);
  const strategy = containers[0]?.strategy ?? "folder";

  const groups = containers.map((container) => ({ name: container.name, nodeIds: [...container.nodeIds] }));
  if (ungrouped.length > 0) {
    const root = groups.find((group) => group.name === ROOT_GROUP);
    if (root) root.nodeIds.push(...ungrouped);
    else groups.push({ name: ROOT_GROUP, nodeIds: [...ungrouped] });
  }

  const how = strategy === "folder" ? "by folder" : "by the connections between its nodes";
  const layers: Layer[] = groups.map((group) => ({
    id: `group:${group.name}`,
    name: strategy === "folder" && group.name !== ROOT_GROUP ? `${group.name}/` : group.name,
    description: `This graph has no layers; its top-level nodes are grouped ${how}.`,
    nodeIds: group.nodeIds,
  }));
  return { graph: { ...graph, layers }, layerSource: strategy };
}
