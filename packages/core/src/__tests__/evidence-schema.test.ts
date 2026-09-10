import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateGraph } from "../schema.js";
import type { Coverage, Gap, GraphEdge, GraphNode, KnowledgeGraph } from "../types.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/** A v2-shaped graph: edges attributed, root carrying the ledger. */
function v2Graph(overrides?: Partial<KnowledgeGraph>): KnowledgeGraph {
  const nodes: GraphNode[] = [
    {
      id: "file:src/a.ts",
      type: "file",
      name: "a.ts",
      filePath: "src/a.ts",
      anchorSource: "census",
      summary: "",
      tags: [],
      complexity: "simple",
    },
    {
      id: "function:src/a.ts:Api.list",
      type: "function",
      name: "list",
      filePath: "src/a.ts",
      lineRange: [3, 7],
      owner: "Api",
      anchorSource: "tree-sitter",
      summary: "Lists things.",
      verification: "verified",
      tags: [],
      complexity: "simple",
    },
  ];
  const edges: GraphEdge[] = [
    {
      source: "file:src/a.ts",
      target: "function:src/a.ts:Api.list",
      type: "contains",
      direction: "forward",
      weight: 1,
      evidence: [{ file: "src/a.ts", line: 3, endLine: 7, source: "tree-sitter", text: "  list() {" }],
      provenance: "extracted",
    },
  ];
  const coverage: Coverage = {
    files: 3,
    byLanguage: {
      typescript: {
        files: 3,
        parsed: 2,
        zeroSymbol: 0,
        skipped: { binary: 1 },
        kinds: { function: 1, class: 0, import: 0, export: 0, call: 0 },
      },
    },
    ignored: 4,
    limits: { maxFileLines: 20000, maxFileBytes: 2097152 },
  };
  const gaps: Gap[] = [
    { kind: "calls-unresolved", scope: "typescript", reason: "callee not found in file or its imports", count: 2, samples: ["src/a.ts:9 helper"] },
  ];
  return {
    version: "1.0.0",
    project: {
      name: "fixture",
      languages: ["typescript"],
      frameworks: [],
      description: "synthetic",
      analyzedAt: "2026-09-10T00:00:00.000Z",
      gitCommitHash: null,
      sourceDigest: "a".repeat(64),
      factsDigest: "b".repeat(64),
      pipelineVersion: "2.0.0",
      model: "unknown",
    },
    nodes,
    edges,
    layers: [],
    tour: [],
    coverage,
    gaps,
    ...overrides,
  };
}

/** The pre-v2 shape: no evidence, no provenance, no ledger. */
function legacyGraph(): Record<string, unknown> {
  return {
    version: "1.0.0",
    project: {
      name: "legacy",
      languages: ["typescript"],
      frameworks: [],
      description: "pre-v2 graph",
      analyzedAt: "2026-03-14T00:00:00.000Z",
      gitCommitHash: "58cfb20ac8f3f98cd7dede428d147dbe9cdc94b2",
    },
    nodes: [
      { id: "file:src/a.ts", type: "file", name: "a.ts", filePath: "src/a.ts", summary: "Entry", tags: [], complexity: "simple" },
      { id: "function:src/a.ts:run", type: "function", name: "run", filePath: "src/a.ts", lineRange: [1, 4], summary: "Runs", tags: [], complexity: "simple" },
    ],
    edges: [
      { source: "file:src/a.ts", target: "function:src/a.ts:run", type: "contains", direction: "forward", weight: 1 },
    ],
    layers: [{ id: "l1", name: "Core", description: "Core", nodeIds: ["file:src/a.ts"] }],
    tour: [{ order: 1, title: "Start", description: "here", nodeIds: ["file:src/a.ts"] }],
  };
}

describe("edge attribution (provenance + evidence)", () => {
  it("keeps evidence, provenance and verification on edges through validation", () => {
    const graph = v2Graph();
    graph.edges[0].verification = "verified";
    const result = validateGraph(graph);

    expect(result.success).toBe(true);
    expect(result.data!.edges).toHaveLength(1);
    const edge = result.data!.edges[0];
    expect(edge.provenance).toBe("extracted");
    expect(edge.evidence).toEqual([
      { file: "src/a.ts", line: 3, endLine: 7, source: "tree-sitter", text: "  list() {" },
    ]);
    expect(edge.verification).toBe("verified");
  });

  it("rejects an extracted edge with no evidence and names it", () => {
    const graph = v2Graph();
    graph.edges[0].evidence = [];
    const result = validateGraph(graph);

    expect(result.data!.edges).toHaveLength(0);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ level: "dropped", category: "invalid-edge", path: "edges[0]" }),
    );
    expect(result.issues.some((i) => /extracted.*evidence/.test(i.message))).toBe(true);
  });

  it("rejects an extracted edge whose only evidence is model-cited", () => {
    const graph = v2Graph();
    graph.edges[0].evidence = [{ file: "src/a.ts", line: 3, source: "model" }];
    const result = validateGraph(graph);

    expect(result.data!.edges).toHaveLength(0);
    expect(result.issues.some((i) => /not "model"/.test(i.message))).toBe(true);
  });

  it("rejects an inferred edge carrying non-model evidence", () => {
    const graph = v2Graph();
    graph.edges[0].provenance = "inferred";
    const result = validateGraph(graph);

    expect(result.data!.edges).toHaveLength(0);
    expect(result.issues.some((i) => /inferred.*tree-sitter/.test(i.message))).toBe(true);
  });

  it("accepts an inferred edge with model evidence and with no evidence", () => {
    const graph = v2Graph();
    graph.edges.push({
      source: "function:src/a.ts:Api.list",
      target: "file:src/a.ts",
      type: "related",
      direction: "bidirectional",
      weight: 0.4,
      evidence: [{ file: "src/a.ts", line: 5, source: "model" }],
      provenance: "inferred",
    });
    graph.edges.push({
      source: "function:src/a.ts:Api.list",
      target: "file:src/a.ts",
      type: "depends_on",
      direction: "forward",
      weight: 0.4,
      evidence: [],
      provenance: "inferred",
    });
    const result = validateGraph(graph);
    expect(result.data!.edges).toHaveLength(3);
  });

  it("defaults an edge that states no provenance to inferred with empty evidence", () => {
    const result = validateGraph(legacyGraph());
    expect(result.success).toBe(true);
    expect(result.data!.edges[0].provenance).toBe("inferred");
    expect(result.data!.edges[0].evidence).toEqual([]);
  });
});

describe("per-type node anchors", () => {
  it("drops a function node with no lineRange and names it", () => {
    const graph = v2Graph();
    delete graph.nodes[1].lineRange;
    const result = validateGraph(graph);

    expect(result.data!.nodes.map((n) => n.id)).toEqual(["file:src/a.ts"]);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ level: "dropped", category: "invalid-node", path: "nodes[1]" }),
    );
    expect(result.issues.some((i) => /function node requires "lineRange"/.test(i.message))).toBe(true);
  });

  it("drops a function node with no filePath", () => {
    const graph = v2Graph();
    delete graph.nodes[1].filePath;
    const result = validateGraph(graph);
    expect(result.data!.nodes.map((n) => n.id)).toEqual(["file:src/a.ts"]);
    expect(result.issues.some((i) => /function node requires "filePath"/.test(i.message))).toBe(true);
  });

  it("drops a file node with no filePath (null included)", () => {
    const graph = v2Graph() as unknown as Record<string, unknown>;
    (graph.nodes as GraphNode[])[0] = { ...(graph.nodes as GraphNode[])[0], filePath: undefined };
    const result = validateGraph(graph);
    expect(result.data!.nodes.map((n) => n.id)).toEqual(["function:src/a.ts:Api.list"]);
    expect(result.issues.some((i) => /file node requires "filePath"/.test(i.message))).toBe(true);
  });

  it("keeps a class node anchored and its owner/anchorSource fields", () => {
    const graph = v2Graph();
    graph.nodes.push({
      id: "class:src/a.ts:Api",
      type: "class",
      name: "Api",
      filePath: "src/a.ts",
      lineRange: [1, 20],
      anchorSource: "tree-sitter",
      summary: "",
      tags: [],
      complexity: "simple",
    });
    const result = validateGraph(graph);
    const cls = result.data!.nodes.find((n) => n.id === "class:src/a.ts:Api")!;
    expect(cls.anchorSource).toBe("tree-sitter");
    expect(result.data!.nodes.find((n) => n.id === "function:src/a.ts:Api.list")!.owner).toBe("Api");
  });

  it("accepts an empty summary with no verification", () => {
    const graph = v2Graph();
    graph.nodes[1].summary = "";
    delete graph.nodes[1].verification;
    const result = validateGraph(graph);
    const node = result.data!.nodes.find((n) => n.id === "function:src/a.ts:Api.list")!;
    expect(node.summary).toBe("");
    expect(node.verification).toBeUndefined();
    expect(result.issues.filter((i) => i.level === "dropped")).toEqual([]);
  });

  it("does not require anchors on domain, knowledge or design node types", () => {
    const graph = v2Graph();
    graph.nodes.push(
      { id: "domain:leave", type: "domain", name: "Leave", summary: "", tags: [], complexity: "simple" },
      { id: "topic:x", type: "topic", name: "X", summary: "", tags: [], complexity: "simple" },
      { id: "screen:1:2", type: "screen", name: "Home", summary: "", tags: [], complexity: "simple" },
    );
    const result = validateGraph(graph);
    expect(result.issues.filter((i) => i.level === "dropped")).toEqual([]);
    expect(result.data!.nodes).toHaveLength(5);
  });
});

describe("graph-level coverage, gaps and digests", () => {
  it("keeps coverage and gaps through validation", () => {
    const result = validateGraph(v2Graph());
    expect(result.legacyShape).toBe(false);
    expect(result.data!.coverage).toEqual(v2Graph().coverage);
    expect(result.data!.gaps).toEqual(v2Graph().gaps);
  });

  it("keeps a non-git project's null commit hash and its digests", () => {
    const result = validateGraph(v2Graph());
    expect(result.data!.project.gitCommitHash).toBeNull();
    expect(result.data!.project.sourceDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(result.data!.project.factsDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(result.data!.project.pipelineVersion).toBe("2.0.0");
    expect(result.data!.project.model).toBe("unknown");
  });

  it("keeps kind so a design or knowledge graph is not silently reclassified", () => {
    for (const kind of ["design", "knowledge", "codebase"] as const) {
      const result = validateGraph(v2Graph({ kind }));
      expect(result.data!.kind).toBe(kind);
    }
    expect(validateGraph(v2Graph()).data!.kind).toBeUndefined();
  });

  it("replaces an unparsable coverage with an empty ledger and says so", () => {
    const graph = v2Graph() as unknown as Record<string, unknown>;
    graph.coverage = { files: "many" };
    const result = validateGraph(graph);
    expect(result.data!.coverage).toEqual({ files: 0, byLanguage: {}, ignored: 0 });
    expect(result.issues).toContainEqual(
      expect.objectContaining({ level: "dropped", category: "invalid-coverage" }),
    );
  });

  it("drops a malformed gap entry and keeps the rest", () => {
    const graph = v2Graph() as unknown as Record<string, unknown>;
    (graph.gaps as unknown[]).push({ kind: "no-extractor" });
    const result = validateGraph(graph);
    expect(result.data!.gaps).toHaveLength(1);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ level: "dropped", category: "invalid-gap", path: "gaps[1]" }),
    );
  });
});

describe("pre-v2 (legacy) graphs still validate", () => {
  it("accepts a legacy graph, flags the shape, and defaults the ledger to empty", () => {
    const result = validateGraph(legacyGraph());
    expect(result.success).toBe(true);
    expect(result.legacyShape).toBe(true);
    expect(result.data!.coverage).toEqual({ files: 0, byLanguage: {}, ignored: 0 });
    expect(result.data!.gaps).toEqual([]);
    expect(result.issues.filter((i) => i.level === "dropped")).toEqual([]);
    expect(result.data!.nodes).toHaveLength(2);
    expect(result.data!.edges).toHaveLength(1);
    expect(result.data!.layers[0].nodeIds).toEqual(["file:src/a.ts"]);
    expect(result.data!.tour[0].nodeIds).toEqual(["file:src/a.ts"]);
  });

  it("accepts the dashboard's shipped pre-v2 graph with nothing dropped", () => {
    const raw = JSON.parse(
      readFileSync(join(HERE, "../../../dashboard/public/knowledge-graph.json"), "utf-8"),
    );
    const result = validateGraph(raw);

    expect(result.success).toBe(true);
    expect(result.legacyShape).toBe(true);
    expect(result.issues.filter((i) => i.level === "dropped")).toEqual([]);
    expect(result.data!.nodes).toHaveLength(raw.nodes.length);
    expect(result.data!.edges).toHaveLength(raw.edges.length);
    expect(result.data!.edges.every((e) => e.provenance === "inferred")).toBe(true);
    expect(result.data!.coverage).toEqual({ files: 0, byLanguage: {}, ignored: 0 });
  });
});
