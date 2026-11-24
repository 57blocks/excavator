import { describe, expect, it } from "vitest";
import type { KnowledgeGraph } from "../../core/types";
import {
  dedupeCaseVariants,
  domainList,
  externalSystemList,
  projectIntroduction,
  runtimeUnits,
  techStack,
  topHotspotFiles,
  unusedCandidates,
} from "../overview";

const graph = (project: Partial<KnowledgeGraph["project"]> = {}, nodes: unknown[] = []): KnowledgeGraph =>
  ({ version: "1", project: { name: "acme", languages: [], frameworks: [], description: "", analyzedAt: "", gitCommitHash: null, ...project }, nodes, edges: [], layers: [], tour: [] }) as unknown as KnowledgeGraph;

describe("dedupeCaseVariants", () => {
  it("keeps one spelling per case-insensitive value and prefers the one with an uppercase letter", () => {
    expect(dedupeCaseVariants(["express", "Express", "gin"])).toEqual(["Express", "gin"]);
    expect(dedupeCaseVariants(["React", "react"])).toEqual(["React"]);
    expect(dedupeCaseVariants(["react", "React"])).toEqual(["React"]);
  });

  it("drops empty strings, trims, and keeps first-occurrence order", () => {
    expect(dedupeCaseVariants(["", " gin ", "  ", "go", "GIN"])).toEqual(["GIN", "go"]);
    expect(dedupeCaseVariants([])).toEqual([]);
  });
});

describe("projectIntroduction", () => {
  it("returns the trimmed project description from the knowledge graph", () => {
    expect(projectIntroduction(graph({ description: "  Billing for acme.  " }), null)).toEqual({ text: "Billing for acme.", source: "knowledge-graph" });
  });

  it("gives null text when the description is empty or the graph is missing", () => {
    expect(projectIntroduction(graph({ description: "   " }), null).text).toBeNull();
    expect(projectIntroduction(null, null)).toEqual({ text: null, source: "knowledge-graph" });
  });
});

describe("domainList", () => {
  const domain = (id: string, name: string, summary: string, kind?: unknown) => ({ id, type: "domain", name, summary, tags: [], complexity: "simple", ...(kind === undefined ? {} : { domainMeta: { kind } }) });
  const dg = graph({}, [
    domain("d:misc", "Misc", "Leftovers.\nSecond line."),
    domain("d:auth", "Auth", "Sign-in and sessions.", "support"),
    { id: "f:1", type: "flow", name: "Checkout flow", summary: "", tags: [], complexity: "simple" },
    domain("d:billing", "Billing", "  Invoices and payments.  ", "business"),
    domain("d:odd", "Odd", "", "other"),
    domain("d:orders", "Orders", "Order intake.", "business"),
  ]);

  it("lists only domain nodes, business first, then support, then no kind", () => {
    expect(domainList(dg).map((r) => [r.id, r.kind])).toEqual([
      ["d:billing", "business"],
      ["d:orders", "business"],
      ["d:auth", "support"],
      ["d:misc", null],
      ["d:odd", null],
    ]);
  });

  it("orders each band like the canvas: by cross-domain edges, then flow count, then name", () => {
    const flows = [{ id: "f:1", type: "flow", name: "x", summary: "", tags: [], complexity: "simple" }, { id: "f:2", type: "flow", name: "y", summary: "", tags: [], complexity: "simple" }];
    const g = graph({}, [domain("d:a", "Alpha", "", "business"), domain("d:b", "Beta", "", "business"), domain("d:c", "Gamma", "", "business"), ...flows]);
    g.edges = [
      { source: "d:c", target: "d:a", type: "cross_domain", direction: "forward", weight: 1 },
      { source: "d:b", target: "f:1", type: "contains_flow", direction: "forward", weight: 1 },
      { source: "d:b", target: "f:2", type: "contains_flow", direction: "forward", weight: 1 },
    ] as KnowledgeGraph["edges"];
    // Beta (2 flows) first, then Gamma (feeds Alpha), then Alpha.
    expect(domainList(g).map((r) => r.id)).toEqual(["d:b", "d:c", "d:a"]);
  });

  it("takes the summary's first line trimmed and leaves an empty summary empty", () => {
    const rows = domainList(dg);
    expect(rows.find((r) => r.id === "d:misc")?.summary).toBe("Leftovers.");
    expect(rows.find((r) => r.id === "d:billing")?.summary).toBe("Invoices and payments.");
    expect(rows.find((r) => r.id === "d:odd")?.summary).toBe("");
  });

  it("translates the label and keeps the English original only when translated", () => {
    const rows = domainList(dg, (english) => (english === "Billing" ? "Facturation" : null));
    expect(rows.find((r) => r.id === "d:billing")).toMatchObject({ label: "Facturation", original: "Billing" });
    expect(rows.find((r) => r.id === "d:orders")).toMatchObject({ label: "Orders", original: null });
  });

  it("is empty without a domain graph", () => {
    expect(domainList(null)).toEqual([]);
  });
});

describe("runtimeUnits", () => {
  it("lists every unit of every kind in product order", () => {
    const product = { units: [{ id: "u:web", name: "acme-web", root: "web", kind: "frontend" }, { id: "u:api", name: "acme-api", root: "api", kind: "service" }, { id: "u:x", name: "tool" }] };
    expect(runtimeUnits(product)).toEqual([
      { id: "u:web", name: "acme-web", root: "web", kind: "frontend" },
      { id: "u:api", name: "acme-api", root: "api", kind: "service" },
      { id: "u:x", name: "tool", root: null, kind: null },
    ]);
  });

  it("is empty for a product that is not a table or has no units array", () => {
    expect(runtimeUnits(null)).toEqual([]);
    expect(runtimeUnits({ units: "nope" })).toEqual([]);
    expect(runtimeUnits([1])).toEqual([]);
  });
});

describe("techStack", () => {
  it("dedupes case variants of languages and frameworks", () => {
    expect(techStack(graph({ languages: ["go", "Go", "typescript"], frameworks: ["express", "Express", "React", "react"] }))).toEqual({
      languages: ["Go", "typescript"],
      frameworks: ["Express", "React"],
    });
  });
});

describe("externalSystemList", () => {
  it("labels each external by its id without the prefix, in product order, skipping entries without a string id", () => {
    expect(externalSystemList({ externals: [{ id: "external:stripe" }, { id: 7 }, {}, { id: "external:mail" }] })).toEqual([
      { id: "external:stripe", label: "stripe" },
      { id: "external:mail", label: "mail" },
    ]);
    expect(externalSystemList({})).toEqual([]);
    expect(externalSystemList(undefined)).toEqual([]);
  });
});

describe("topHotspotFiles", () => {
  const product = {
    files: [
      { path: "b.go", score: 5, commits: 3, authors: 2, lastChanged: "2024-03-01" },
      { path: "a.go", score: 5, commits: 4 },
      { path: "c.go", score: 9, commits: 7, authors: 1, lastChanged: "2024-05-02" },
      { path: "noscore.go", commits: 100 },
    ],
  };

  it("sorts by score descending, ties by path, takes n, and nulls what is missing", () => {
    expect(topHotspotFiles(product, 3)).toEqual([
      { path: "c.go", commits: 7, authors: 1, lastChanged: "2024-05-02" },
      { path: "a.go", commits: 4, authors: null, lastChanged: null },
      { path: "b.go", commits: 3, authors: 2, lastChanged: "2024-03-01" },
    ]);
  });

  it("is empty for a product without a files array", () => {
    expect(topHotspotFiles(null, 5)).toEqual([]);
    expect(topHotspotFiles({ files: 3 }, 5)).toEqual([]);
  });
});

describe("unusedCandidates", () => {
  it("sorts by confidence (high, medium, low), then file, then line", () => {
    const product = {
      unused: [
        { id: "m:1", name: "m1", file: "b.ts", lineRange: [5, 9], confidence: "low" },
        { id: "m:2", name: "m2", file: "a.ts", lineRange: [30, 40], confidence: "high" },
        { id: "m:3", name: "m3", file: "a.ts", lineRange: [3, 4], confidence: "high" },
        { id: "m:4", name: "m4", file: "a.ts", lineRange: [1, 2], confidence: "medium" },
      ],
    };
    expect(unusedCandidates(product).map((r) => r.id)).toEqual(["m:3", "m:2", "m:4", "m:1"]);
  });

  it("is empty for a product without an unused array", () => {
    expect(unusedCandidates({})).toEqual([]);
    expect(unusedCandidates(null)).toEqual([]);
  });
});
