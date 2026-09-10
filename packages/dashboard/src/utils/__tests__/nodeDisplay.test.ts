/**
 * The dashboard has to survive the evidence model: graphs now carry
 * `evidence`, `provenance`, `verification`, `owner`, `anchorSource`,
 * `coverage`, `gaps` and digests, and a summary can legitimately be empty.
 *
 * Two things are checked here. The load path the dashboard actually uses
 * (`validateGraph`, as imported by App.tsx) must accept such a graph and hand
 * every one of those fields back — a viewer that silently strips them would
 * make the audit invisible in the one place a human looks. And an empty
 * summary must render as the node's name, not as a blank block or an invented
 * sentence.
 */
import { describe, expect, it } from "vitest";
import { validateGraph } from "@excavator/core/schema";
import { displaySummary, hasSummary } from "../nodeDisplay";

describe("displaySummary", () => {
  it("returns the summary when there is one", () => {
    expect(displaySummary("Formats a date.", "formatDate")).toBe("Formats a date.");
  });

  it("falls back to the node name when the summary is empty or blank", () => {
    expect(displaySummary("", "formatDate")).toBe("formatDate");
    expect(displaySummary("   \n ", "formatDate")).toBe("formatDate");
    expect(displaySummary(undefined, "formatDate")).toBe("formatDate");
    expect(displaySummary(null, "formatDate")).toBe("formatDate");
  });

  it("never invents placeholder prose", () => {
    // A sentence like "No summary available" is indistinguishable from a real
    // summary to a reader skimming the panel.
    for (const value of [displaySummary("", ""), displaySummary(undefined, undefined)]) {
      expect(value).toBe("");
    }
  });

  it("trims the summary it shows", () => {
    expect(displaySummary("  Formats a date.  ", "formatDate")).toBe("Formats a date.");
  });

  it("hasSummary distinguishes a real summary from a name fallback", () => {
    expect(hasSummary("Formats a date.")).toBe(true);
    expect(hasSummary("")).toBe(false);
    expect(hasSummary("   ")).toBe(false);
    expect(hasSummary(undefined)).toBe(false);
  });
});

describe("the dashboard load path tolerates the supplement fields", () => {
  const graph = {
    version: "1.0.0",
    project: {
      name: "fixture",
      languages: ["typescript"],
      frameworks: [],
      description: "fixture project",
      analyzedAt: "2026-01-01T00:00:00.000Z",
      gitCommitHash: null,
      sourceDigest: "a".repeat(64),
      factsDigest: "b".repeat(64),
      pipelineVersion: "excavator-annotate/1",
      model: "unknown",
      verification: "sample:50",
    },
    nodes: [
      {
        id: "file:src/page.xaml",
        type: "file",
        name: "page.xaml",
        filePath: "src/page.xaml",
        summary: "",
        tags: ["markup"],
        complexity: "simple",
        anchorSource: "census",
      },
      {
        id: "file:src/app.ts",
        type: "file",
        name: "app.ts",
        filePath: "src/app.ts",
        summary: "The entry point.",
        tags: ["entry-point"],
        complexity: "simple",
        anchorSource: "census",
      },
      {
        id: "function:src/app.ts:run",
        type: "function",
        name: "run",
        filePath: "src/app.ts",
        lineRange: [3, 9],
        summary: "Runs the app.",
        tags: ["entry-point"],
        complexity: "simple",
        owner: "App",
        owners: ["App", "Runner"],
        anchorSource: "tree-sitter",
        verification: "contradicted",
      },
    ],
    edges: [
      {
        source: "file:src/app.ts",
        target: "function:src/app.ts:run",
        type: "contains",
        direction: "forward",
        weight: 1.0,
        provenance: "extracted",
        evidence: [{ file: "src/app.ts", line: 3, source: "tree-sitter", verified: true }],
        verification: "verified",
        addedBy: "excavator-annotate",
      },
    ],
    layers: [
      {
        id: "layer:source", name: "Source", description: "src",
        nodeIds: ["file:src/page.xaml", "file:src/app.ts"],
      },
    ],
    tour: [],
    coverage: {
      files: 2,
      ignored: 0,
      byLanguage: {
        typescript: {
          files: 1, parsed: 1, zeroSymbol: 0, skipped: {},
          kinds: { function: 1, class: 0, import: 0, export: 0, call: 0 },
        },
        xaml: {
          files: 1, parsed: 0, zeroSymbol: 0, skipped: { "no-extractor": 1 },
          kinds: { function: 0, class: 0, import: 0, export: 0, call: 0 },
        },
      },
    },
    gaps: [
      { kind: "summary-contradicted", scope: "graph", reason: "1 summary the source contradicts", count: 1, samples: ["function:src/app.ts:run"] },
    ],
  };

  it("accepts the graph", () => {
    const result = validateGraph(graph);
    expect(result.success, JSON.stringify(result.errors ?? null)).toBe(true);
  });

  it("hands back every supplement field unchanged", () => {
    const result = validateGraph(graph);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const validated = result.data as typeof graph;

    expect(validated.project.verification).toBe("sample:50");
    expect(validated.project.model).toBe("unknown");
    expect(validated.project.pipelineVersion).toBe("excavator-annotate/1");
    expect(validated.project.gitCommitHash).toBeNull();
    expect(validated.project.sourceDigest).toBe("a".repeat(64));

    const [markup, , fn] = validated.nodes;
    expect(markup.summary).toBe("");
    expect(markup.anchorSource).toBe("census");
    expect(fn.owner).toBe("App");
    expect(fn.owners).toEqual(["App", "Runner"]);
    expect(fn.verification).toBe("contradicted");

    const [edge] = validated.edges;
    expect(edge.provenance).toBe("extracted");
    expect(edge.evidence).toEqual([
      { file: "src/app.ts", line: 3, source: "tree-sitter", verified: true },
    ]);
    expect(edge.verification).toBe("verified");
    expect(edge.addedBy).toBe("excavator-annotate");

    expect(validated.coverage.byLanguage.typescript.parsed).toBe(1);
    // The `no-extractor` bucket survives too: it is the record of a file the
    // readers could not open, and the viewer is where a human sees it.
    expect(validated.coverage.byLanguage.xaml.skipped["no-extractor"]).toBe(1);
    expect(validated.gaps[0].kind).toBe("summary-contradicted");
  });

  it("shows the name for the node whose summary is empty", () => {
    const [markup] = graph.nodes;
    expect(displaySummary(markup.summary, markup.name)).toBe("page.xaml");
  });
});
