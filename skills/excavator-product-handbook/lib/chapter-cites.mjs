/**
 * Citation groups of a chapter (openspec change handbook-free-chapter, D2 and D3).
 * A citation is a backticked `<path>:<n>` or `<path>:<a>-<b>` (a hyphen or an en
 * dash). A group is one or more citations separated by `;`, a full-width `;`,
 * `,` or spaces, optionally inside `(...)` or a full-width pair. Sentence-final
 * punctuation right after a group belongs to it, so a sentence that ends
 * `(`a.js:1`).` keeps its full stop.
 */

const SPAN = '`[^`\\n]*`';
const SEPARATORS = '[;\\uff1b,\\s]*';
const GROUP = new RegExp(`${SPAN}(?:${SEPARATORS}${SPAN})*`, 'g');
const OPENERS = ['(', '\uff08'];
const CLOSERS = [')', '\uff09'];
const TRAILING = /^[.\u3002!\uff01?\uff1f]*/;
const EN_DASH = '\u2013';

/** The groups of `text`: `{ start, end, specs }`, `end` after the group and its trailing sentence punctuation. */
export function citationGroups(text) {
  const groups = [];
  for (const match of text.matchAll(GROUP)) {
    let start = match.index;
    let end = match.index + match[0].length;
    const specs = Array.from(match[0].matchAll(/`([^`\n]*)`/g), (span) => span[1].trim());
    const before = text.slice(0, start).trimEnd();
    const after = text.slice(end).trimStart();
    if (OPENERS.includes(before.slice(-1)) && CLOSERS.includes(after.slice(0, 1))) {
      start = before.length - 1;
      end = text.length - after.length + 1;
    }
    end += TRAILING.exec(text.slice(end))[0].length;
    groups.push({ start, end, specs });
  }
  return groups;
}

/** `{ file, a, b }` of one citation, or `{ problem }` when its form is wrong. */
export function parseSpec(spec) {
  const match = /^(.+):(\d+)(?:[-\u2013](\d+))?$/.exec(spec);
  if (match === null) return { problem: `citation \`${spec}\` is not written as <path>:<n> or <path>:<a>-<b>` };
  const a = Number(match[2]);
  return { file: match[1], a, b: match[3] === undefined ? a : Number(match[3]) };
}

/** The spec with an en dash written as a hyphen: two specs of the same lines are one citation. */
export const specKey = (spec) => spec.replace(EN_DASH, '-');

export const MAX_CITED_LINES = 80;

const lineCount = (lines) => (lines[lines.length - 1] === '' && lines.length > 1 ? lines.length - 1 : lines.length);

/** `{ cite }` or `{ problem }` for one spec; `files` is the project reader (project-files.mjs). */
export function resolveSpec(spec, files) {
  const parsed = parseSpec(spec);
  if (parsed.problem !== undefined) return parsed;
  const { file, a, b } = parsed;
  const read = files.resolve(file);
  if (!read.ok) return { problem: `citation \`${spec}\`: ${file} ${read.reason}` };
  const lines = read.text.replace(/\r\n?/g, '\n').split('\n');
  const count = lineCount(lines);
  if (a < 1 || b < a || b > count) return { problem: `citation \`${spec}\`: lines ${a}-${b} are not inside ${file}, which has ${count} lines (1 <= a <= b <= ${count})` };
  if (b - a + 1 > MAX_CITED_LINES) return { problem: `citation \`${spec}\`: ${b - a + 1} lines; cite at most ${MAX_CITED_LINES}, a narrower range` };
  return { cite: { file, lines: [a, b], passage: lines.slice(a - 1, b).join('\n') } };
}
