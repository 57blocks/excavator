import { describe, expect, it } from "vitest";
import type { GraphEdge, GraphNode } from "../../core/types";
import { validateGraph } from "../../core/schema";
import { coverageRows, evidenceLabel, summaryRemoved, verdictOf } from "../ourData";

const node = (fields: Partial<GraphNode>): GraphNode => ({ id: "function:a.go:run", type: "function", name: "run", summary: "Runs.", tags: [], complexity: "simple", ...fields });
const edge = (fields: Partial<GraphEdge>): GraphEdge => ({ source: "file:a.go", target: "file:b.go", type: "imports", direction: "forward", weight: 0.5, ...fields });

describe("verdictOf and summaryRemoved", () => {
  it("reads the three verdicts and nothing else", () => {
    expect(verdictOf(node({ verification: "verified" }))).toBe("verified");
    expect(verdictOf(node({ verification: "unverified" }))).toBe("unverified");
    expect(verdictOf(node({ verification: "contradicted" }))).toBe("contradicted");
    expect(verdictOf(node({}))).toBeNull();
    expect(verdictOf(node({ verification: "maybe" }))).toBeNull();
  });

  it("says a summary was removed only when it is empty and contradicted", () => {
    expect(summaryRemoved(node({ summary: "", verification: "contradicted" }))).toBe(true);
    expect(summaryRemoved(node({ summary: "", verification: "verified" }))).toBe(false);
    expect(summaryRemoved(node({ summary: "", verification: undefined }))).toBe(false);
    expect(summaryRemoved(node({ summary: "Runs.", verification: "contradicted" }))).toBe(false);
  });
});

describe("evidenceLabel", () => {
  it("gives the first evidence as file:line, with the end line when it differs", () => {
    expect(evidenceLabel(edge({ evidence: [{ file: "a.go", line: 7, source: "import-map" }, { file: "c.go", line: 1 }] }))).toBe("a.go:7");
    expect(evidenceLabel(edge({ evidence: [{ file: "a.go", line: 149, endLine: 169 }] }))).toBe("a.go:149-169");
    expect(evidenceLabel(edge({ evidence: [{ file: "a.go", line: 3, endLine: 3 }] }))).toBe("a.go:3");
    expect(evidenceLabel(edge({ evidence: [{ file: "a.go" }] }))).toBe("a.go");
  });

  it("gives nothing for an edge without evidence", () => {
    expect(evidenceLabel(edge({}))).toBeNull();
    expect(evidenceLabel(edge({ evidence: [] }))).toBeNull();
  });
});

describe("coverageRows", () => {
  it("lists languages by files, then name, and leaves out reasons with no file", () => {
    const rows = coverageRows({
      files: 9,
      byLanguage: {
        css: { files: 3, parsed: 0, zeroSymbol: 0, skipped: { "no-extractor": 2, "filtered-by-defaults": 1, other: 0 } },
        go: { files: 5, parsed: 5, zeroSymbol: 1, skipped: {} },
        conf: { files: 1, parsed: 0, zeroSymbol: 0, skipped: { "no-extractor": 1 } },
      },
    });
    expect(rows.map((row) => row.language)).toEqual(["go", "css", "conf"]);
    expect(rows[1]).toEqual({ language: "css", files: 3, parsed: 0, zeroSymbol: 0, skipped: [["no-extractor", 2], ["filtered-by-defaults", 1]] });
    expect(rows[0].zeroSymbol).toBe(1);
    expect(coverageRows(undefined)).toEqual([]);
  });
});

describe("validateGraph keeps our data", () => {
  const graph = (fields: Record<string, unknown>) => ({
    version: "1.0.0",
    project: { name: "p", languages: [], frameworks: [], description: "", analyzedAt: "", gitCommitHash: "" },
    nodes: [
      { id: "file:a.go", type: "file", name: "a.go", summary: "", tags: [], complexity: "simple", verification: "contradicted" },
      { id: "file:b.go", type: "file", name: "b.go", summary: "B.", tags: [], complexity: "simple" },
    ],
    edges: [
      { source: "file:a.go", target: "file:b.go", type: "mentions", direction: "forward", weight: 0.5, evidence: [{ file: "a.go", line: 29, source: "lexical", token: "b.go" }], provenance: "extracted" },
    ],
    layers: [],
    tour: [],
    ...fields,
  });

  it("leaves an empty summary empty, keeps the verdict, the mentions edge and its evidence, with no issue", () => {
    const result = validateGraph(graph({}));
    expect(result.issues).toEqual([]);
    expect(result.data!.nodes[0]).toMatchObject({ summary: "", verification: "contradicted" });
    expect(result.data!.edges).toHaveLength(1);
    expect(result.data!.edges[0]).toMatchObject({ type: "mentions", provenance: "extracted", evidence: [{ file: "a.go", line: 29, source: "lexical", token: "b.go" }] });
  });

  it("passes the coverage and gap records through, and drops one that has not their shape with an issue", () => {
    const coverage = { files: 1, byLanguage: { go: { files: 1, parsed: 1, zeroSymbol: 0, skipped: {}, kinds: { function: 2 } } } };
    const gaps = [{ kind: "calls-ambiguous", scope: "go", reason: "more than one", count: 45, samples: ["a.go:1 -> X"] }, { scope: "no kind" }];
    const result = validateGraph(graph({ coverage, gaps }));
    expect(result.data!.coverage).toEqual(coverage);
    expect(result.data!.gaps).toEqual([gaps[0]]);
    expect(result.issues.map((issue) => issue.category)).toEqual(["invalid-gap"]);
  });

  it("still fills a summary that is not a string", () => {
    const g = graph({});
    delete (g.nodes[1] as Record<string, unknown>).summary;
    const result = validateGraph(g);
    expect(result.data!.nodes[1].summary).toBe("b.go");
    expect(result.issues.map((issue) => issue.category)).toEqual(["missing-field"]);
  });
});
