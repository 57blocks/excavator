import { describe, expect, it } from "vitest";
import { loadProductFile, resetProductFileCache } from "../productFiles";

describe("loadProductFile", () => {
  it("reads a present key from the page data", async () => {
    resetProductFileCache();
    const value = { counts: { unused: 2 } };
    expect(await loadProductFile("unused-code.json", { "unused-code.json": value })).toEqual({ state: "ready", value });
  });

  it("says a key the page does not hold is missing, with the reason", async () => {
    resetProductFileCache();
    const result = await loadProductFile("hotspots.json", {});
    expect(result.state).toBe("missing");
    if (result.state === "missing") expect(result.reason).toMatch(/hotspots\.json is not included in this page/);
  });

  it("reads each file once per page", async () => {
    resetProductFileCache();
    const first = loadProductFile("doc-map.json", { "doc-map.json": { a: 1 } });
    const second = loadProductFile("doc-map.json", { "doc-map.json": { a: 2 } });
    expect(first).toBe(second);
  });
});
