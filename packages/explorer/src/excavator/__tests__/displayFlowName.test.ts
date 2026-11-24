import { describe, expect, it } from "vitest";
import { displayFlowName, flowTitle } from "../displayFlowName";

describe("displayFlowName", () => {
  it("strips a trailing parenthesised route that starts with an HTTP method", () => {
    expect(displayFlowName("ListInterviewPositions (GET /v2/management/interview-positions)")).toBe("ListInterviewPositions");
    expect(displayFlowName("Save (post /a)")).toBe("Save");
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "ANY"]) {
      expect(displayFlowName(`Do (${method} /x)`)).toBe("Do");
    }
  });

  it("accepts the full-width parentheses, with a translated name", () => {
    expect(displayFlowName("\u67e5\u8be2\u804c\u4f4d\uff08GET /v2/positions\uff09")).toBe("\u67e5\u8be2\u804c\u4f4d");
    expect(displayFlowName("\u67e5\u8be2\u804c\u4f4d \uff08POST /v2/positions\uff09")).toBe("\u67e5\u8be2\u804c\u4f4d");
  });

  it("strips a parenthesised bare path", () => {
    expect(displayFlowName("Open page (/manage/x)")).toBe("Open page");
  });

  it("leaves a name whose parentheses are not a route", () => {
    expect(displayFlowName("Export (CSV)")).toBe("Export (CSV)");
    expect(displayFlowName("Getting started (GETTING help)")).toBe("Getting started (GETTING help)");
    expect(displayFlowName("Run (middle) tail")).toBe("Run (middle) tail");
  });

  it("leaves a name that is only a route in parentheses", () => {
    expect(displayFlowName("(GET /x)")).toBe("(GET /x)");
    expect(displayFlowName("  (/x)")).toBe("  (/x)");
  });

  it("strips only the last parenthesised part, once", () => {
    expect(displayFlowName("A (CSV) (GET /x)")).toBe("A (CSV)");
    expect(displayFlowName("A (GET /x) (GET /y)")).toBe("A (GET /x)");
  });
});

describe("flowTitle", () => {
  const translate = (english: string) => (english === "List (GET /a)" ? "\u5217\u8868\uff08GET /a\uff09" : null);
  it("strips the translation and the English original beside it", () => {
    expect(flowTitle("List (GET /a)", translate)).toEqual({ label: "\u5217\u8868", original: "List" });
  });
  it("strips an untranslated name and has no original", () => {
    expect(flowTitle("Other (GET /b)", translate)).toEqual({ label: "Other", original: null });
  });
});
