import { describe, it, expect } from "vitest";
import { computeDiffLayerCounts } from "../diffLayerCounts";

const nodes = new Map<string, { filePath?: string }>([
  ["file:a.ts", { filePath: "a.ts" }],
  ["fn:a.ts:f", { filePath: "a.ts" }],
  ["file:b.ts", { filePath: "b.ts" }],
  ["fn:b.ts:g", { filePath: "b.ts" }],
  ["file:c.ts", { filePath: "c.ts" }],
  ["doc:readme", {}],
]);
const layers = [
  { id: "L1", nodeIds: ["file:a.ts"] },
  { id: "L2", nodeIds: ["file:b.ts", "file:c.ts", "fn:b.ts:g"] },
];

describe("computeDiffLayerCounts", () => {
  it("counts ids listed in the layer directly", () => {
    const r = computeDiffLayerCounts(layers, nodes, new Set(["file:a.ts"]), new Set(["file:c.ts"]));
    expect(r.get("L1")).toEqual({ changed: 1, affected: 0 });
    expect(r.get("L2")).toEqual({ changed: 0, affected: 1 });
  });

  it("falls back to the filePath of a layer node for nodes in no layer", () => {
    const r = computeDiffLayerCounts(layers, nodes, new Set(["fn:a.ts:f"]), new Set());
    expect(r.get("L1")).toEqual({ changed: 1, affected: 0 });
    expect(r.get("L2")).toEqual({ changed: 0, affected: 0 });
  });

  it("does not use the filePath rule for a node that is itself in a layer", () => {
    const r = computeDiffLayerCounts(
      [...layers, { id: "L3", nodeIds: ["file:a.ts", "fn:b.ts:g"] }],
      nodes,
      new Set(["fn:b.ts:g"]),
      new Set(),
    );
    expect(r.get("L2")!.changed).toBe(1);
    expect(r.get("L3")!.changed).toBe(1);
    expect(r.get("L1")!.changed).toBe(0);
  });

  it("ignores nodes with neither a layer nor a known filePath", () => {
    const r = computeDiffLayerCounts(layers, nodes, new Set(["doc:readme", "missing"]), new Set());
    expect([...r.values()]).toEqual([
      { changed: 0, affected: 0 },
      { changed: 0, affected: 0 },
    ]);
  });
});
