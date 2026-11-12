import { describe, it, expect } from "vitest";
import { diffContainerIds } from "../diffContainers";

const nodesById = new Map<string, { filePath?: string }>([
  ["file:a.ts", { filePath: "a.ts" }],
  ["fn:a.ts:f", { filePath: "a.ts" }],
  ["file:b.ts", { filePath: "b.ts" }],
  ["file:solo.ts", { filePath: "solo.ts" }],
  ["fn:other.ts:h", { filePath: "other.ts" }],
]);
const nodeToContainer = new Map<string, string>([
  ["file:a.ts", "dir:src"],
  ["file:b.ts", "dir:lib"],
  ["file:solo.ts", "file:solo.ts"],
]);

describe("diffContainerIds", () => {
  it("maps a drawn node through nodeToContainer", () => {
    const r = diffContainerIds(new Set(["file:a.ts"]), new Set(["file:b.ts"]), nodeToContainer, nodesById);
    expect([...r].sort()).toEqual(["dir:lib", "dir:src"]);
  });

  it("resolves an undrawn function node through the container of a node sharing its filePath", () => {
    const r = diffContainerIds(new Set(["fn:a.ts:f"]), new Set(), nodeToContainer, nodesById);
    expect([...r]).toEqual(["dir:src"]);
  });

  it("ignores nodes that are unknown or whose filePath matches no drawn node", () => {
    const r = diffContainerIds(new Set(["nope", "fn:other.ts:h"]), new Set(["nope2"]), nodeToContainer, nodesById);
    expect(r.size).toBe(0);
  });

  it("does not count a node whose own id is its container", () => {
    const r = diffContainerIds(new Set(["file:solo.ts"]), new Set(), nodeToContainer, nodesById);
    expect(r.size).toBe(0);
  });
});
