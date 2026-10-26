/**
 * The ATX headings of a Markdown text, outside code fences, shared by the
 * chapter check, the chapter split and the anchors (openspec change
 * prd-report-prd-shape, design D3, D4).
 */

/**
 * `{ level, text, line }` in order; `line` is the 0-based index of the
 * heading's line. A fence opens with three or more backticks or tildes and
 * closes with at least as many of the same character, as in CommonMark.
 */
export function headingsOf(markdown) {
  const headings = [];
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
    const match = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/.exec(line);
    if (match) headings.push({ level: match[1].length, text: match[2], line: at });
  });
  return headings;
}
