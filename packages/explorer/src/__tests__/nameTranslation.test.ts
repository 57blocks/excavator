import { beforeEach, describe, expect, it } from "vitest";
import { SearchEngine } from "../core/search";
import type { GraphNode, KnowledgeGraph } from "../core/types";
import { nodeTitles } from "../excavator/nodeTitle";
import {
  domainTitle,
  overviewLine,
  parseNameTranslations,
  translatorOf,
  type NameTranslations,
} from "../excavator/nameTranslations";
import { useDashboardStore } from "../store";

// openspec: changes/view-name-translation, design D5 (what the page shows) and spec report-viewer, "names in the selected language".

const node = (over: Partial<GraphNode>): GraphNode => ({
  id: "function:a.ts:approveRefund",
  type: "function",
  name: "approveRefund",
  summary: "",
  tags: [],
  complexity: "simple",
  ...over,
});

const counts = { names: 12, translated: 3, english: 9, identical: 0, mismatched: 0, unused: 0 };
const table = (names: Record<string, string>, over: Partial<NameTranslations> = {}): NameTranslations => ({
  language: "fr",
  names,
  counts,
  ...over,
});

describe("parseNameTranslations", () => {
  it("reads the page's name table", () => {
    const raw = { language: "zh", names: { A: "B" }, counts };
    expect(parseNameTranslations(raw)).toEqual(raw);
  });

  it.each([
    undefined,
    null,
    "text",
    [],
    {},
    { language: "", names: {}, counts },
    { language: "zh", names: [], counts },
    { language: "zh", names: { A: 1 }, counts },
    { language: "zh", names: {} },
    { language: "zh", names: {}, counts: { ...counts, translated: "3" } },
  ])("reads %j as no translation", (raw) => {
    expect(parseNameTranslations(raw)).toBeNull();
  });
});

describe("translatorOf", () => {
  it("looks a name up by its English text, and finds nothing for a name the table does not have", () => {
    const translate = translatorOf(table({ "Approve refund request": "Approuver la demande" }));
    expect(translate?.("Approve refund request")).toBe("Approuver la demande");
    expect(translate?.("Other")).toBeNull();
  });

  it("does not take a name inherited from the object prototype as translated", () => {
    const translate = translatorOf(table({}));
    expect(translate?.("constructor")).toBeNull();
    expect(translate?.("toString")).toBeNull();
    expect(translate?.("__proto__")).toBeNull();
  });

  it("is undefined when there is no table", () => {
    expect(translatorOf(null)).toBeUndefined();
  });
});

describe("nodeTitles with a translation", () => {
  const translate = translatorOf(table({ "Approve refund request": "Approuver la demande de remboursement" }));

  it("shows the translation as the title, the code name beneath, and the English as the original", () => {
    expect(nodeTitles(node({ displayName: "Approve refund request" }), translate)).toEqual({
      title: "Approuver la demande de remboursement",
      subtitle: "approveRefund",
      original: "Approve refund request",
    });
  });

  it("falls back to the English display name when the table has none, with no original", () => {
    expect(nodeTitles(node({ displayName: "Other name" }), translate)).toEqual({
      title: "Other name",
      subtitle: "approveRefund",
      original: null,
    });
  });

  it("shows the code name alone for a node with no display name, whatever the table says", () => {
    expect(nodeTitles(node({}), translate)).toEqual({ title: "approveRefund", subtitle: null, original: null });
    expect(nodeTitles(node({ displayName: "  " }), translate)).toEqual({ title: "approveRefund", subtitle: null, original: null });
  });

  it("does not translate a code name that happens to be a table key", () => {
    const code = translatorOf(table({ approveRefund: "Approuver" }));
    expect(nodeTitles(node({}), code)).toEqual({ title: "approveRefund", subtitle: null, original: null });
  });

  it("gives no original without a translator", () => {
    expect(nodeTitles(node({ displayName: "Approve refund request" }))).toEqual({
      title: "Approve refund request",
      subtitle: "approveRefund",
      original: null,
    });
  });

  it("translates the name of a domain, flow or step node, which has no display name", () => {
    const names = translatorOf(table({ "Charge a customer": "Facturer un client" }));
    expect(nodeTitles(node({ type: "flow", name: "Charge a customer" }), names)).toEqual({
      title: "Facturer un client",
      subtitle: null,
      original: "Charge a customer",
    });
  });
});

describe("domainTitle", () => {
  const translate = translatorOf(table({ Billing: "Facturation" }));

  it("gives the translation as the label and the English as the original", () => {
    expect(domainTitle("Billing", translate)).toEqual({ label: "Facturation", original: "Billing" });
  });

  it("keeps the English name when there is no translation or no translator", () => {
    expect(domainTitle("Shipping", translate)).toEqual({ label: "Shipping", original: null });
    expect(domainTitle("Billing")).toEqual({ label: "Billing", original: null });
  });
});

describe("overviewLine", () => {
  it("says the names were machine-translated, to which language, how many were translated and how many stayed English", () => {
    expect(overviewLine(table({}, { language: "zh", counts: { ...counts, translated: 3, english: 9 } }))).toBe(
      "Names machine-translated to zh: 3 translated, 9 kept in English",
    );
  });

  it("adds the number identical to English when there are any", () => {
    expect(overviewLine(table({}, { language: "zh", counts: { ...counts, translated: 3, english: 9, identical: 1 } }))).toBe(
      "Names machine-translated to zh: 3 translated, 9 kept in English, 1 identical to English",
    );
  });
});

describe("SearchEngine matches the translated name", () => {
  const nodes = [
    node({ displayName: "Approve refund request" }),
    node({ id: "x", name: "other", displayName: "Send the invoice" }),
  ];
  const translate = translatorOf(table({ "Approve refund request": "Approuver la demande de remboursement" }));

  it("finds a node by a word only its translation holds, and still by the English and the code name", () => {
    const engine = new SearchEngine(nodes, translate);
    expect(engine.search("remboursement").map((r) => r.nodeId)).toEqual(["function:a.ts:approveRefund"]);
    expect(engine.search("refund").map((r) => r.nodeId)).toContain("function:a.ts:approveRefund");
    expect(engine.search("approveRefund").map((r) => r.nodeId)).toContain("function:a.ts:approveRefund");
  });

  it("finds nothing by that word without a translator", () => {
    expect(new SearchEngine(nodes).search("remboursement")).toEqual([]);
  });
});

describe("the store's name table and search", () => {
  const graph = {
    version: "1",
    project: { name: "p", languages: [], frameworks: [], description: "", analyzedAt: "", gitCommitHash: "" },
    nodes: [node({ displayName: "Approve refund request" })],
    edges: [],
    layers: [],
    tour: [],
  } as unknown as KnowledgeGraph;
  const raw = { language: "fr", names: { "Approve refund request": "Approuver la demande de remboursement" }, counts };

  beforeEach(() => {
    useDashboardStore.setState(useDashboardStore.getInitialState(), true);
  });

  it("starts with no translation", () => {
    expect(useDashboardStore.getState().nameTranslations).toBeNull();
  });

  it("searches the translation when the table arrives after the graph", () => {
    useDashboardStore.getState().setGraph(graph);
    useDashboardStore.getState().setNameTranslations(raw);
    useDashboardStore.getState().setSearchQuery("remboursement");
    expect(useDashboardStore.getState().searchResults.map((r) => r.nodeId)).toEqual(["function:a.ts:approveRefund"]);
  });

  it("searches the translation when the table arrives before the graph", () => {
    useDashboardStore.getState().setNameTranslations(raw);
    useDashboardStore.getState().setGraph(graph);
    useDashboardStore.getState().setSearchQuery("remboursement");
    expect(useDashboardStore.getState().searchResults.map((r) => r.nodeId)).toEqual(["function:a.ts:approveRefund"]);
  });

  it("refreshes the results of a query already typed when the table arrives", () => {
    useDashboardStore.getState().setGraph(graph);
    useDashboardStore.getState().setSearchQuery("remboursement");
    expect(useDashboardStore.getState().searchResults).toEqual([]);
    useDashboardStore.getState().setNameTranslations(raw);
    expect(useDashboardStore.getState().searchResults).toHaveLength(1);
  });

  it("keeps no translation for a table that is not the page's shape", () => {
    useDashboardStore.getState().setNameTranslations({ language: "fr" });
    expect(useDashboardStore.getState().nameTranslations).toBeNull();
  });
});
