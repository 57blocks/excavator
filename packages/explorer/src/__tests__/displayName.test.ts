import { describe, it, expect } from "vitest";
import { nodeTitles } from "../excavator/nodeTitle";
import { SearchEngine } from "../core/search";
import type { GraphNode } from "../core/types";

const node = (over: Partial<GraphNode>): GraphNode => ({
  id: "function:a.ts:approveRefund",
  type: "function",
  name: "approveRefund",
  summary: "",
  tags: [],
  complexity: "simple",
  ...over,
});

describe("nodeTitles (Excavator: displayName as the card title)", () => {
  it("uses the displayName as title and the code name as subtitle", () => {
    expect(nodeTitles(node({ displayName: "Approve refund request" }))).toEqual({
      title: "Approve refund request",
      subtitle: "approveRefund",
      original: null,
    });
  });

  it("shows the code name alone when there is no displayName or it is blank", () => {
    expect(nodeTitles(node({}))).toEqual({ title: "approveRefund", subtitle: null, original: null });
    expect(nodeTitles(node({ displayName: "  " }))).toEqual({ title: "approveRefund", subtitle: null, original: null });
  });
});

describe("SearchEngine matches displayName", () => {
  it("finds a node by a word only its displayName holds", () => {
    const engine = new SearchEngine([node({ displayName: "Approve refund request" }), node({ id: "x", name: "other" })]);
    expect(engine.search("refund").map((r) => r.nodeId)).toEqual(["function:a.ts:approveRefund"]);
    expect(engine.search("request").map((r) => r.nodeId)).toEqual(["function:a.ts:approveRefund"]);
  });
});
