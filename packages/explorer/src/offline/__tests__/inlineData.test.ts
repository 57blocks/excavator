import { afterEach, describe, expect, it } from "vitest";
import {
  DATA_GLOBAL,
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

describe("the page's global", () => {
  const scope = globalThis as Record<string, unknown>;
  afterEach(() => {
    delete scope.window;
  });

  it("is read from window when no object is passed", async () => {
    scope.window = { [DATA_GLOBAL]: { "meta.json": { theme: "t" } } };
    expect(await (await readInlineFile("meta.json")).json()).toEqual({ theme: "t" });
    expect((await readInlineFile("config.json")).ok).toBe(false);
  });

  it("is missing when there is no window", async () => {
    expect((await readInlineFile("meta.json")).ok).toBe(false);
  });
});

describe("inlineFetch", () => {
  it("serves a file name like fetch does, for the freshness request", async () => {
    (globalThis as Record<string, unknown>).window = { [DATA_GLOBAL]: { "staleness.json": { graphs: { knowledge: 1 } } } };
    try {
      const res = await inlineFetch("staleness.json", { cache: "no-store" });
      expect(res.ok).toBe(true);
      expect(await res.json()).toEqual({ graphs: { knowledge: 1 } });
      expect((await inlineFetch("meta.json")).ok).toBe(false);
    } finally {
      delete (globalThis as Record<string, unknown>).window;
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
