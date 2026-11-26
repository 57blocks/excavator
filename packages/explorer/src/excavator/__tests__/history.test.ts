import { beforeEach, describe, expect, it } from "vitest";
import type { KnowledgeGraph } from "../../core/types";
import { useDashboardStore } from "../../store";
import { historyLabel, type HistoryNames } from "../historyLabel";

const node = (id: string, type: string, name = id) => ({ id, type, name, summary: "", tags: [], complexity: "simple" });
const edge = (source: string, target: string, type: string) => ({ source, target, type, direction: "forward", weight: 1 });

const domainGraph = {
  version: "1.0.0",
  project: { name: "x", languages: [], frameworks: [], description: "", analyzedAt: "", gitCommitHash: "" },
  nodes: [node("d:1", "domain"), node("d:2", "domain"), node("f:a", "flow"), node("f:b", "flow")],
  edges: [edge("d:1", "f:a", "contains_flow"), edge("d:1", "f:b", "contains_flow")],
  layers: [],
  tour: [],
} as unknown as KnowledgeGraph;
const groups = {
  format: "excavator-view-feature-groups/3",
  domains: {
    "d:1": [
      { id: "g:a", kind: "feature", label: "a", file: null, flows: [{ id: "f:a", rule: "route", scope: null, origin: null }] },
      { id: "g:b", kind: "feature", label: "b", file: null, flows: [{ id: "f:b", rule: "route", scope: null, origin: null }] },
    ],
  },
};

const s = () => useDashboardStore.getState();
beforeEach(() => {
  useDashboardStore.setState(useDashboardStore.getInitialState(), true);
  useDashboardStore.setState({ domainGraph, viewMode: "domain" });
  s().setFeatureGroups(groups);
});

describe("Back is a history back", () => {
  it("has nothing to go back to on first load", () => {
    expect(s().history).toEqual([]);
    s().goBack();
    expect(s().activeDomainId).toBeNull();
  });

  it("returns from a go-to to the same domain level, with the same viewport and no selection", () => {
    s().navigateToDomain("d:1");
    s().setViewportState({ x: 12, y: 34, zoom: 0.8 });
    s().goToNode("f:b");
    expect([s().activeDomainId, s().activeGroupId, s().selectedNodeId]).toEqual(["d:1", "g:b", "f:b"]);
    s().goBack();
    expect([s().activeDomainId, s().activeGroupId, s().selectedNodeId]).toEqual(["d:1", null, null]);
    expect(s().pendingViewport).toEqual({ x: 12, y: 34, zoom: 0.8 });
    expect(s().history).toHaveLength(1);
  });

  it("goes back twice from an opened group to the overview, with the domain card selected and its viewport", () => {
    s().setViewportState({ x: 1, y: 2, zoom: 0.9 });
    s().selectNode("d:1");
    s().enterNode("domain", "d:1");
    s().setViewportState({ x: 3, y: 4, zoom: 0.75 });
    s().openGroup("g:a");
    s().goBack();
    expect([s().activeDomainId, s().activeGroupId]).toEqual(["d:1", null]);
    expect(s().pendingViewport).toEqual({ x: 3, y: 4, zoom: 0.75 });
    s().goBack();
    expect([s().activeDomainId, s().selectedNodeId]).toEqual([null, "d:1"]);
    expect(s().pendingViewport).toEqual({ x: 1, y: 2, zoom: 0.9 });
    expect(s().history).toEqual([]);
  });

  it("returns from the Structural view to the Domain level it left", () => {
    s().navigateToDomain("d:1");
    s().openGroup("g:a");
    s().setViewMode("structural");
    expect(s().viewMode).toBe("structural");
    s().goBack();
    expect([s().viewMode, s().activeDomainId, s().activeGroupId]).toEqual(["domain", "d:1", "g:a"]);
  });

  it("records Escape going up, a breadcrumb jump and an entry, but not a selection alone", () => {
    s().navigateToDomain("d:1");
    s().openGroup("g:a");
    expect(s().history).toHaveLength(2);
    s().selectNode("f:a");
    s().selectNode(null);
    expect(s().history).toHaveLength(2);
    s().pressEscape(false);
    expect(s().history).toHaveLength(3);
    s().clearActiveDomain();
    expect(s().history).toHaveLength(4);
  });

  it("records one entry for a go-to that changes levels twice inside, and none for one that changes nothing", () => {
    s().navigateToDomain("d:1");
    s().openGroup("g:a");
    const before = s().history.length;
    s().goToNode("f:a");
    expect(s().history).toHaveLength(before);
    s().goToNode("d:1");
    expect(s().history).toHaveLength(before + 1);
  });

  it("keeps at most 100 entries, dropping the oldest", () => {
    for (let i = 0; i < 120; i += 1) {
      s().navigateToDomain("d:1");
      s().clearActiveDomain();
    }
    expect(s().history).toHaveLength(100);
  });
});

describe("the name the Back buttons show", () => {
  const names: HistoryNames = {
    domain: (id) => `Domain ${id}`,
    group: (domainId, groupId) => ({ label: `Group ${groupId}`, qualifier: null }),
    layer: () => null,
    folder: () => null,
  };
  const previous = () => {
    const entry = s().history[s().history.length - 1];
    return entry === undefined ? null : historyLabel(entry, names);
  };

  it("names the view each Back returns to, level by level", () => {
    expect(previous()).toBeNull();
    s().selectNode("d:1");
    s().enterNode("domain", "d:1");
    expect(previous()).toBe("All domains");
    s().openGroup("g:a");
    expect(previous()).toBe("Domain d:1");
    s().goBack();
    expect(previous()).toBe("All domains");
    s().goBack();
    expect(previous()).toBeNull();
  });
});
