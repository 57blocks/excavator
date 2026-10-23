import { beforeEach, describe, expect, it } from "vitest";
import type { GraphNode, KnowledgeGraph } from "../../core/types";
import { useDashboardStore } from "../../store";
import { escapeProductView } from "../escape";
import { sourceNode, sourceNodeId } from "../views/sourceNode";

const node = (id: string, filePath?: string): GraphNode => ({ id, type: "file", name: id, summary: "", tags: [], complexity: "simple", ...(filePath ? { filePath } : {}) });

function graph(): KnowledgeGraph {
  return {
    version: "1.0.0",
    project: { name: "fixture", languages: [], frameworks: [], description: "", analyzedAt: "2026-07-03T00:00:00.000Z", gitCommitHash: "test" },
    nodes: [node("a1"), node("b1")],
    edges: [],
    layers: [
      { id: "layer:a", name: "A", description: "", nodeIds: ["a1"] },
      { id: "layer:b", name: "B", description: "", nodeIds: ["b1"] },
    ],
    tour: [],
  };
}

beforeEach(() => {
  useDashboardStore.setState(useDashboardStore.getInitialState(), true);
});

describe("a node chosen from outside the view closes the view", () => {
  it("closes the product view and forgets the row when a node is navigated to (a search result, the file list, Show in graph)", () => {
    useDashboardStore.getState().setGraph(graph());
    useDashboardStore.getState().openProductView("unused");
    useDashboardStore.getState().setProductRow({ id: "a1" });
    useDashboardStore.getState().navigateToNodeInLayer("b1");
    const s = useDashboardStore.getState();
    expect(s.productView).toBeNull();
    expect(s.productRow).toBeNull();
    expect(s.selectedNodeId).toBe("b1");
    expect(s.activeLayerId).toBe("layer:b");
    // The structural view opens the node's container and fits it.
    expect(s.revealNodeId).toBe("b1");
    s.clearRevealNode();
    expect(useDashboardStore.getState().revealNodeId).toBeNull();
  });

  it("asks for no reveal when a node is selected in the graph itself", () => {
    useDashboardStore.getState().setGraph(graph());
    useDashboardStore.getState().selectNode("b1");
    expect(useDashboardStore.getState().revealNodeId).toBeNull();
  });

  it("closes it also for a node that no layer holds", () => {
    useDashboardStore.getState().setGraph(graph());
    useDashboardStore.getState().openProductView("hotspots");
    useDashboardStore.getState().navigateToNodeInLayer("orphan");
    const s = useDashboardStore.getState();
    expect(s.productView).toBeNull();
    expect(s.selectedNodeId).toBe("orphan");
  });
});

describe("opening a source by path", () => {
  it("opens the code viewer on a file with the lines to mark, without a graph node", () => {
    useDashboardStore.getState().openCodeViewerAt("src/a.js", [3, 5]);
    const s = useDashboardStore.getState();
    expect(s.codeViewerOpen).toBe(true);
    expect(s.codeViewerNodeId).toBe(sourceNodeId("src/a.js"));
    expect(s.codeViewerSource).toEqual({ path: "src/a.js", range: [3, 5] });
    useDashboardStore.getState().closeCodeViewer();
    expect(useDashboardStore.getState().codeViewerSource).toBeNull();
  });

  it("makes a viewer node that carries the path and the lines", () => {
    const n = sourceNode({ path: "src/dir/a.js", range: [3, 5] });
    expect(n).toMatchObject({ id: sourceNodeId("src/dir/a.js"), filePath: "src/dir/a.js", name: "a.js", lineRange: [3, 5] });
    expect(sourceNode({ path: "x.md", range: null }).lineRange).toBeUndefined();
  });
});

describe("Escape in a product view", () => {
  it("clears the row first, then closes the view, then leaves the rest alone", () => {
    useDashboardStore.getState().openProductView("unused");
    useDashboardStore.getState().setProductRow({ id: "a1" });
    expect(escapeProductView(useDashboardStore.getState())).toBe(true);
    expect(useDashboardStore.getState().productRow).toBeNull();
    expect(useDashboardStore.getState().productView).toBe("unused");
    expect(escapeProductView(useDashboardStore.getState())).toBe(true);
    expect(useDashboardStore.getState().productView).toBeNull();
    expect(escapeProductView(useDashboardStore.getState())).toBe(false);
  });
});
