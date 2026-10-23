import { describe, expect, it } from "vitest";
import { fileNodeId, locate, NO_SINGLE_NODE, NOT_IN_GRAPH } from "../graphTarget";

const ids = new Set(["file:src/a.js", "function:src/a.js:run", "file:src/dir/b.js"]);

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
