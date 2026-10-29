import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hasInlineFile,
  hasInlineSource,
  inlineFetch,
  readInlineFile,
  readInlineSource,
  type InlineDataFile,
} from "../inlineData";

// The six files the upstream dashboard fetched, by their original names.
const FILES: InlineDataFile[] = [
  "knowledge-graph.json",
  "domain-graph.json",
  "meta.json",
  "diff-overlay.json",
  "config.json",
  "staleness.json",
];

const SOURCE = { path: "src/a.ts", language: "typescript", content: "export {};\n", sizeBytes: 11, lineCount: 1 };

describe("readInlineFile", () => {
  for (const name of FILES) {
    it(`${name}: a present key answers like a successful request`, async () => {
      const value = { marker: name };
      const res = await readInlineFile(name, { [name]: value });
      expect(res.ok).toBe(true);
      expect(res.status).toBe(200);
      expect(await res.json()).toBe(value);
    });

    it(`${name}: a missing key answers like the failed request the original took`, async () => {
      const others = Object.fromEntries(FILES.filter((f) => f !== name).map((f) => [f, { f }]));
      const res = await readInlineFile(name, others);
      expect(res.ok).toBe(false);
      expect(res.status).toBe(404);
      // The graph loader reads `error` from a failed body to tell the user why.
      expect(await res.json()).toEqual({ error: `${name} is not included in this page` });
    });

    it(`${name}: a null value counts as missing`, async () => {
      const res = await readInlineFile(name, { [name]: null });
      expect(res.ok).toBe(false);
    });
  }

  it("no data object at all is every key missing", async () => {
    for (const name of FILES) {
      expect((await readInlineFile(name, undefined)).ok).toBe(false);
      expect(hasInlineFile(name, undefined)).toBe(false);
    }
  });

  it("a data value that is not an object is every key missing", async () => {
    expect((await readInlineFile("meta.json", "text")).ok).toBe(false);
    expect((await readInlineFile("meta.json", ["meta.json"])).ok).toBe(false);
  });

  it("does not take a key from the object's prototype", async () => {
    const res = await readInlineFile("meta.json", Object.create({ "meta.json": { theme: 1 } }));
    expect(res.ok).toBe(false);
  });
});

describe("hasInlineFile", () => {
  it("is true for a present key and false for a missing one", () => {
    expect(hasInlineFile("staleness.json", { "staleness.json": { graphs: {} } })).toBe(true);
    expect(hasInlineFile("staleness.json", { "meta.json": {} })).toBe(false);
  });
});

describe("readInlineSource", () => {
  it("answers a path of the inlined table with its file", async () => {
    const res = await readInlineSource("src/a.ts", { sources: { "src/a.ts": SOURCE } });
    expect(res.ok).toBe(true);
    expect(await res.json()).toBe(SOURCE);
  });

  it("no table is the failure branch of the original request", async () => {
    const res = await readInlineSource("src/a.ts", { "meta.json": {} });
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Source is not included in this page" });
  });

  it("a table without the path is the same failure", async () => {
    const res = await readInlineSource("src/b.ts", { sources: { "src/a.ts": SOURCE } });
    expect(res.ok).toBe(false);
    expect(await res.json()).toEqual({ error: "Source is not included in this page" });
  });

  it("a table that is not an object is no table", async () => {
    expect((await readInlineSource("src/a.ts", { sources: [SOURCE] })).ok).toBe(false);
    expect((await readInlineSource("src/a.ts", { sources: "x" })).ok).toBe(false);
  });

  it("does not take a path from the table's prototype", async () => {
    const res = await readInlineSource("toString", { sources: {} });
    expect(res.ok).toBe(false);
  });
});

describe("the page's document", () => {
  it("is every key missing when there is no document", async () => {
    expect((await readInlineFile("meta.json")).ok).toBe(false);
    expect(hasInlineFile("meta.json")).toBe(false);
    expect(hasInlineSource("src/a.ts")).toBe(false);
  });
});

describe("inlineFetch", () => {
  it("serves a file name like fetch does, for the freshness request", async () => {
    const scope = globalThis as Record<string, unknown>;
    scope.document = fakePage({ version: 1, files: { "staleness.json": { value: 0 } } }, [{ graphs: { knowledge: 1 } }]).doc;
    try {
      const res = await inlineFetch("staleness.json", { cache: "no-store" });
      expect(res.ok).toBe(true);
      expect(await res.json()).toEqual({ graphs: { knowledge: 1 } });
      expect((await inlineFetch("meta.json")).ok).toBe(false);
    } finally {
      delete scope.document;
    }
  });
});

describe("hasInlineSource", () => {
  it("is true only for a path the sources table holds", () => {
    const data = { sources: { "src/a.ts": SOURCE } };
    expect(hasInlineSource("src/a.ts", data)).toBe(true);
    expect(hasInlineSource("src/b.ts", data)).toBe(false);
    expect(hasInlineSource("toString", data)).toBe(false);
  });

  it("is false when the page has no sources key (packed without source)", () => {
    expect(hasInlineSource("src/a.ts", {})).toBe(false);
    expect(hasInlineSource("src/a.ts", undefined)).toBe(false);
  });
});

// ---- a page of gzip parts ------------------------------------------------------------------

interface FakePage {
  doc: { getElementById(id: string): { textContent: string | null } | null };
  index: unknown;
}

/** A document that answers `getElementById` for an index block and `xv-part-<n>` blocks, as the packed page does. */
function fakePage(index: unknown, parts: unknown[]): FakePage {
  const elements = new Map<string, { textContent: string | null }>();
  elements.set("xv-explorer-index", { textContent: JSON.stringify(index) });
  parts.forEach((part, n) => {
    elements.set(`xv-part-${n}`, { textContent: gzipSync(Buffer.from(JSON.stringify(part), "utf-8")).toString("base64") });
  });
  return { doc: { getElementById: (id) => elements.get(id) ?? null }, index };
}

const NODES = [{ id: "n1" }, { id: "n2" }, { id: "n3" }];
const SRC_B = { path: "src/b.ts", language: "typescript", content: "export {};\n", sizeBytes: 11, lineCount: 1 };

/** Parts: 0 header of the graph, 1-2 its nodes, 3 its empty edges is no part, 4 meta, 5 sources (a, b), 6 sources (c). */
function sample(): FakePage {
  return fakePage(
    {
      version: 1,
      files: {
        "knowledge-graph.json": {
          fields: [
            { key: "version", part: 0 },
            { key: "nodes", parts: [1, 2] },
            { key: "edges", parts: [] },
            { key: "layers", part: 0 },
          ],
        },
        "meta.json": { value: 4 },
        sources: { paths: { "src/a.ts": 5, "src/b.ts": 5, "src/c.ts": 6 } },
      },
    },
    [
      { version: "1.0.0", layers: [{ id: "l" }] },
      [NODES[0], NODES[1]],
      [NODES[2]],
      null,
      { theme: "t" },
      { "src/a.ts": { ...SRC_B, path: "src/a.ts" }, "src/b.ts": SRC_B },
      { "src/c.ts": { ...SRC_B, path: "src/c.ts" } },
    ],
  );
}

describe("a page of compressed parts", () => {
  const scope = globalThis as Record<string, unknown>;
  afterEach(() => {
    delete scope.document;
    vi.restoreAllMocks();
  });
  const open = (page: FakePage) => {
    scope.document = page.doc;
  };

  it("rebuilds a data file from its header and array parts, the fields in their packed order", async () => {
    open(sample());
    const res = await readInlineFile("knowledge-graph.json");
    expect(res.ok).toBe(true);
    const graph = (await res.json()) as Record<string, unknown>;
    expect(graph).toEqual({ version: "1.0.0", nodes: NODES, edges: [], layers: [{ id: "l" }] });
    expect(Object.keys(graph)).toEqual(["version", "nodes", "edges", "layers"]);
  });

  it("reads a file that is one value", async () => {
    open(sample());
    expect(await (await readInlineFile("meta.json")).json()).toEqual({ theme: "t" });
  });

  it("reads a source from its part", async () => {
    open(sample());
    const res = await readInlineSource("src/b.ts");
    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual(SRC_B);
    expect(await (await readInlineSource("src/c.ts")).json()).toMatchObject({ path: "src/c.ts" });
  });

  it("answers a file or a source the index does not list like the failed request, and never decodes for it", async () => {
    open(sample());
    const atob = vi.spyOn(globalThis, "atob");
    const file = await readInlineFile("config.json");
    expect(file.ok).toBe(false);
    expect(file.status).toBe(404);
    expect(await file.json()).toEqual({ error: "config.json is not included in this page" });
    expect((await readInlineSource("src/none.ts")).status).toBe(404);
    expect((await readInlineSource("toString")).ok).toBe(false);
    expect(atob).not.toHaveBeenCalled();
  });

  it("decodes the parts of a data file once, however often it is read", async () => {
    open(sample());
    const atob = vi.spyOn(globalThis, "atob");
    const [first, second] = await Promise.all([readInlineFile("knowledge-graph.json"), readInlineFile("knowledge-graph.json")]);
    await readInlineFile("knowledge-graph.json");
    expect(await first.json()).toBe(await second.json());
    // header, two node parts: three decodes, and no others.
    expect(atob).toHaveBeenCalledTimes(3);
  });

  it("decodes a source part once for all the files in it, and nothing else", async () => {
    open(sample());
    const atob = vi.spyOn(globalThis, "atob");
    await readInlineSource("src/a.ts");
    await readInlineSource("src/b.ts");
    await readInlineSource("src/a.ts");
    expect(atob).toHaveBeenCalledTimes(1);
    await readInlineSource("src/c.ts");
    expect(atob).toHaveBeenCalledTimes(2);
  });

  it("answers hasInlineFile and hasInlineSource from the index without decoding any part", () => {
    open(sample());
    const atob = vi.spyOn(globalThis, "atob");
    expect(hasInlineFile("knowledge-graph.json")).toBe(true);
    expect(hasInlineFile("meta.json")).toBe(true);
    expect(hasInlineFile("config.json")).toBe(false);
    expect(hasInlineSource("src/a.ts")).toBe(true);
    expect(hasInlineSource("src/none.ts")).toBe(false);
    expect(hasInlineSource("toString")).toBe(false);
    expect(atob).not.toHaveBeenCalled();
  });

  it("has no source when the page was packed without the table", () => {
    open(fakePage({ version: 1, files: { "meta.json": { value: 0 } } }, [{ theme: "t" }]));
    expect(hasInlineSource("src/a.ts")).toBe(false);
  });

  it("keeps a field named __proto__ as an own field", async () => {
    const index = { version: 1, files: { "meta.json": { fields: [{ key: "__proto__", part: 0 }, { key: "rows", parts: [1] }] } } };
    open(fakePage(index, [JSON.parse('{"__proto__": {"x": 1}}'), [1, 2]]));
    const meta = (await (await readInlineFile("meta.json")).json()) as object;
    expect(Object.keys(meta)).toEqual(["__proto__", "rows"]);
    expect(Object.getOwnPropertyDescriptor(meta, "__proto__")?.value).toEqual({ x: 1 });
  });

  it("answers a part that cannot be read with a failed request that says why, and does not throw", async () => {
    const page = sample();
    open({ ...page, doc: { getElementById: (id) => (id === "xv-part-2" ? null : page.doc.getElementById(id)) } });
    const res = await readInlineFile("knowledge-graph.json");
    expect(res.ok).toBe(false);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "knowledge-graph.json could not be read: part 2 is not in this page" });
    expect(await (await readInlineFile("meta.json")).json()).toEqual({ theme: "t" });
  });

  it("answers a part that is not gzip with a failed request", async () => {
    const page = sample();
    open({ ...page, doc: { getElementById: (id) => (id === "xv-part-4" ? { textContent: Buffer.from("not gzip").toString("base64") } : page.doc.getElementById(id)) } });
    const res = await readInlineFile("meta.json");
    expect(res.ok).toBe(false);
    expect(res.status).toBe(500);
  });

  it("is every key missing when the document has no index", async () => {
    open({ doc: { getElementById: () => null }, index: null });
    expect(hasInlineFile("meta.json")).toBe(false);
    expect((await readInlineFile("meta.json")).status).toBe(404);
  });

  it("prefers an object passed in over the page", async () => {
    open(sample());
    expect(await (await readInlineFile("meta.json", { "meta.json": { theme: "other" } })).json()).toEqual({ theme: "other" });
  });
});
