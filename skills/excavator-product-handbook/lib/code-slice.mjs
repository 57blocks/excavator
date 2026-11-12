/**
 * The source a verifier is shown for an item (design D14): each cited passage
 * located in its file plus 20 lines before and after, every line prefixed with
 * its number, overlapping or adjacent ranges of one file merged into one block.
 */

import { locatePassage } from './locate.mjs';

/** Lines shown before and after a cited passage. */
export const CONTEXT_LINES = 20;

/** The lines of a file, without the empty last element a final newline leaves. */
function linesOf(text) {
  const lines = text.split('\n').map((line) => line.replace(/\r$/, ''));
  if (lines.length > 1 && lines.at(-1) === '') lines.pop();
  return lines;
}

/**
 * The blocks `{ file, lines: "a-b", code }` of an item's citations
 * (`{ file, passage }`), in order of first appearance of the file and then by
 * line. `files` is a projectFiles reader; a citation that does not resolve or
 * locate is a bug in the caller (check-entry passed it) and throws.
 */
export function codeBlocks(files, evidence) {
  const ranges = new Map();
  for (const { file, passage } of evidence) {
    const resolved = files.resolve(file);
    if (!resolved.ok) throw new Error(`${file} ${resolved.reason}`);
    const found = locatePassage(resolved.text, passage);
    if (found === null) throw new Error(`passage not in ${file} exactly once`);
    const total = linesOf(resolved.text).length;
    const list = ranges.get(file) ?? [];
    list.push([Math.max(1, found.startLine - CONTEXT_LINES), Math.min(total, found.endLine + CONTEXT_LINES)]);
    ranges.set(file, list);
  }
  const blocks = [];
  for (const [file, list] of ranges) {
    const lines = linesOf(files.resolve(file).text);
    const merged = [];
    for (const range of list.sort((a, b) => a[0] - b[0])) {
      const last = merged.at(-1);
      if (last !== undefined && range[0] <= last[1] + 1) last[1] = Math.max(last[1], range[1]);
      else merged.push([...range]);
    }
    for (const [from, to] of merged) {
      const code = lines.slice(from - 1, to).map((line, i) => `${from + i}: ${line}`).join('\n');
      blocks.push({ file, lines: `${from}-${to}`, code });
    }
  }
  return blocks;
}
