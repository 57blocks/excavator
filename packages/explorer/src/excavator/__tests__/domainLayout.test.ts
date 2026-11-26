import { describe, expect, it } from "vitest";
import type { GraphEdge, GraphNode, KnowledgeGraph } from "../../core/types";
import { BAND_HEADINGS, domainBands, gridPositions } from "../domainLayout";

const domain = (id: string, kind?: "business" | "support", name = id): GraphNode => ({
  id, type: "domain", name, summary: "", tags: [], complexity: "simple",
  ...(kind ? { domainMeta: { kind } } : {}),
});
const flowNode = (id: string): GraphNode => ({ id, type: "flow", name: id, summary: "", tags: [], complexity: "simple" });
const contains = (source: string, target: string): GraphEdge => ({ source, target, type: "contains_flow", direction: "forward", weight: 1 });
const cross = (source: string, target: string): GraphEdge => ({ source, target, type: "cross_domain", direction: "forward", weight: 0.5 });

const graphOf = (nodes: GraphNode[], edges: GraphEdge[] = []): KnowledgeGraph => ({
  version: "1.0.0",
  project: { name: "fixture", languages: [], frameworks: [], description: "", analyzedAt: "", gitCommitHash: "" },
  nodes, edges, layers: [], tour: [],
});

describe("domainBands", () => {
  it("puts business first, then support, then domains without a kind, and leaves empty bands out", () => {
    const g = graphOf([domain("d:s", "support"), domain("d:n"), domain("d:b", "business")]);
    expect(domainBands(g)).toEqual([
      { kind: "business", domainIds: ["d:b"] },
      { kind: "support", domainIds: ["d:s"] },
      { kind: "none", domainIds: ["d:n"] },
    ]);
    expect(domainBands(graphOf([domain("d:b", "business")])).map((b) => b.kind)).toEqual(["business"]);
    expect(domainBands(graphOf([]))).toEqual([]);
    expect(BAND_HEADINGS).toEqual({ business: "Business domains", support: "Support domains", none: "Other domains" });
  });

  it("orders a chain source before target whatever the node order", () => {
    const nodes = ["a", "b", "c"].map((id) => domain(id, "business"));
    const edges = [cross("a", "b"), cross("b", "c")];
    expect(domainBands(graphOf([nodes[2], nodes[0], nodes[1]], edges))[0].domainIds).toEqual(["a", "b", "c"]);
  });

  it("picks among ready domains by flow count descending, then name, then id", () => {
    const nodes = [domain("d1", "business", "Zeta"), domain("d2", "business", "Alpha"), domain("d3", "business", "Beta"), domain("d4", "business", "Beta")];
    const edges = [contains("d1", "f1"), contains("d1", "f2"), contains("d2", "f3"), contains("d3", "f4"), contains("d4", "f5")];
    expect(domainBands(graphOf(nodes, edges))[0].domainIds).toEqual(["d1", "d2", "d3", "d4"]);
  });

  it("orders a cycle: the remaining domain with fewest unplaced incoming edges goes next", () => {
    const nodes = ["a", "b", "c", "x"].map((id) => domain(id, "business"));
    // a <-> b is a cycle; c is fed by both; x is free.
    const edges = [cross("a", "b"), cross("b", "a"), cross("a", "c"), cross("b", "c")];
    const ids = domainBands(graphOf(nodes, edges))[0].domainIds;
    expect(ids[0]).toBe("x");
    expect(ids.slice(1)).toEqual(["a", "b", "c"]);
  });

  it("gives the same result for a shuffled node order", () => {
    const nodes = ["a", "b", "c", "d", "e"].map((id) => domain(id, "business"));
    const edges = [cross("c", "a"), cross("a", "b"), cross("b", "a"), cross("d", "e")];
    const base = domainBands(graphOf(nodes, edges));
    expect(domainBands(graphOf([...nodes].reverse(), [...edges].reverse()))).toEqual(base);
    expect(domainBands(graphOf([nodes[3], nodes[1], nodes[4], nodes[0], nodes[2]], edges))).toEqual(base);
  });

  it("ignores cross-domain edges that leave the band", () => {
    const nodes = [domain("s", "support", "A"), domain("b", "business", "B")];
    expect(domainBands(graphOf(nodes, [cross("s", "b")])).map((b) => b.domainIds)).toEqual([["b"], ["s"]]);
  });
});

describe("gridPositions", () => {
  const opts = { columns: 4, cardWidth: 300, cardHeight: 150, gapX: 20, gapY: 30, top: 100 };
  it("lays a uniform grid, rows left-aligned", () => {
    const p = gridPositions(6, opts);
    expect(p).toHaveLength(6);
    expect(p[0]).toEqual({ x: 0, y: 100 });
    expect(p[3]).toEqual({ x: 3 * 320, y: 100 });
    expect(p[4]).toEqual({ x: 0, y: 280 });
    expect(p[5]).toEqual({ x: 320, y: 280 });
  });
  it("is empty for no cards", () => {
    expect(gridPositions(0, opts)).toEqual([]);
  });
});
