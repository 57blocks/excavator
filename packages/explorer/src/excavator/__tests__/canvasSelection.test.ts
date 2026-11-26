import { describe, expect, it } from "vitest";
import type { GraphEdge, GraphNode, KnowledgeGraph } from "../../core/types";
import { canvasHolder, goToTarget, hasNextLevel, onCanvasClick, type CanvasNodeType } from "../canvasSelection";
import { readFeatureGroups } from "../domainLevels";

const ALL: CanvasNodeType[] = ["domain", "group", "flow", "step", "layer", "folder", "container", "file", "function", "file-list"];
const ENTER = new Set<CanvasNodeType>(["domain", "group", "layer", "folder", "container", "file-list"]);

describe("the click rule, for every node type", () => {
  for (const type of ALL) {
    describe(type, () => {
      it("selects on a click and never enters", () => {
        expect(onCanvasClick({ type, event: "click", detail: 1, selected: false })).toEqual({ kind: "select" });
      });
      it("deselects on a second click on the selected node", () => {
        expect(onCanvasClick({ type, event: "click", detail: 1, selected: true })).toEqual({ kind: "deselect" });
      });
      it("ignores the second click of a double click", () => {
        expect(onCanvasClick({ type, event: "click", detail: 2, selected: true })).toEqual({ kind: "none" });
        expect(onCanvasClick({ type, event: "click", detail: 2, selected: false })).toEqual({ kind: "none" });
      });
      it(ENTER.has(type) ? "enters on a double click" : "only selects on a double click", () => {
        const action = onCanvasClick({ type, event: "dblclick", detail: 2, selected: true });
        expect(action.kind).toBe(ENTER.has(type) ? "enter" : "none");
        expect(onCanvasClick({ type, event: "dblclick", detail: 2, selected: false }).kind).toBe(ENTER.has(type) ? "enter" : "select");
      });
      it(ENTER.has(type) ? "has a next level, so the panel shows Open" : "has no next level, so the panel shows no Open", () => {
        expect(hasNextLevel(type)).toBe(ENTER.has(type));
      });
    });
  }

  it("treats a link node (portal, stand-in) as a double-click-only entry", () => {
    for (const type of ["portal", "stand-in"] as const) {
      expect(onCanvasClick({ type, event: "click", detail: 1, selected: false })).toEqual({ kind: "none" });
      expect(onCanvasClick({ type, event: "dblclick", detail: 2, selected: false })).toEqual({ kind: "enter" });
      expect(hasNextLevel(type)).toBe(true);
    }
  });

  it("walks a whole synthetic sequence: click, click with detail 2, dblclick enters only where there is a next level", () => {
    for (const type of ALL) {
      const first = onCanvasClick({ type, event: "click", detail: 1, selected: false });
      const second = onCanvasClick({ type, event: "click", detail: 2, selected: first.kind === "select" });
      const dbl = onCanvasClick({ type, event: "dblclick", detail: 2, selected: true });
      expect([first.kind, second.kind]).toEqual(["select", "none"]);
      expect(dbl.kind === "enter").toBe(ENTER.has(type));
    }
  });
});

const node = (id: string, type: string): GraphNode => ({ id, type, name: id, summary: "", tags: [], complexity: "simple" }) as unknown as GraphNode;
const edge = (source: string, target: string, type: string): GraphEdge => ({ source, target, type, direction: "forward", weight: 1 }) as unknown as GraphEdge;
const graph = {
  version: "1.0.0",
  project: { name: "x", languages: [], frameworks: [], description: "", analyzedAt: "", gitCommitHash: "" },
  nodes: [node("d:1", "domain"), node("d:2", "domain"), node("f:a", "flow"), node("f:b", "flow"), node("f:z", "flow"), node("s:1", "step")],
  edges: [edge("d:1", "f:a", "contains_flow"), edge("d:1", "f:b", "contains_flow"), edge("d:2", "f:z", "contains_flow"), edge("f:a", "s:1", "flow_step")],
  layers: [],
  tour: [],
} as unknown as KnowledgeGraph;
const groups = readFeatureGroups({
  format: "excavator-view-feature-groups/3",
  domains: {
    "d:1": [{ id: "g1", kind: "feature", label: "one", file: null, flows: [{ id: "f:a", rule: "route", scope: null, origin: null }] }, { id: "g2", kind: "feature", label: "two", file: null, flows: [{ id: "f:b", rule: "route", scope: null, origin: null }] }],
    "d:2": [{ id: "g3", kind: "feature", label: "three", file: null, flows: [{ id: "f:z", rule: "route", scope: null, origin: null }] }],
  },
});

describe("canvasHolder: the card of this level that holds a node selected from the panel", () => {
  const base = { domainGraph: graph, featureGroups: groups };
  it("is the domain card on the overview, for a domain, a flow or a step", () => {
    const ctx = { ...base, level: "overview" as const, activeDomainId: null, activeGroupId: null };
    expect([canvasHolder(ctx, "d:1"), canvasHolder(ctx, "f:z"), canvasHolder(ctx, "s:1")]).toEqual(["d:1", "d:2", "d:1"]);
  });
  it("is the group card at the group level, and null for a node of another domain", () => {
    const ctx = { ...base, level: "groups" as const, activeDomainId: "d:1", activeGroupId: null };
    expect([canvasHolder(ctx, "f:b"), canvasHolder(ctx, "s:1"), canvasHolder(ctx, "f:z"), canvasHolder(ctx, "d:2")]).toEqual(["group:g2", "group:g1", null, null]);
  });
  it("is the node itself in the lanes when the open group's rows hold it, else null", () => {
    const ctx = { ...base, level: "lanes" as const, activeDomainId: "d:1", activeGroupId: "g1" };
    expect([canvasHolder(ctx, "f:a"), canvasHolder(ctx, "s:1"), canvasHolder(ctx, "f:b")]).toEqual(["f:a", "s:1", null]);
  });
});

describe("goToTarget: the level that holds a node", () => {
  const ctx = { domainGraph: graph, featureGroups: groups };
  it("is the lanes of the group that holds a flow, whatever the current level", () => {
    expect(goToTarget(ctx, "f:b")).toEqual({ activeDomainId: "d:1", activeGroupId: "g2" });
    expect(goToTarget(ctx, "f:z")).toEqual({ activeDomainId: "d:2", activeGroupId: "g3" });
  });
  it("is the lanes of the flow's group for a step", () => {
    expect(goToTarget(ctx, "s:1")).toEqual({ activeDomainId: "d:1", activeGroupId: "g1" });
  });
  it("is the overview for a domain, which is selected there and not opened", () => {
    expect(goToTarget(ctx, "d:2")).toEqual({ activeDomainId: null, activeGroupId: null });
  });
  it("is null for a node the graph does not have", () => {
    expect(goToTarget(ctx, "nope")).toBeNull();
  });
});
