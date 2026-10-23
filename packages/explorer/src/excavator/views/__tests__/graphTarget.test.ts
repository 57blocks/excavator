import { describe, expect, it } from "vitest";
import { containersOf, drawnInLayer, fileNodeId, locate, NO_SINGLE_NODE, NOT_DRAWN, NOT_IN_GRAPH, type GraphIndex } from "../graphTarget";

const nodeIds = new Set(["file:src/a.js", "function:src/a.js:run", "file:src/dir/b.js"]);
// Every node drawn: the case of a layer that lists functions too.
const ids: GraphIndex = { nodeIds, drawn: nodeIds, parentOf: new Map() };

describe("locate: the node a table row stands for", () => {
  it("takes the unused id as the node id", () => {
    expect(locate({ kind: "node", nodeId: "function:src/a.js:run" }, ids)).toEqual({ kind: "node", nodeId: "function:src/a.js:run" });
  });

  it("maps a file path to the file node", () => {
    expect(fileNodeId("src/a.js")).toBe("file:src/a.js");
    expect(locate({ kind: "file", path: "src/a.js" }, ids)).toEqual({ kind: "node", nodeId: "file:src/a.js" });
  });

  it("says not in the graph when the node is absent, for a node id and for a file", () => {
    expect(locate({ kind: "node", nodeId: "function:src/gone.js:x" }, ids)).toEqual({ kind: "message", message: NOT_IN_GRAPH });
    expect(locate({ kind: "file", path: "src/gone.js" }, ids)).toEqual({ kind: "message", message: NOT_IN_GRAPH });
    expect(NOT_IN_GRAPH).toBe("Not in the graph.");
  });

  it("gives a directory no node, even when files under it are in the graph", () => {
    expect(locate({ kind: "directory", path: "src/dir" }, ids)).toEqual({ kind: "message", message: NO_SINGLE_NODE });
    expect(NO_SINGLE_NODE).toBe("No single node of the graph stands for this directory.");
  });

  it("does not take a path for a node id (a file path is not an id)", () => {
    expect(locate({ kind: "node", nodeId: "src/a.js" }, ids)).toEqual({ kind: "message", message: NOT_IN_GRAPH });
  });
});

describe("locate: a node the structural view does not draw", () => {
  const edges = [
    { type: "contains", source: "file:src/a.js", target: "class:src/a.js:Box" },
    { type: "contains", source: "class:src/a.js:Box", target: "function:src/a.js:Box.open" },
    { type: "contains", source: "file:src/a.js", target: "function:src/a.js:run" },
    { type: "calls", source: "function:src/a.js:run", target: "function:src/b.js:helper" },
    { type: "contains", source: "function:src/c.js:x", target: "function:src/c.js:y" },
    { type: "contains", source: "function:src/c.js:y", target: "function:src/c.js:x" },
  ];
  const all = new Set(["file:src/a.js", "class:src/a.js:Box", "function:src/a.js:Box.open", "function:src/a.js:run", "file:src/b.js", "function:src/b.js:helper", "function:src/c.js:x", "function:src/c.js:y"]);
  // Layers that list only files, as the file level draws them.
  const files: GraphIndex = { nodeIds: all, drawn: new Set(["file:src/a.js", "file:src/b.js"]), parentOf: containersOf(edges) };

  it("selects the file that contains a function", () => {
    expect(locate({ kind: "node", nodeId: "function:src/a.js:run" }, files)).toEqual({ kind: "container", nodeId: "file:src/a.js", of: "function:src/a.js:run" });
  });

  it("climbs through a class to its file", () => {
    expect(locate({ kind: "node", nodeId: "function:src/a.js:Box.open" }, files)).toEqual({ kind: "container", nodeId: "file:src/a.js", of: "function:src/a.js:Box.open" });
  });

  it("does not take a call for containment", () => {
    expect(locate({ kind: "node", nodeId: "function:src/b.js:helper" }, files)).toEqual({ kind: "message", message: NOT_DRAWN });
  });

  it("ends on a containment loop with the message", () => {
    expect(locate({ kind: "node", nodeId: "function:src/c.js:x" }, files)).toEqual({ kind: "message", message: NOT_DRAWN });
  });

  it("still selects a drawn node itself", () => {
    expect(locate({ kind: "file", path: "src/a.js" }, files)).toEqual({ kind: "node", nodeId: "file:src/a.js" });
  });
});

describe("drawnInLayer: the rule the layer view draws a listed node by", () => {
  const visible = new Set(["file", "function", "class", "config"]);

  it("draws functions and classes for the technical personas", () => {
    expect(drawnInLayer("function", "junior", visible)).toBe(true);
    expect(drawnInLayer("class", "experienced", visible)).toBe(true);
  });

  it("draws no function or class in Overview, but still files", () => {
    expect(drawnInLayer("function", "non-technical", visible)).toBe(false);
    expect(drawnInLayer("class", "non-technical", visible)).toBe(false);
    expect(drawnInLayer("file", "non-technical", visible)).toBe(true);
  });

  it("draws no type outside the visible ones", () => {
    expect(drawnInLayer("table", "junior", visible)).toBe(false);
  });
});
