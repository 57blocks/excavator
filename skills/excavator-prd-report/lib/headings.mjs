/**
 * The ATX headings of a Markdown text, outside code fences, shared by the
 * chapter check, the chapter split and the anchors (openspec change
 * prd-report-prd-shape, design D3, D4).
 */

/**
 * Walk the lines of `markdown` once with the fence rules both exports share:
 * a fence opens with three or more backticks or tildes and closes with at
 * least as many of the same character, as in CommonMark. Calls `onLine(line,
 * at)` for each line outside a fence (fence lines excluded) and returns
 * whether the text ends inside an open fence.
 */
function scan(markdown, onLine) {
  let fence = null;
  markdown.split('\n').forEach((line, at) => {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence !== null) {
      if (marker !== undefined && marker[0] === fence.char && marker.length >= fence.length && line.trim() === marker) fence = null;
      return;
    }
    if (marker !== undefined) {
      fence = { char: marker[0], length: marker.length };
      return;
    }
    onLine(line, at);
  });
  return fence !== null;
}

/** `{ level, text, line }` in order; `line` is the 0-based index of the heading's line. */
export function headingsOf(markdown) {
  const headings = [];
  scan(markdown, (line, at) => {
    const match = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(line);
    if (match) headings.push({ level: match[1].length, text: match[2], line: at });
  });
  return headings;
}

/**
 * Whether `markdown` ends inside an open code fence. The assembled PRD joins
 * parts with blank lines, so a part that ends in a fence would hide every
 * heading after it (design D4).
 */
export function endsInsideFence(markdown) {
  return scan(markdown, () => {});
}
