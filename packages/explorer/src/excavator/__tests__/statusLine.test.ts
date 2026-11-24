import { describe, expect, it } from "vitest";
import type { DashboardFreshnessReport } from "../../freshness";
import type { NameTranslations } from "../nameTranslations";
import { buildStatusLine, readPageManifest, type ManifestProduct, type PageManifest, type StatusLineInput } from "../statusLine";

const mp = (name: string, status = "included", reason: string | null = null): ManifestProduct => ({ name, status, reason });
const manifestOf = (...products: ManifestProduct[]): PageManifest => ({ products });
const ALL = ["knowledge-graph", "semantics", "domain-graph", "unused-code", "doc-map", "hotspots", "tour", "relations"];
const allIncluded = manifestOf(...ALL.map((n) => mp(n)));
const jsonEntry = (name: string, over: Record<string, unknown> = {}) => ({ name, label: name, status: "included", reason: null, revision: "git:aaa", revisionNote: null, command: `/excavator-${name}`, ...over });
const fresh: DashboardFreshnessReport = {
  graphs: { knowledge: { status: "fresh", graphCommitHash: "a", headCommitHash: "a", changedFileCount: 0, changedFiles: [], commitsBehind: 0, commitsAhead: 0 } },
};
const run = (over: Partial<StatusLineInput> = {}) => buildStatusLine({ manifest: allIncluded, products: undefined, freshness: fresh, issues: [], gaps: undefined, nameTable: null, ...over });

describe("readPageManifest", () => {
  const docWith = (text: string | null) => ({ getElementById: (id: string) => (text !== null && id === "xv-explorer-manifest" ? { textContent: text } : null) }) as unknown as Document;

  it("returns the products list of the manifest block", () => {
    const doc = docWith(JSON.stringify({ products: [{ name: "tour", status: "not-run", reason: "no tour.json" }, { name: "relations", status: "included" }] }));
    expect(readPageManifest(doc)).toEqual({ products: [{ name: "tour", status: "not-run", reason: "no tour.json" }, { name: "relations", status: "included", reason: null }] });
  });

  it("gives a reason when the block is missing, not JSON, or has no usable products list", () => {
    expect(readPageManifest(docWith(null))).toEqual({ reason: "the page has no manifest" });
    expect(readPageManifest(docWith("{nope"))).toMatchObject({ reason: expect.stringContaining("not valid JSON") });
    expect(readPageManifest(docWith("{}"))).toEqual({ reason: "the page manifest has no products list" });
    expect(readPageManifest(docWith(JSON.stringify({ products: [{ name: "tour" }] })))).toMatchObject({ reason: expect.stringContaining("product 1") });
  });
});

describe("buildStatusLine summary", () => {
  it("groups labels by state in the order included, different revision, not run, unreadable, keeping manifest order inside a group", () => {
    const line = run({
      manifest: manifestOf(mp("tour", "unreadable", "tour.json is not valid JSON"), mp("doc-map", "not-run"), mp("relations", "different-revision"), mp("knowledge-graph"), mp("domain-graph"), mp("semantics", "not-run")),
    });
    expect(line.summary).toBe("Knowledge graph, Domain graph included \u00b7 Relations different revision \u00b7 Doc map, Semantics not run \u00b7 Tour unreadable");
    expect(line.attention).toBe(true);
  });

  it("uses the fixed labels and the name for an unknown product", () => {
    expect(run({ manifest: manifestOf(mp("unused-code"), mp("hotspots"), mp("mystery")) }).summary).toBe("Unused code, Hotspots, mystery included");
  });

  it("says the product states are unreadable when the manifest is unreadable or lists nothing", () => {
    for (const manifest of [{ reason: "the page has no manifest" }, manifestOf()]) {
      const line = run({ manifest });
      expect(line.summary).toMatch(/^Product states unreadable: .+/);
      expect(line.attention).toBe(true);
    }
    expect(run({ manifest: { reason: "the page has no manifest" } }).summary).toBe("Product states unreadable: the page has no manifest");
  });
});

describe("buildStatusLine details", () => {
  it("writes each product that is not included with its state, using products.json for command and revisions, and the tour as not shown", () => {
    const line = run({
      manifest: manifestOf(mp("knowledge-graph"), mp("doc-map", "not-run"), mp("relations", "different-revision"), mp("semantics", "not-run", "no semantics file"), mp("tour")),
      products: { snapshotRevision: "git:bbb", products: [jsonEntry("doc-map", { status: "not-run", revision: null }), jsonEntry("relations", { status: "different-revision", revision: "git:aaa" })] },
    });
    expect(line.details).toContain("Doc map: not run, command /excavator-doc-map");
    expect(line.details).toContain("Semantics: not run, reason no semantics file");
    expect(line.details).toContain("Relations: different revision, made from revision git:aaa, packed source revision git:bbb");
    expect(line.details).toContain("Tour: included, not shown on this page");
  });

  it("adds a line per graph whose freshness is not fresh, per issue and per gap, and the name table sentence", () => {
    const stale: DashboardFreshnessReport = {
      graphs: {
        knowledge: { status: "stale", relation: "behind", graphCommitHash: "a", headCommitHash: "b", changedFileCount: 2, changedFiles: ["x", "y"], commitsBehind: 3, commitsAhead: 0 },
        domain: { status: "unknown", reason: "missing-graph-commit" },
      },
    };
    const table: NameTranslations = { language: "French", names: {}, counts: { names: 4, translated: 3, english: 1, identical: 0, mismatched: 0, unused: 0, refused: 0 } };
    const line = run({
      manifest: manifestOf(mp("knowledge-graph")),
      freshness: stale,
      issues: [{ level: "dropped", category: "edge", message: "edge 4 has no target" }],
      gaps: [{ kind: "unresolved-import", scope: "svc", reason: "dynamic path", count: 3 }, { kind: "no-extractor", scope: "", reason: "", count: 0 }],
      nameTable: table,
    });
    expect(line.details).toContain("Knowledge graph: The knowledge graph is 3 project commits behind HEAD; 2 files have changed since analysis.");
    expect(line.details).toContain("Domain graph: The domain graph does not include a Git commit hash to compare with HEAD.");
    expect(line.details).toContain("Graph issue (dropped): edge 4 has no target");
    expect(line.details).toContain("Gap: unresolved-import \u00b7 svc 3 dynamic path");
    expect(line.details).toContain("Gap: no-extractor 0");
    expect(line.details).toContain("Names machine-translated to French: 3 translated, 1 kept in English");
    expect(line.attention).toBe(true);
  });

  it("has attention false when every product is included and fresh, and keeps the tour line", () => {
    const line = run();
    expect(line.attention).toBe(false);
    expect(line.details).toEqual(["Tour: included, not shown on this page"]);
    expect(line.summary).toBe("Knowledge graph, Semantics, Domain graph, Unused code, Doc map, Hotspots, Tour, Relations included");
  });
});
