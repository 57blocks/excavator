import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { describeProductState, productStateFromJson, readJson, snapshotRevisionOf } from "../productStates";

const entry = (name: string, over: Record<string, unknown> = {}) => ({
  name,
  status: "included",
  reason: null,
  revision: "git:aaa",
  revisionNote: null,
  command: `/excavator-${name}`,
  ...over,
});

const stateOf = (products: unknown, name: string) => productStateFromJson(products, name);

describe("reading products.json into a status", () => {
  it("reads the relations product with its coverage report's own state, and none when products.json gives none", () => {
    const state = stateOf({ products: [entry("relations", { coverage: { state: "other-run", reason: "written by another run" } })] }, "relations");
    expect(state).toMatchObject({ status: "included", command: "/excavator-relations", coverage: { state: "other-run", reason: "written by another run" } });
    expect(stateOf({ products: [entry("relations")] }, "relations").coverage).toBeNull();
    expect(stateOf({ products: [] }, "relations")).toMatchObject({ status: "unreadable", reason: "products.json has no entry for relations" });
  });

  it("reads each of the four states", () => {
    const products = {
      products: [
        entry("unused-code"),
        entry("hotspots", { status: "not-run", revision: null }),
        entry("doc-map", { status: "unreadable", reason: "doc-map.json is not valid JSON", revision: null }),
        entry("relations", { status: "different-revision", revision: "git:bbb" }),
      ],
    };
    expect(stateOf(products, "unused-code")).toMatchObject({ status: "included", revision: "git:aaa", command: "/excavator-unused-code" });
    expect(stateOf(products, "hotspots")).toMatchObject({ status: "not-run", command: "/excavator-hotspots" });
    expect(stateOf(products, "doc-map")).toMatchObject({ status: "unreadable", reason: "doc-map.json is not valid JSON" });
    expect(stateOf(products, "relations")).toMatchObject({ status: "different-revision", revision: "git:bbb" });
  });

  it("says a product is unreadable, with the reason, when products.json lacks it or is not an object", () => {
    expect(stateOf({ products: [entry("unused-code")] }, "hotspots")).toMatchObject({ status: "unreadable", reason: "products.json has no entry for hotspots" });
    for (const bad of [undefined, null, 3, "x", [], { products: "no" }]) {
      expect(stateOf(bad, "unused-code")).toMatchObject({ status: "unreadable", reason: "products.json is not in this page or is not in the expected shape" });
    }
    expect(productStateFromJson(undefined, "unused-code", "products.json could not be read: bad part").reason).toBe("products.json could not be read: bad part");
  });

  it("never reads a status it does not know as one it does", () => {
    expect(stateOf({ products: [entry("unused-code", { status: "fine" })] }, "unused-code")).toMatchObject({
      status: "unreadable",
      reason: 'products.json gives unused-code the unknown status "fine"',
    });
  });

  it("takes the packed source revision from products.json, when it names one", () => {
    expect(snapshotRevisionOf({ snapshotRevision: "git:a", products: [] })).toBe("git:a");
    expect(snapshotRevisionOf({ snapshotRevision: "", products: [] })).toBeNull();
    expect(snapshotRevisionOf({ products: [] })).toBeNull();
    expect(snapshotRevisionOf(undefined)).toBeNull();
  });
});

describe("describing a product's state", () => {
  const products = {
    products: [
      entry("unused-code"),
      entry("hotspots", { status: "not-run", revision: null }),
      entry("doc-map", { status: "different-revision", revision: "git:old" }),
    ],
  };
  const states = { unused: stateOf(products, "unused-code"), hotspots: stateOf(products, "hotspots"), "doc-map": stateOf(products, "doc-map") };

  it("gives not run its status and the command", () => {
    expect(describeProductState(states.hotspots, null)).toEqual(["Status: not run", "Command: /excavator-hotspots"]);
    const withReason = stateOf({ products: [entry("hotspots", { status: "not-run", reason: "hotspots.json was not produced" })] }, "hotspots");
    expect(describeProductState(withReason, null)).toEqual(["Status: not run", "Reason: hotspots.json was not produced", "Command: /excavator-hotspots"]);
  });

  it("gives unreadable its reason", () => {
    const broken = stateOf({ products: [entry("unused-code", { status: "unreadable", reason: "bad format", revision: null })] }, "unused-code");
    expect(describeProductState(broken, null)).toEqual(["Status: unreadable", "Reason: bad format"]);
  });

  it("gives a different revision both revisions, and says when the packed one is not known", () => {
    expect(describeProductState(states["doc-map"], "git:new")).toEqual(["Status: different revision", "Made from revision: git:old", "Packed source revision: git:new"]);
    expect(describeProductState(states["doc-map"], null)[2]).toBe("Packed source revision: not recorded in this page");
  });

  it("gives an included product its revision or the note that it records none", () => {
    expect(describeProductState(states.unused, null)).toEqual(["Status: included", "Revision: git:aaa"]);
    const none = stateOf({ products: [entry("unused-code", { revision: null, revisionNote: "no revision recorded" })] }, "unused-code");
    expect(describeProductState(none, null)).toEqual(["Status: included", "Revision: no revision recorded"]);
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

  it("reads the file from a part that decodes", async () => {
    pageWith(gzipSync(Buffer.from(JSON.stringify({ snapshotRevision: "git:aaa", products: [entry("unused-code")] }), "utf-8")).toString("base64"));
    const { value, failure } = await readJson("products.json");
    expect(failure).toBeUndefined();
    expect(snapshotRevisionOf(value)).toBe("git:aaa");
    expect(stateOf(value, "unused-code")).toMatchObject({ status: "included" });
  });

  it("carries the reader's own error when the part cannot be decoded", async () => {
    pageWith(Buffer.from("not gzip", "utf-8").toString("base64"));
    const { value, failure } = await readJson("products.json");
    expect(value).toBeUndefined();
    expect(failure).toMatch(/^products\.json could not be read: /);
    expect(productStateFromJson(value, "hotspots", failure).reason).toBe(failure);
  });

  it("says the file is not in the page when the index does not list it", async () => {
    scope.document = { getElementById: (id: string) => (id === "xv-explorer-index" ? { textContent: JSON.stringify({ version: 1, files: {} }) } : null) };
    const { value, failure } = await readJson("products.json");
    expect(value).toBeUndefined();
    expect(failure).toBe("products.json is not included in this page");
  });
});
