import { describe, expect, it } from "vitest";
import type { GraphEdge, GraphNode, KnowledgeGraph } from "../../core/types";
import { withDerivedGroups } from "../groups";

const file = (path: string): GraphNode => ({ id: `file:${path}`, type: "file", name: path.split("/").pop()!, filePath: path, summary: "", tags: [], complexity: "simple" });
const fn = (path: string, name: string): GraphNode => ({ id: `function:${path}:${name}`, type: "function", name, filePath: path, summary: "", tags: [], complexity: "simple" });
const edge = (source: string, target: string, type: GraphEdge["type"]): GraphEdge => ({ source, target, type, direction: "forward", weight: 0.5 });

function graphOf(nodes: GraphNode[], edges: GraphEdge[] = [], layers: KnowledgeGraph["layers"] = []): KnowledgeGraph {
  return {
    version: "1.0.0",
    project: { name: "fixture", languages: [], frameworks: [], description: "", analyzedAt: "", gitCommitHash: "" },
    nodes,
    edges,
    layers,
    tour: [],
  };
}

/** Every top-level node id, in group order, with the group it is in. */
const membership = (layers: KnowledgeGraph["layers"]) => layers.flatMap((layer) => layer.nodeIds.map((id) => [id, layer.name]));

describe("withDerivedGroups", () => {
  it("leaves a graph that has layers as it is", () => {
    const graph = graphOf([file("a/x.ts")], [], [{ id: "layer:app", name: "App", description: "", nodeIds: ["file:a/x.ts"] }]);
    const result = withDerivedGroups(graph);
    expect(result.graph).toBe(graph);
    expect(result.layerSource).toBe("graph");
  });

  it("groups the top-level nodes by folder, leaves contained nodes out, and does not change the graph passed in", () => {
    const nodes = [file("a/x.ts"), file("a/y.ts"), file("c/w.ts"), file("c/v.ts"), fn("a/x.ts", "run")];
    const graph = graphOf(nodes, [edge("file:a/x.ts", "function:a/x.ts:run", "contains")]);
    const result = withDerivedGroups(graph);
    expect(result.layerSource).toBe("folder");
    expect(result.graph.layers.map((layer) => [layer.id, layer.name])).toEqual([["group:a", "a/"], ["group:c", "c/"]]);
    expect(membership(result.graph.layers)).toEqual([
      ["file:a/x.ts", "a/"], ["file:a/y.ts", "a/"], ["file:c/w.ts", "c/"], ["file:c/v.ts", "c/"],
    ]);
    expect(result.graph.layers[0].description).toBe("This graph has no layers; its top-level nodes are grouped by folder.");
    expect(graph.layers).toEqual([]);
  });

  it("puts nodes at the root and nodes of a one-node folder into the root group, so each top-level node is in exactly one group", () => {
    const nodes = [file("a/x.ts"), file("a/y.ts"), file("b/z.ts"), file("c/w.ts"), file("c/v.ts"), file("README.md")];
    const result = withDerivedGroups(graphOf(nodes));
    expect(result.graph.layers.map((layer) => layer.name)).toEqual(["a/", "c/", "~"]);
    expect(result.graph.layers.find((layer) => layer.name === "~")!.nodeIds.sort()).toEqual(["file:README.md", "file:b/z.ts"]);
    const ids = result.graph.layers.flatMap((layer) => layer.nodeIds).sort();
    expect(ids).toEqual(nodes.map((node) => node.id).sort());
  });

  it("groups by connections when the folders do not split the nodes, and says so", () => {
    const nodes = ["x", "y", "p", "q"].map((name) => file(`src/${name}.ts`));
    const edges = [
      edge("file:src/x.ts", "file:src/y.ts", "imports"),
      edge("file:src/y.ts", "file:src/x.ts", "imports"),
      edge("file:src/p.ts", "file:src/q.ts", "imports"),
      edge("file:src/q.ts", "file:src/p.ts", "imports"),
    ];
    const result = withDerivedGroups(graphOf(nodes, edges));
    expect(result.layerSource).toBe("community");
    expect(result.graph.layers.every((layer) => !layer.name.endsWith("/"))).toBe(true);
    expect(result.graph.layers[0].description).toBe("This graph has no layers; its top-level nodes are grouped by the connections between its nodes.");
    expect(result.graph.layers.flatMap((layer) => layer.nodeIds).sort()).toEqual(nodes.map((node) => node.id).sort());
  });
});
