import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { describeProductState, loadProductStates, readProductStates, revisionNotice, snapshotRevisionOf } from "../productStates";

const entry = (name: string, over: Record<string, unknown> = {}) => ({
  name,
  status: "included",
  reason: null,
  revision: "git:aaa",
  revisionNote: null,
  command: `/excavator-${name}`,
  ...over,
});

describe("reading products.json into a status", () => {
  it("reads each of the four states for the three products", () => {
    const states = readProductStates({
      products: [
        entry("unused-code"),
        entry("hotspots", { status: "not-run", revision: null }),
        entry("doc-map", { status: "unreadable", reason: "doc-map.json is not valid JSON", revision: null }),
      ],
    });
    expect(states.unused).toMatchObject({ status: "included", revision: "git:aaa", command: "/excavator-unused-code" });
    expect(states.hotspots).toMatchObject({ status: "not-run", command: "/excavator-hotspots" });
    expect(states["doc-map"]).toMatchObject({ status: "unreadable", reason: "doc-map.json is not valid JSON" });
    const other = readProductStates({ products: [entry("unused-code", { status: "different-revision", revision: "git:bbb" })] });
    expect(other.unused).toMatchObject({ status: "different-revision", revision: "git:bbb" });
  });

  it("says a product is unreadable, with the reason, when products.json lacks it or is not an object", () => {
    const missing = readProductStates({ products: [entry("unused-code")] });
    expect(missing.hotspots).toMatchObject({ status: "unreadable", reason: "products.json has no entry for hotspots" });
    for (const bad of [undefined, null, 3, "x", [], { products: "no" }]) {
      const states = readProductStates(bad);
      expect(states.unused).toMatchObject({ status: "unreadable", reason: "products.json is not in this page or is not in the expected shape" });
      expect(states["doc-map"].status).toBe("unreadable");
    }
  });

  it("never reads a status it does not know as one it does", () => {
    const states = readProductStates({ products: [entry("unused-code", { status: "fine" })] });
    expect(states.unused).toMatchObject({ status: "unreadable", reason: 'products.json gives unused-code the unknown status "fine"' });
  });

  it("takes the packed source revision from products.json, when it names one", () => {
    expect(snapshotRevisionOf({ snapshotRevision: "git:a", products: [] })).toBe("git:a");
    expect(snapshotRevisionOf({ snapshotRevision: "", products: [] })).toBeNull();
    expect(snapshotRevisionOf({ products: [] })).toBeNull();
    expect(snapshotRevisionOf(undefined)).toBeNull();
  });
});

describe("describing a product's state", () => {
  const states = readProductStates({
    products: [
      entry("unused-code"),
      entry("hotspots", { status: "not-run", revision: null }),
      entry("doc-map", { status: "different-revision", revision: "git:old" }),
    ],
  });

  it("gives not run its status and the command", () => {
    expect(describeProductState(states.hotspots, null)).toEqual(["Status: not run", "Command: /excavator-hotspots"]);
    const withReason = readProductStates({ products: [entry("hotspots", { status: "not-run", reason: "hotspots.json was not produced" })] });
    expect(describeProductState(withReason.hotspots, null)).toEqual(["Status: not run", "Reason: hotspots.json was not produced", "Command: /excavator-hotspots"]);
  });

  it("gives unreadable its reason", () => {
    const broken = readProductStates({ products: [entry("unused-code", { status: "unreadable", reason: "bad format", revision: null })] });
    expect(describeProductState(broken.unused, null)).toEqual(["Status: unreadable", "Reason: bad format"]);
  });

  it("gives a different revision both revisions, and says when the packed one is not known", () => {
    expect(describeProductState(states["doc-map"], "git:new")).toEqual(["Status: different revision", "Made from revision: git:old", "Packed source revision: git:new"]);
    expect(describeProductState(states["doc-map"], null)[2]).toBe("Packed source revision: not recorded in this page");
  });

  it("gives an included product its revision or the note that it records none", () => {
    expect(describeProductState(states.unused, null)).toEqual(["Status: included", "Revision: git:aaa"]);
    const none = readProductStates({ products: [entry("unused-code", { revision: null, revisionNote: "no revision recorded" })] });
    expect(describeProductState(none.unused, null)).toEqual(["Status: included", "Revision: no revision recorded"]);
  });
});

describe("the notice for a product made from another revision", () => {
  it("names both revisions", () => {
    const text = revisionNotice({ status: "different-revision", reason: null, revision: "git:bbb", revisionNote: null, command: null }, "git:aaa");
    expect(text).toContain("git:bbb");
    expect(text).toContain("git:aaa");
  });

  it("says when a revision is not recorded and has no notice for other states", () => {
    const text = revisionNotice({ status: "different-revision", reason: null, revision: null, revisionNote: null, command: null }, null);
    expect(text).toContain("not recorded");
    expect(revisionNotice({ status: "included", reason: null, revision: "git:aaa", revisionNote: null, command: null }, "git:aaa")).toBeNull();
  });
});

describe("loading products.json from the page", () => {
  const scope = globalThis as Record<string, unknown>;
  afterEach(() => {
    delete scope.document;
  });

  /** A document with a products.json part: the bytes are the part's base64 text. */
  const pageWith = (base64: string) => {
    const elements: Record<string, { textContent: string }> = {
      "xv-explorer-index": { textContent: JSON.stringify({ version: 1, files: { "products.json": { value: 0 } } }) },
      "xv-part-0": { textContent: base64 },
    };
    scope.document = { getElementById: (id: string) => elements[id] ?? null };
  };

  it("reads the states from a part that decodes", async () => {
    pageWith(gzipSync(Buffer.from(JSON.stringify({ snapshotRevision: "git:aaa", products: [entry("unused-code")] }), "utf-8")).toString("base64"));
    const loaded = await loadProductStates();
    expect(loaded.snapshotRevision).toBe("git:aaa");
    expect(loaded.states.unused).toMatchObject({ status: "included" });
  });

  it("carries the reader's own error into each product's reason when the part cannot be decoded", async () => {
    pageWith(Buffer.from("not gzip", "utf-8").toString("base64"));
    const { states, snapshotRevision } = await loadProductStates();
    expect(snapshotRevision).toBeNull();
    for (const view of ["unused", "hotspots", "doc-map"] as const) {
      expect(states[view].status).toBe("unreadable");
      expect(states[view].reason).toMatch(/^products\.json could not be read: /);
      expect(states[view].reason).not.toMatch(/not in the expected shape/);
    }
  });

  it("says the file is not in the page when the index does not list it", async () => {
    scope.document = { getElementById: (id: string) => (id === "xv-explorer-index" ? { textContent: JSON.stringify({ version: 1, files: {} }) } : null) };
    const { states } = await loadProductStates();
    expect(states.unused).toMatchObject({ status: "unreadable", reason: "products.json is not included in this page" });
  });
});
