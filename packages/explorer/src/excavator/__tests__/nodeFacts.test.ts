import { describe, expect, it } from "vitest";
import { coChangedFiles, docUnitsCitingFile, hotspotOfFile, unusedOfNode } from "../nodeFacts";

const hotspots = {
  files: [
    { path: "svc/a.go", score: 10, commits: 8, authors: 3, lastChanged: "2024-06-01" },
    { path: "svc/b.go", score: 20, commits: 12, authors: 4, lastChanged: "2024-07-01" },
    { path: "svc/c.go", score: 5, commits: 2 },
  ],
  coChange: [],
  pairs: [
    { a: "svc/a.go", b: "svc/b.go", together: 6 },
    { a: "svc/c.go", b: "svc/a.go", together: 9 },
    { a: "svc/b.go", b: "svc/c.go", together: 1 },
  ],
};

describe("hotspotOfFile", () => {
  it("gives the file's counts and its 1-based rank by score over all files", () => {
    expect(hotspotOfFile(hotspots, "svc/a.go")).toEqual({ commits: 8, authors: 3, lastChanged: "2024-06-01", rank: 2 });
    expect(hotspotOfFile(hotspots, "svc/b.go")?.rank).toBe(1);
    expect(hotspotOfFile(hotspots, "svc/c.go")).toEqual({ commits: 2, authors: null, lastChanged: null, rank: 3 });
  });

  it("is null for a file the product does not list and for a product that is not a table", () => {
    expect(hotspotOfFile(hotspots, "nope.go")).toBeNull();
    expect(hotspotOfFile(null, "svc/a.go")).toBeNull();
    expect(hotspotOfFile({ files: "x" }, "svc/a.go")).toBeNull();
  });
});

describe("coChangedFiles", () => {
  it("lists the files changed together with the file, most first, up to n", () => {
    expect(coChangedFiles(hotspots, "svc/a.go", 5)).toEqual([
      { path: "svc/c.go", together: 9 },
      { path: "svc/b.go", together: 6 },
    ]);
    expect(coChangedFiles(hotspots, "svc/a.go", 1)).toEqual([{ path: "svc/c.go", together: 9 }]);
  });

  it("is empty when the product has no pairs", () => {
    expect(coChangedFiles({ files: [] }, "svc/a.go", 5)).toEqual([]);
    expect(coChangedFiles(null, "svc/a.go", 5)).toEqual([]);
  });
});

describe("unusedOfNode", () => {
  const unused = {
    unused: [
      { id: "function:svc/a.go:helper", name: "helper", file: "svc/a.go", lineRange: [40, 50], confidence: "high", reason: "unreferenced" },
      { id: "function:svc/a.go:early", name: "early", file: "svc/a.go", lineRange: [3, 9], confidence: "low", reason: "only-reachable-from-unused" },
      { id: "function:svc/b.go:other", name: "other", file: "svc/b.go", lineRange: [1, 2], confidence: "medium", reason: "unreferenced" },
    ],
  };

  it("for a function node gives the candidate with that id", () => {
    expect(unusedOfNode(unused, { id: "function:svc/a.go:helper", type: "function", filePath: "svc/a.go" })).toEqual([
      { id: "function:svc/a.go:helper", name: "helper", line: 40, confidence: "high", reason: "unreferenced" },
    ]);
    expect(unusedOfNode(unused, { id: "method:svc/a.go:nothing", type: "method" })).toEqual([]);
  });

  it("for a file node gives every candidate in that file, by line", () => {
    expect(unusedOfNode(unused, { id: "file:svc/a.go", type: "file", filePath: "svc/a.go" }).map((r) => r.id)).toEqual(["function:svc/a.go:early", "function:svc/a.go:helper"]);
    expect(unusedOfNode(unused, { id: "file:svc/z.go", type: "file", filePath: "svc/z.go" })).toEqual([]);
    expect(unusedOfNode(unused, { id: "file:x", type: "file" })).toEqual([]);
  });

  it("is empty without a product", () => {
    expect(unusedOfNode(null, { id: "file:svc/a.go", type: "file", filePath: "svc/a.go" })).toEqual([]);
  });
});

describe("docUnitsCitingFile", () => {
  const docMap = {
    units: [
      { document: "guide.md", id: "U1", title: "Invoice a customer", code: { status: "found", evidence: [{ file: "svc/a.go", line: 10, code: "x" }] } },
      { document: "guide.md", id: "U2", title: "Refund", code: { status: "found", evidence: [{ file: "svc/b.go", line: 4, code: "y" }, { file: "svc/a.go", line: 12, code: "z" }] } },
      { document: "ops.md", id: "U3", title: "No code", code: { status: "not-found", evidence: [] } },
    ],
  };
  const checks = [{ unit: 1, file: "svc/a.go", line: 10, verdict: "does" }];

  it("lists the units whose evidence cites the file with their verdict text", () => {
    expect(docUnitsCitingFile(docMap, checks, "svc/a.go")).toEqual([
      { document: "guide.md", id: "U1", title: "Invoice a customer", verdict: "does 1 / not 0 / none 0" },
      { document: "guide.md", id: "U2", title: "Refund", verdict: "not checked" },
    ]);
    expect(docUnitsCitingFile(docMap, checks, "svc/z.go")).toEqual([]);
  });

  it("works without checks and is empty without a doc map", () => {
    expect(docUnitsCitingFile(docMap, null, "svc/b.go").map((r) => r.id)).toEqual(["U2"]);
    expect(docUnitsCitingFile(null, null, "svc/a.go")).toEqual([]);
    expect(docUnitsCitingFile({ units: "x" }, null, "svc/a.go")).toEqual([]);
  });
});
