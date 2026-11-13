/** Heading shifting for the chapters of handbook.md: a chapter's own headings move below the second level (openspec change handbook-skill-first). Pure and deterministic. */

const HEADING = /^(#{1,6}) /;

/** The lines with every heading outside a fenced block moved by `by` levels (at most six deep, at least two). */
export function shiftHeadings(lines, by) {
  let fenced = false;
  return lines.map((line) => {
    if (line.startsWith('```')) fenced = !fenced;
    const match = fenced ? null : HEADING.exec(line);
    if (match === null) return line;
    return `${'#'.repeat(Math.min(6, Math.max(2, match[1].length + by)))} ${line.slice(match[0].length)}`;
  });
}
