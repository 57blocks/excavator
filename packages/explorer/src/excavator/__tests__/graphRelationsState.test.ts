import { describe, expect, it } from "vitest";
import { productStateFromJson } from "../productStates";
import { unavailableOf } from "../useGraphRelations";

const entry = (status: string, over: Record<string, unknown> = {}) => ({
  name: "relations",
  status,
  reason: null,
  revision: "git:aaa",
  revisionNote: null,
  command: "/excavator-relations",
  ...over,
});
const loaded = (item: Record<string, unknown>, file: Parameters<typeof unavailableOf>[0]["file"]) => ({
  state: productStateFromJson({ products: [item] }, "relations"),
  snapshotRevision: "git:bbb",
  file,
});
const TABLE = { state: "ready" as const, value: { relations: [] } };

describe("when the graph draws the relations product", () => {
  it("draws an included product whose file reads as a table", () => {
    expect(unavailableOf(loaded(entry("included"), TABLE))).toBeNull();
  });

  it("draws nothing for a product not run, unreadable or from another revision, and says why", () => {
    expect(unavailableOf(loaded(entry("not-run", { reason: "relations-graph.json was not found" }), null))).toEqual({
      word: "not run",
      lines: ["Status: not run", "Reason: relations-graph.json was not found", "Command: /excavator-relations"],
    });
    expect(unavailableOf(loaded(entry("unreadable", { reason: "relations-graph.json is not valid JSON" }), null))).toEqual({
      word: "unreadable",
      lines: ["Status: unreadable", "Reason: relations-graph.json is not valid JSON"],
    });
    // Its node ids may be ids into other facts, so it is not drawn even though the file reads.
    expect(unavailableOf(loaded(entry("different-revision"), TABLE))).toEqual({
      word: "different revision",
      lines: ["Status: different revision", "Made from revision: git:aaa", "Packed source revision: git:bbb"],
    });
  });

  it("draws nothing for an included product whose file is missing or not a table", () => {
    expect(unavailableOf(loaded(entry("included"), { state: "missing", reason: "relations-graph.json could not be read: bad part" }))).toEqual({
      word: "unreadable",
      lines: ["Status: unreadable", "Reason: relations-graph.json could not be read: bad part"],
    });
    expect(unavailableOf(loaded(entry("included"), { state: "ready", value: [] }))?.lines).toEqual([
      "Status: unreadable",
      "Reason: relations-graph.json is not in the expected shape",
    ]);
  });
});
