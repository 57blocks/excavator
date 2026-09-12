import type { KnowledgeGraph, GraphNode, GraphEdge, Layer, ProjectMeta } from "../types.js";
import { validateGraph, type ValidationResult } from "../schema.js";

export interface DesignAnalysis {
  nodes?: Array<Pick<GraphNode, "id"> & Partial<Pick<GraphNode, "summary" | "tags">>>;
  edges?: GraphEdge[];
}

const DS_TYPES = new Set<GraphNode["type"]>(["component", "componentSet", "token"]);

export function mergeDesignGraph(
  manifest: { nodes: GraphNode[]; edges: GraphEdge[] },
  analyses: DesignAnalysis[],
  project: ProjectMeta,
): ValidationResult {
  // 1. index manifest nodes (clone so we can enrich)
  const byId = new Map<string, GraphNode>();
  for (const n of manifest.nodes) byId.set(n.id, { ...n });
  const edges: GraphEdge[] = [...manifest.edges];

  // 2. apply LLM enrichment; design-analyzer must not invent structural nodes
  for (const a of analyses) {
    for (const patch of a.nodes ?? []) {
      const base = byId.get(patch.id);
      if (!base) continue;
      if (patch.summary) base.summary = patch.summary;
      if (patch.tags && patch.tags.length) base.tags = patch.tags;
    }
    for (const e of a.edges ?? []) edges.push(e);
  }
  const nodes = [...byId.values()];

  // 3. layers: one per page (+ descendants), plus a Design System layer
  const parent = new Map<string, string>();
  for (const e of manifest.edges) if (e.type === "contains") parent.set(e.target, e.source);
  const pageOf = (id: string): string | undefined => {
    let cur: string | undefined = id;
    const guard = new Set<string>();
    while (cur && !guard.has(cur)) {
      guard.add(cur);
      if (byId.get(cur)?.type === "page") return cur;
      cur = parent.get(cur);
    }
    return undefined;
  };
  const layerMap = new Map<string, string[]>();
  const ds: string[] = [];
  for (const n of nodes) {
    if (DS_TYPES.has(n.type)) { ds.push(n.id); continue; }
    const key = n.type === "page" ? n.id : (pageOf(n.id) ?? "layer:unscoped");
    if (!layerMap.has(key)) layerMap.set(key, []);
    layerMap.get(key)!.push(n.id);
  }
  const layers: Layer[] = [];
  for (const [pageId, ids] of layerMap) {
    const pageNode = byId.get(pageId);
    layers.push({
      id: `layer:${pageId}`,
      name: pageNode?.name ?? "Unscoped",
      description: pageNode ? `Figma page: ${pageNode.name}` : "Nodes not under a page",
      nodeIds: ids,
    });
  }
  if (ds.length) {
    layers.push({ id: "layer:design-system", name: "Design System", description: "Components, variants, and design tokens", nodeIds: ds });
  }

  // 4. assemble the service graph. The compatibility field stays empty;
  // presentation tours are no longer generated.
  const graph: KnowledgeGraph = { version: "1.0.0", kind: "design", project, nodes, edges, layers, tour: [] };
  const result = validateGraph(graph);
  if (result.success && result.data) {
    (result.data as KnowledgeGraph).kind = "design";
  }
  return result;
}
