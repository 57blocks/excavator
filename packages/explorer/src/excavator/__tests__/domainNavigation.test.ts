import { beforeEach, describe, expect, it } from "vitest";
import type { KnowledgeGraph } from "../../core/types";
import { useDashboardStore } from "../../store";
import { runCanvasClick } from "../canvasActions";

const node = (id: string, type: string, name = id) => ({ id, type, name, summary: "", tags: [], complexity: "simple" });
const edge = (source: string, target: string, type: string) => ({ source, target, type, direction: "forward", weight: 1 });

const domainGraph = {
  version: "1.0.0",
  project: { name: "x", languages: [], frameworks: [], description: "", analyzedAt: "", gitCommitHash: "" },
  nodes: [node("d:1", "domain", "Billing"), node("f:a", "flow", "Charge"), node("s:1", "step", "Validate input")],
  edges: [edge("d:1", "f:a", "contains_flow"), edge("f:a", "s:1", "flow_step")],
  layers: [],
  tour: [],
} as unknown as KnowledgeGraph;

const groups = { format: "excavator-view-feature-groups/3", domains: { "d:1": [{ id: "g:pay", kind: "feature", label: "pay", file: null, flows: [{ id: "f:a", rule: "route", scope: null, origin: null }] }] } };

beforeEach(() => {
  useDashboardStore.setState(useDashboardStore.getInitialState(), true);
  useDashboardStore.setState({ domainGraph, viewMode: "domain" });
  useDashboardStore.getState().setFeatureGroups(groups);
});

describe("going up in the Domain view", () => {
  it("goes group, then domain, then all domains", () => {
    const s = () => useDashboardStore.getState();
    s().navigateToDomain("d:1");
    s().openGroup("g:pay");
    expect([s().activeDomainId, s().activeGroupId]).toEqual(["d:1", "g:pay"]);
    s().goUp();
    expect([s().activeDomainId, s().activeGroupId]).toEqual(["d:1", null]);
    s().goUp();
    expect([s().activeDomainId, s().activeGroupId]).toEqual([null, null]);
    s().goUp();
    expect([s().activeDomainId, s().activeGroupId]).toEqual([null, null]);
  });

  it("resets the open group when another domain opens or the domain is cleared", () => {
    const s = () => useDashboardStore.getState();
    s().navigateToDomain("d:1");
    s().openGroup("g:pay");
    s().navigateToDomain("d:1");
    expect(s().activeGroupId).toBeNull();
    s().openGroup("g:pay");
    s().clearActiveDomain();
    expect(s().activeGroupId).toBeNull();
  });
});

describe("going to a node, for search and every panel list", () => {
  const s = () => useDashboardStore.getState();
  it("opens the lanes of the group that holds a flow, selects it and asks the canvas to pan to it", () => {
    s().navigateToDomain("d:1");
    s().goToNode("f:a");
    expect(s()).toMatchObject({ activeDomainId: "d:1", activeGroupId: "g:pay", selectedNodeId: "f:a", domainRevealNodeId: "f:a" });
  });
  it("changes no level for a flow already on the open lanes", () => {
    s().navigateToDomain("d:1");
    s().openGroup("g:pay");
    s().goToNode("f:a");
    expect(s()).toMatchObject({ activeDomainId: "d:1", activeGroupId: "g:pay", selectedNodeId: "f:a" });
  });
  it("opens the group of the first flow that holds a step", () => {
    s().goToNode("s:1");
    expect(s()).toMatchObject({ activeDomainId: "d:1", activeGroupId: "g:pay", selectedNodeId: "s:1" });
  });
  it("returns to the overview and selects the domain, without opening it, for a domain row inside another domain", () => {
    s().navigateToDomain("d:1");
    s().openGroup("g:pay");
    s().goToNode("d:1");
    expect(s()).toMatchObject({ activeDomainId: null, activeGroupId: null, selectedNodeId: "d:1", domainRevealNodeId: "d:1" });
  });
  it("opens the all-flows group when the page has no groups", () => {
    s().setFeatureGroups(undefined);
    s().goToNode("f:a");
    expect(s().activeGroupId).toBe("all");
  });
  it("searches the domain graph's nodes in the Domain view", () => {
    s().setSearchQuery("Charge");
    expect(s().searchResults.map((r) => r.nodeId)).toContain("f:a");
  });
});

describe("clicking canvas nodes", () => {
  const s = () => useDashboardStore.getState();
  it("selects on a click, deselects on the same click again, and never changes the level", () => {
    s().navigateToDomain("d:1");
    runCanvasClick("flow", "f:a", "click", 1);
    expect(s().selectedNodeId).toBe("f:a");
    runCanvasClick("flow", "f:a", "click", 1);
    expect(s().selectedNodeId).toBeNull();
    expect(s().activeDomainId).toBe("d:1");
  });

  it("ignores a click with detail 2 and keeps the selection of the first click", () => {
    runCanvasClick("domain", "d:1", "click", 1);
    runCanvasClick("domain", "d:1", "click", 2);
    expect(s().selectedNodeId).toBe("d:1");
    expect(s().activeDomainId).toBeNull();
  });

  it("enters a domain and a group on a double click, and leaves nothing selected there", () => {
    runCanvasClick("domain", "d:1", "click", 1);
    runCanvasClick("domain", "d:1", "click", 2);
    runCanvasClick("domain", "d:1", "dblclick", 2);
    expect([s().activeDomainId, s().selectedNodeId]).toEqual(["d:1", null]);
    runCanvasClick("group", "g:pay", "click", 1);
    expect(s().selectedGroupId).toBe("g:pay");
    expect(s().activeGroupId).toBeNull();
    runCanvasClick("group", "g:pay", "click", 2);
    runCanvasClick("group", "g:pay", "dblclick", 2);
    expect([s().activeGroupId, s().selectedGroupId, s().selectedNodeId]).toEqual(["g:pay", null, null]);
  });

  it("only selects on a double click of a flow", () => {
    s().navigateToDomain("d:1");
    s().openGroup("g:pay");
    runCanvasClick("flow", "f:a", "click", 1);
    runCanvasClick("flow", "f:a", "click", 2);
    runCanvasClick("flow", "f:a", "dblclick", 2);
    expect([s().selectedNodeId, s().activeGroupId]).toEqual(["f:a", "g:pay"]);
  });

  it("clears the selection when drilling in by any route", () => {
    s().selectNode("f:a");
    s().navigateToDomain("d:1");
    expect(s().selectedNodeId).toBeNull();
    s().selectGroup("g:pay");
    s().openGroup("g:pay");
    expect(s().selectedGroupId).toBeNull();
  });
});

describe("Escape", () => {
  const s = () => useDashboardStore.getState();
  it("clears a selection first and only then goes up a level", () => {
    s().navigateToDomain("d:1");
    s().openGroup("g:pay");
    s().selectNode("f:a");
    s().pressEscape(false);
    expect([s().selectedNodeId, s().activeGroupId]).toEqual([null, "g:pay"]);
    s().pressEscape(false);
    expect([s().activeGroupId, s().activeDomainId]).toEqual([null, "d:1"]);
  });
  it("clears a selected group card first", () => {
    s().navigateToDomain("d:1");
    s().selectGroup("g:pay");
    s().pressEscape(false);
    expect([s().selectedGroupId, s().activeDomainId]).toEqual([null, "d:1"]);
  });
  it("goes nowhere while a text field has focus and nothing is selected", () => {
    s().navigateToDomain("d:1");
    s().pressEscape(true);
    expect(s().activeDomainId).toBe("d:1");
  });
});
