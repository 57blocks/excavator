import { describe, expect, it } from "vitest";
import type { GraphEdge, GraphNode, KnowledgeGraph } from "../../core/types";
import { groupHoldingFlow, groupsOf, laneRows, locateInDomain, panelFlows, readFeatureGroups, splitOrigin } from "../domainLevels";
import { projectText } from "../projectText";

const FORMAT = "excavator-view-feature-groups/3";

const domain = (id: string): GraphNode => ({ id, type: "domain", name: id, summary: "", tags: [], complexity: "simple" });
const flow = (id: string, meta: GraphNode["domainMeta"] = {}, name = id): GraphNode => ({ id, type: "flow", name, summary: "", tags: [], complexity: "simple", domainMeta: meta });
const step = (id: string): GraphNode => ({ id, type: "step", name: id, summary: "", tags: [], complexity: "simple" });
const edge = (source: string, target: string, type: GraphEdge["type"], weight = 1): GraphEdge => ({ source, target, type, direction: "forward", weight });

const graphOf = (nodes: GraphNode[], edges: GraphEdge[]): KnowledgeGraph => ({
  version: "1.0.0",
  project: { name: "fixture", languages: [], frameworks: [], description: "", analyzedAt: "", gitCommitHash: "" },
  nodes, edges, layers: [], tour: [],
});

const group = (id: string, flowIds: string[], extra: Record<string, unknown> = {}) => ({
  id, kind: "feature", label: id, file: null, flows: flowIds.map((flowId) => ({ id: flowId, rule: "route", scope: null, origin: null })), ...extra,
});

describe("readFeatureGroups", () => {
  it("accepts the packed shape", () => {
    const read = readFeatureGroups({ format: FORMAT, domains: { "d:1": [group("g", ["f:1"])] } });
    expect(read.state).toBe("ready");
  });
  it.each([
    ["nothing", undefined],
    ["a non-object", 7],
    ["another format", { format: "other/1", domains: {} }],
    ["a format prefix of another product", { format: "excavator-view-feature-groups", domains: {} }],
    ["domains that are not an object", { format: FORMAT, domains: [] }],
    ["a group list that is not an array", { format: FORMAT, domains: { d: {} } }],
    ["a group without a label", { format: FORMAT, domains: { d: [{ id: "g", kind: "feature", file: null, flows: [] }] } }],
    ["a flow without an id", { format: FORMAT, domains: { d: [{ id: "g", kind: "feature", label: "x", file: null, flows: [{ rule: "route" }] }] } }],
  ])("says missing, with a reason, for %s", (_name, value) => {
    const read = readFeatureGroups(value);
    expect(read.state).toBe("missing");
    if (read.state === "missing") expect(read.reason).not.toBe("");
  });
  it("reads a missing qualifier as null and keeps a string one", () => {
    const read = readFeatureGroups({ format: FORMAT, domains: { d: [group("a", []), group("b", [], { qualifier: "hr/service" })] } });
    expect(read.state === "ready" && read.domains.d.map((g) => g.qualifier)).toEqual([null, "hr/service"]);
  });
  it("says missing for a qualifier that is not a string or null", () => {
    expect(readFeatureGroups({ format: FORMAT, domains: { d: [group("a", [], { qualifier: 3 })] } }).state).toBe("missing");
  });
  it("accepts a later version of the same format family", () => {
    expect(readFeatureGroups({ format: "excavator-view-feature-groups/4", domains: {} }).state).toBe("ready");
  });
});

describe("groupsOf", () => {
  const g = graphOf([domain("d:1"), flow("f:a"), flow("f:b")], [edge("d:1", "f:a", "contains_flow"), edge("d:1", "f:b", "contains_flow")]);
  it("is one group with every contains_flow target, in graph order, when the groups are missing", () => {
    const groups = groupsOf(readFeatureGroups(undefined), g, "d:1");
    expect(groups).toEqual([{ id: "all", kind: "other", label: "All flows", qualifier: null, description: null, codeLabel: null, file: null, flows: [
      { id: "f:a", rule: "none", scope: null, origin: null },
      { id: "f:b", rule: "none", scope: null, origin: null },
    ] }]);
  });
  it("is the domain's own groups when they are ready", () => {
    const ready = readFeatureGroups({ format: FORMAT, domains: { "d:1": [group("x", ["f:a"]), group("y", ["f:b"])] } });
    expect(groupsOf(ready, g, "d:1").map((item) => item.id)).toEqual(["x", "y"]);
  });
  it("falls back to the one group for a domain the groups do not list", () => {
    const ready = readFeatureGroups({ format: FORMAT, domains: { "d:other": [] } });
    expect(groupsOf(ready, g, "d:1").map((item) => item.id)).toEqual(["all"]);
  });
});

describe("laneRows", () => {
  it("sorts by route entry, then entry type and point, then name, then id", () => {
    const nodes = [
      flow("f:cron", { entryType: "cron", entryPoint: "nightly" }),
      flow("f:post", { entryType: "http", entryPoint: "POST /orders" }),
      flow("f:get", { entryType: "http", entryPoint: "GET /orders" }),
      flow("f:cli", { entryType: "cli", entryPoint: "run" }),
      flow("f:b", { entryType: "manual" }, "Same"),
      flow("f:a", { entryType: "manual" }, "Same"),
    ];
    const rows = laneRows(graphOf(nodes, []), nodes.map((n) => n.id));
    expect(rows.map((row) => row.flowId)).toEqual(["f:get", "f:post", "f:cli", "f:cron", "f:a", "f:b"]);
  });
  it("orders steps by flow_step weight and keeps graph order for ties", () => {
    const nodes = [flow("f:1"), step("s:a"), step("s:b"), step("s:c")];
    const edges = [edge("f:1", "s:a", "flow_step", 0.5), edge("f:1", "s:b", "flow_step", 0.2), edge("f:1", "s:c", "flow_step", 0.5)];
    expect(laneRows(graphOf(nodes, edges), ["f:1"])).toEqual([{ flowId: "f:1", steps: ["s:b", "s:a", "s:c"] }]);
  });
  it("gives a flow without steps an empty row, and skips ids that are not flows", () => {
    const nodes = [flow("f:1")];
    expect(laneRows(graphOf(nodes, []), ["f:1", "f:missing"])).toEqual([{ flowId: "f:1", steps: [] }]);
  });
});

describe("locateInDomain", () => {
  const nodes = [domain("d:1"), domain("d:2"), flow("f:a"), flow("f:b"), step("s:1"), step("s:2"), step("s:orphan")];
  const edges = [
    edge("d:1", "f:a", "contains_flow"), edge("d:2", "f:b", "contains_flow"),
    edge("f:a", "s:1", "flow_step"), edge("f:b", "s:1", "flow_step"), edge("f:b", "s:2", "flow_step"),
  ];
  const g = graphOf(nodes, edges);
  const ready = readFeatureGroups({ format: FORMAT, domains: { "d:1": [group("ga", ["f:a"])], "d:2": [group("gb", ["f:b"])] } });
  it("finds the domain and group of a flow", () => {
    expect(locateInDomain(ready, g, "f:b")).toEqual({ domainId: "d:2", groupId: "gb" });
  });
  it("finds a step through the first flow whose flow_step edge holds it", () => {
    expect(locateInDomain(ready, g, "s:1")).toEqual({ domainId: "d:1", groupId: "ga" });
    expect(locateInDomain(ready, g, "s:2")).toEqual({ domainId: "d:2", groupId: "gb" });
  });
  it("finds a domain without a group, and nothing for a step no flow holds", () => {
    expect(locateInDomain(ready, g, "d:2")).toEqual({ domainId: "d:2", groupId: null });
    expect(locateInDomain(ready, g, "s:orphan")).toBeNull();
    expect(locateInDomain(ready, g, "nope")).toBeNull();
  });
  it("uses the all-flows group when the groups are missing", () => {
    expect(locateInDomain(readFeatureGroups(undefined), g, "f:a")).toEqual({ domainId: "d:1", groupId: "all" });
  });
  it("names the group of a flow in one domain", () => {
    expect(groupHoldingFlow(groupsOf(ready, g, "d:1"), "f:a")?.id).toBe("ga");
    expect(groupHoldingFlow(groupsOf(ready, g, "d:1"), "f:b")).toBeNull();
  });
});

describe("splitOrigin", () => {
  it("splits a former label from its qualifier", () => {
    expect(splitOrigin("resource pool \u00b7 hr/service")).toEqual({ label: "resource pool", qualifier: "hr/service" });
    expect(splitOrigin("plain")).toEqual({ label: "plain", qualifier: null });
  });
});

describe("panelFlows", () => {
  const nodes = [domain("d:1"), flow("f:a"), flow("f:b"), flow("f:c")];
  const edges = [edge("d:1", "f:a", "contains_flow"), edge("d:1", "f:b", "contains_flow"), edge("d:1", "f:c", "contains_flow")];
  const g = graphOf(nodes, edges);
  const ready = readFeatureGroups({ format: FORMAT, domains: { "d:1": [group("x", ["f:c", "f:a"]), group("y", ["f:b"])] } });
  it("lists every flow of the domain, in graph order, when no group is open", () => {
    expect(panelFlows(ready, g, "d:1", "d:1", null)).toEqual({ group: null, flowIds: ["f:a", "f:b", "f:c"] });
  });
  it("lists only the open group's flows, in group order, with the group", () => {
    const shown = panelFlows(ready, g, "d:1", "d:1", "x");
    expect(shown.flowIds).toEqual(["f:c", "f:a"]);
    expect(shown.group?.id).toBe("x");
  });
  it("ignores an open group when the panel shows another domain, or the group is unknown", () => {
    expect(panelFlows(ready, g, "d:1", "d:2", "x").group).toBeNull();
    expect(panelFlows(ready, g, "d:1", "d:1", "nope").flowIds).toEqual(["f:a", "f:b", "f:c"]);
  });
});

describe("readFeatureGroups with stored groups and project texts", () => {
  const stored = {
    format: FORMAT,
    named: ["d:named"],
    project: { introduction: "Intro text.", technicalOverview: "Tech text." },
    domains: {
      "d:named": [group("g1", ["f:1"], { label: "Stored name", description: "Does a thing.", codeLabel: "thing", qualifier: undefined })],
      "d:plain": [group("g2", ["f:2"], { label: "word", qualifier: "svc" })],
    },
  };
  it("reads the stored name, description and code label, the computed qualifier, and the project texts", () => {
    const read = readFeatureGroups(stored);
    expect(read.state).toBe("ready");
    if (read.state !== "ready") return;
    expect(read.project).toEqual({ introduction: "Intro text.", technicalOverview: "Tech text." });
    expect(read.projectReason).toBeNull();
    expect(read.named).toEqual(["d:named"]);
    expect(read.domains["d:named"][0]).toMatchObject({ label: "Stored name", description: "Does a thing.", codeLabel: "thing", qualifier: null });
    expect(read.domains["d:plain"][0]).toMatchObject({ label: "word", qualifier: "svc", description: null, codeLabel: null });
  });
  it("reads today's data, with no project and no descriptions", () => {
    const read = readFeatureGroups({ format: FORMAT, domains: { d: [group("g", ["f"])] } });
    expect(read.state === "ready" && [read.project, read.projectReason, read.named, read.domains.d[0].description]).toEqual([null, null, [], null]);
  });
  it("reads the unavailable shape", () => {
    const read = readFeatureGroups({ ...stored, project: { introduction: null, technicalOverview: null, unavailable: "the texts failed the check" } });
    expect(read.state === "ready" && read.project).toEqual({ introduction: null, technicalOverview: null, unavailable: "the texts failed the check" });
  });
  it.each([
    ["one text empty", { introduction: "x", technicalOverview: "  " }],
    ["a text that is not a string", { introduction: 3, technicalOverview: "y" }],
    ["unavailable without a reason", { introduction: null, technicalOverview: null, unavailable: "" }],
    ["not an object", "text"],
  ])("gives project null and a reason for a bad project: %s", (_name, project) => {
    const read = readFeatureGroups({ ...stored, project });
    expect(read.state).toBe("ready");
    if (read.state === "ready") {
      expect(read.project).toBeNull();
      expect(read.projectReason).not.toBeNull();
      expect(read.domains["d:named"]).toHaveLength(1);
    }
  });
  it("says missing for a description or code label that is not a string or null", () => {
    expect(readFeatureGroups({ format: FORMAT, domains: { d: [group("a", [], { description: 3 })] } }).state).toBe("missing");
    expect(readFeatureGroups({ format: FORMAT, domains: { d: [group("a", [], { codeLabel: {} })] } }).state).toBe("missing");
  });
});

describe("projectText", () => {
  const both = { introduction: "Stored intro.", technicalOverview: "Stored tech." };
  it("is the stored text when present", () => {
    expect(projectText(both, "introduction", "Graph text.")).toEqual({ kind: "text", text: "Stored intro." });
    expect(projectText(both, "technicalOverview", null)).toEqual({ kind: "text", text: "Stored tech." });
  });
  it("is the unavailable reason when the stored project says so", () => {
    expect(projectText({ introduction: null, technicalOverview: null, unavailable: "failed" }, "introduction", "Graph text.")).toEqual({ kind: "unavailable", reason: "failed" });
  });
  it("is the knowledge graph's description when there is no stored project", () => {
    expect(projectText(null, "introduction", "  Graph text.  ")).toEqual({ kind: "text", text: "Graph text." });
  });
  it("is none when nothing is there", () => {
    expect(projectText(null, "technicalOverview", "")).toEqual({ kind: "none" });
    expect(projectText(null, "introduction", null)).toEqual({ kind: "none" });
  });
});
