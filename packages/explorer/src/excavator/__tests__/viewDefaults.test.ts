import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KnowledgeGraph } from "@understand-anything/core/types";
import { useDashboardStore } from "../../store";
import { resolveInitialTheme } from "../../themes/ThemeContext";

// openspec: changes/explorer-view-defaults, design D3, D4 and D5.

const domainGraph = { nodes: [], edges: [] } as unknown as KnowledgeGraph;

beforeEach(() => {
  useDashboardStore.setState(useDashboardStore.getInitialState(), true);
});

describe("what the page opens on", () => {
  it("opens on the Overview persona", () => {
    expect(useDashboardStore.getState().persona).toBe("non-technical");
  });

  it("opens the Domain mode when the first domain graph arrives", () => {
    expect(useDashboardStore.getState().viewMode).toBe("structural");
    useDashboardStore.getState().setDomainGraph(domainGraph);
    expect(useDashboardStore.getState().viewMode).toBe("domain");
  });

  it("leaves the mode alone when a domain graph was already there", () => {
    useDashboardStore.setState({ domainGraph });
    useDashboardStore.getState().setDomainGraph(domainGraph);
    expect(useDashboardStore.getState().viewMode).toBe("structural");
  });

  it("leaves the knowledge mode alone", () => {
    useDashboardStore.setState({ viewMode: "knowledge" });
    useDashboardStore.getState().setDomainGraph(domainGraph);
    expect(useDashboardStore.getState().viewMode).toBe("knowledge");
  });

  it("keeps the Domain mode when the knowledge graph arrives after the domain graph", () => {
    useDashboardStore.getState().setDomainGraph(domainGraph);
    useDashboardStore.getState().setGraph({
      version: "1",
      project: { name: "p", languages: [], frameworks: [], description: "", analyzedAt: "", gitCommitHash: "" },
      nodes: [],
      edges: [],
      layers: [],
      tour: [],
    } as unknown as KnowledgeGraph);
    expect(useDashboardStore.getState().viewMode).toBe("domain");
  });
});

describe("the diff overlay", () => {
  it("loads switched off and switches on from the toggle", () => {
    useDashboardStore.getState().setDiffOverlay(["file:a.ts"], ["file:b.ts"], "last 30 days");
    expect(useDashboardStore.getState().diffMode).toBe(false);
    expect(useDashboardStore.getState().changedNodeIds.size).toBe(1);
    useDashboardStore.getState().toggleDiffMode();
    expect(useDashboardStore.getState().diffMode).toBe(true);
  });
});

describe("the saved theme", () => {
  let stored: Map<string, string>;

  beforeEach(() => {
    stored = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not read a choice saved under the copy's old key", () => {
    stored.set("ua-theme", JSON.stringify({ presetId: "dark-violet", accentId: "violet" }));
    expect(resolveInitialTheme(null)).toEqual({ presetId: "light-violet", accentId: "violet" });
  });

  it("reads a choice saved under the page's own key", () => {
    stored.set("excavator-explorer-theme", JSON.stringify({ presetId: "dark-violet", accentId: "violet" }));
    expect(resolveInitialTheme(null)).toEqual({ presetId: "dark-violet", accentId: "violet" });
  });
});
