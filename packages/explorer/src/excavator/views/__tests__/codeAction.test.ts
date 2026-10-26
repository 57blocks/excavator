import { describe, expect, it } from "vitest";
import { codeAction, lineText, OPEN_CODE_UNAVAILABLE, sourceRange } from "../codeAction";

const has = (path: string) => path === "src/a.js";

describe("sourceRange: the lines the code viewer marks", () => {
  it("takes a line range, a single line, or nothing", () => {
    expect(sourceRange([3, 7])).toEqual([3, 7]);
    expect(sourceRange([4])).toEqual([4, 4]);
    expect(sourceRange(9)).toEqual([9, 9]);
    expect(sourceRange(null)).toBeNull();
    expect(sourceRange(undefined)).toBeNull();
    expect(sourceRange([])).toBeNull();
    expect(sourceRange("3-4")).toBeNull();
    expect(sourceRange([0, 2])).toBeNull();
    expect(sourceRange([5, 2])).toBeNull();
  });
});

describe("lineText: a range as text", () => {
  it("writes one line as a number and a range with a dash", () => {
    expect(lineText([3, 3])).toBe("3");
    expect(lineText([3, 7])).toBe("3-7");
    expect(lineText(null)).toBeNull();
  });
});

describe("codeAction: the Open code button of a row", () => {
  it("is available when the source is in the page, with the line when the row has one", () => {
    expect(codeAction("src/a.js", [3, 5], has)).toEqual({ state: "available", path: "src/a.js", range: [3, 5] });
    expect(codeAction("src/a.js", null, has)).toEqual({ state: "available", path: "src/a.js", range: null });
  });

  it("says the source is not in the page when the file is not among the inlined sources", () => {
    expect(codeAction("src/b.js", [1], has)).toEqual({ state: "unavailable", message: OPEN_CODE_UNAVAILABLE });
    expect(OPEN_CODE_UNAVAILABLE).toBe("The source of this file is not in this page.");
  });

  it("offers nothing for a row without a file", () => {
    expect(codeAction(null, null, has)).toEqual({ state: "none" });
  });
});
