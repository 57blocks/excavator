import { describe, expect, it } from "vitest";
import { containersOf, drawnInLayer } from "../graphTarget";

describe("drawnInLayer: the rule the layer view draws a listed node by", () => {
  const visible = new Set(["file", "function", "class", "config"]);

  it("draws no function or class, but still files and other visible types", () => {
    expect(drawnInLayer("function", visible)).toBe(false);
    expect(drawnInLayer("class", visible)).toBe(false);
    expect(drawnInLayer("file", visible)).toBe(true);
    expect(drawnInLayer("config", visible)).toBe(true);
  });

  it("draws no type outside the visible ones", () => {
    expect(drawnInLayer("table", visible)).toBe(false);
  });
});

describe("containersOf", () => {
  it("maps each contained node to its container, keeping the first container of a node", () => {
    const parentOf = containersOf([
      { type: "contains", source: "file:a.js", target: "function:a.js:run" },
      { type: "contains", source: "file:b.js", target: "function:a.js:run" },
      { type: "imports", source: "file:a.js", target: "file:b.js" },
    ]);
    expect([...parentOf]).toEqual([["function:a.js:run", "file:a.js"]]);
  });
});
