import { describe, expect, it } from "vitest";
import { translatedList, translatedText } from "../nameTranslations";

const table: Record<string, string> = { "Runs the program.": "\u8fd0\u884c\u7a0b\u5e8f\u3002", billing: "\u8ba1\u8d39" };
const translate = (english: string) => (Object.prototype.hasOwnProperty.call(table, english) ? table[english] : null);

describe("translatedText", () => {
  it("is the translation of the trimmed text", () => {
    expect(translatedText("Runs the program.", translate)).toBe("\u8fd0\u884c\u7a0b\u5e8f\u3002");
  });
  it("looks a key up with its surrounding spaces and newlines removed", () => {
    expect(translatedText("  Runs the program.\n", translate)).toBe("\u8fd0\u884c\u7a0b\u5e8f\u3002");
  });
  it("falls back to the trimmed English when the table has no entry", () => {
    expect(translatedText("  Unknown text  ", translate)).toBe("Unknown text");
  });
  it("is the trimmed English without a translate function", () => {
    expect(translatedText(" Runs the program. ")).toBe("Runs the program.");
  });
  it("is empty for an empty, blank or missing text", () => {
    expect(translatedText("", translate)).toBe("");
    expect(translatedText("   ", translate)).toBe("");
    expect(translatedText(undefined, translate)).toBe("");
    expect(translatedText(null, translate)).toBe("");
  });
});

describe("translatedList", () => {
  it("translates each element on its own, keeps the order and drops empty elements", () => {
    expect(translatedList([" billing ", "other", "", "  "], translate)).toEqual(["\u8ba1\u8d39", "other"]);
  });
  it("is empty for a missing list", () => {
    expect(translatedList(undefined, translate)).toEqual([]);
  });
});
