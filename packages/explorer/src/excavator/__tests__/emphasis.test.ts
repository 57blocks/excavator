import { describe, expect, it } from "vitest";
import { DIMMED_OPACITY, emphasis, laneBandId, laneStepId } from "../emphasis";

const edge = (id: string, source: string, target: string) => ({ id, source, target });

describe("emphasis", () => {
  it("is null when nothing is selected", () => {
    expect(emphasis({ level: "overview", selectedId: null, nodes: [{ id: "a" }], edges: [] })).toBeNull();
    expect(DIMMED_OPACITY).toBe(0.3);
  });

  it("keeps a selected domain, the domains it shares a cross-domain edge with, and those edges", () => {
    const nodes = ["a", "b", "c", "d"].map((id) => ({ id }));
    const edges = [edge("ab", "a", "b"), edge("ca", "c", "a"), edge("cd", "c", "d")];
    const full = emphasis({ level: "overview", selectedId: "a", nodes, edges })!;
    expect([...full.nodes].sort()).toEqual(["a", "b", "c"]);
    expect([...full.edges].sort()).toEqual(["ab", "ca"]);
  });

  it("keeps only the selected card at the group level", () => {
    const full = emphasis({ level: "groups", selectedId: "group:x", nodes: [{ id: "group:x" }, { id: "group:y" }], edges: [] })!;
    expect([...full.nodes]).toEqual(["group:x"]);
    expect(full.edges.size).toBe(0);
  });

  describe("lanes", () => {
    const rows = [
      { flowId: "f1", steps: ["s1", "s2"] },
      { flowId: "f2", steps: ["s2", "s3"] },
    ];
    const nodes = [
      ...rows.flatMap((row) => [{ id: laneBandId(row.flowId) }, { id: row.flowId }, ...row.steps.map((step) => ({ id: laneStepId(row.flowId, step) }))]),
    ];
    const edges = rows.flatMap((row) => row.steps.map((step, i) => edge(`e:${row.flowId}:${step}`, i === 0 ? row.flowId : laneStepId(row.flowId, row.steps[i - 1]), laneStepId(row.flowId, step))));

    it("keeps the flow's whole row when a flow is selected, and dims the other rows", () => {
      const full = emphasis({ level: "lanes", selectedId: "f1", nodes, edges, rows })!;
      expect([...full.nodes].sort()).toEqual([laneBandId("f1"), "f1", laneStepId("f1", "s1"), laneStepId("f1", "s2")].sort());
      expect([...full.edges].sort()).toEqual(["e:f1:s1", "e:f1:s2"]);
    });

    it("keeps the row of a selected step", () => {
      const full = emphasis({ level: "lanes", selectedId: "s3", nodes, edges, rows })!;
      expect(full.nodes.has("f2")).toBe(true);
      expect(full.nodes.has("f1")).toBe(false);
    });

    it("keeps every row that holds a step shared by two flows", () => {
      const full = emphasis({ level: "lanes", selectedId: "s2", nodes, edges, rows })!;
      expect(full.nodes.has("f1") && full.nodes.has("f2")).toBe(true);
    });
  });

  it("keeps the selected node, its neighbours and the edges between them in the structural view", () => {
    const nodes = ["a", "b", "c", "d"].map((id) => ({ id }));
    const edges = [edge("ab", "a", "b"), edge("bc", "b", "c"), edge("cd", "c", "d"), edge("ac", "a", "c")];
    const full = emphasis({ level: "structural", selectedId: "a", nodes, edges })!;
    expect([...full.nodes].sort()).toEqual(["a", "b", "c"]);
    expect([...full.edges].sort()).toEqual(["ab", "ac", "bc"]);
  });
});
