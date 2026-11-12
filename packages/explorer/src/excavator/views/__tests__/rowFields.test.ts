import { describe, expect, it } from "vitest";
import { NOT_PROVIDED } from "../../products/format";
import { directoryFields, fileFields, unusedFields } from "../rowFields";
import { normalizeRow } from "../../products/unused";

const label = (fields: { label: string; text: string | null }[], name: string) => fields.find((f) => f.label === name)?.text;

describe("unusedFields", () => {
  it("lists the row's own fields as text and leaves what it does not hold null", () => {
    const row = normalizeRow({ id: "function:src/a.js:run", name: "run", owner: "A", language: "javascript", file: "src/a.js", lineRange: [3, 9], reason: "unreferenced", confidence: "high", group: 2 });
    const fields = unusedFields(row);
    expect(label(fields, "Name")).toBe("run");
    expect(label(fields, "Id")).toBe("function:src/a.js:run");
    expect(label(fields, "Location")).toBe("src/a.js:3-9");
    expect(label(fields, "Confidence")).toBe("high");
    expect(label(fields, "Group")).toBe("2");
    expect(label(fields, "Visibility")).toBeNull();
  });
});

describe("fileFields", () => {
  it("shows numbers grouped and a missing field as not provided, never 0", () => {
    const fields = fileFields({ path: "src/a.js", score: 12345, commits: 12, authors: 2, added: 100, removed: 4, lines: 80, lastChanged: "2026-01-02T03:04:05Z" });
    expect(label(fields, "Path")).toBe("src/a.js");
    expect(label(fields, "Score")).toBe("12,345");
    expect(label(fields, "Last changed")).toBe("2026-01-02T03:04:05Z");
    expect(label(fields, "Lineage conflicts")).toBe(NOT_PROVIDED);
  });

  it("leaves a null field empty", () => {
    expect(label(fileFields({ path: "bin/x.png", score: null, commits: 3, lines: null }), "Score")).toBeNull();
    expect(label(fileFields({ path: "bin/x.png", score: null, commits: 3, lines: null }), "Lines")).toBeNull();
  });
});

describe("directoryFields", () => {
  it("shows the counts, the concentration fields and, for an older product, not provided", () => {
    const fields = directoryFields({ path: "src", score: 9, commits: 4, authors: 2, files: 3, lines: 50, added: 7, removed: 1, lastChanged: "2026-02-01T00:00:00Z", concentration: { commitsByPeople: 4, topAuthorShare: 0.5, authorsFor80Percent: 2 } });
    expect(label(fields, "Path")).toBe("src");
    expect(label(fields, "Files")).toBe("3");
    expect(label(fields, "Top author share")).toBe("0.5");
    expect(label(fields, "Authors for 80%")).toBe("2");
    expect(label(directoryFields({ path: "src" }), "Top author share")).toBe(NOT_PROVIDED);
  });

  it("names the project root directory in words", () => {
    expect(label(directoryFields({ path: "." }), "Path")).toBe(". (the project root)");
  });
});
