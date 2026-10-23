/**
 * The "Open code" button of a row (openspec: changes/explorer-products, design D4):
 * the lines the code viewer marks, and whether the source of the row's file is in
 * the page. A file whose source was not packed (`--no-source`, or too large) gets
 * a sentence instead of the button.
 */

/** What the view says when the source of a row's file is not in the page. */
export const OPEN_CODE_UNAVAILABLE = "The source of this file is not in this page.";

export type LineRange = [number, number];

/** The lines to mark: `[a, b]`, `[a]` or a number; null when the row names none or they make no range. */
export function sourceRange(range: unknown): LineRange | null {
  let start: unknown;
  let end: unknown;
  if (Array.isArray(range)) {
    start = range[0];
    end = typeof range[1] === "number" ? range[1] : range[0];
  } else {
    start = range;
    end = range;
  }
  if (typeof start !== "number" || typeof end !== "number") return null;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) return null;
  return [start, end];
}

/** The range as text: "3" for one line, "3-7" for several. */
export function lineText(range: LineRange | null): string | null {
  if (range === null) return null;
  return range[0] === range[1] ? String(range[0]) : `${range[0]}-${range[1]}`;
}

export type CodeAction =
  | { state: "none" }
  | { state: "unavailable"; message: string }
  | { state: "available"; path: string; range: LineRange | null };

/** What the row can do with its file: nothing without a file, the button when the source is inlined, else the sentence. */
export function codeAction(path: string | null, range: unknown, hasSource: (path: string) => boolean): CodeAction {
  if (path === null) return { state: "none" };
  if (!hasSource(path)) return { state: "unavailable", message: OPEN_CODE_UNAVAILABLE };
  return { state: "available", path, range: sourceRange(range) };
}
