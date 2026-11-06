/**
 * JavaScript value sets (openspec change handbook-status-dictionary, design
 * D2 and D3): an object literal assigned to `const|let|var X`,
 * `module.exports.X` or `exports.X`, where `X` ends in a state word. The
 * value set is the top-level members whose value is a string or a number
 * literal. A nested object whose keys are all values of the set and whose
 * values are all string literals is a reverse table: its entries are the
 * display names of the members that have those values; an entry whose key is
 * no member's value is returned in `unmatchedEntries`, and a nested object with
 * no key that is a member's value is not a reverse table. Every other top-level
 * member is counted in `skippedMembers`. In a TypeScript file (`asConst`) only
 * `const X = { ... } as const` is read, the same way. Nothing is run.
 */

import { commentFinder } from './dict-comments.mjs';
import { matchingBracket, splitTopLevel } from './dict-text.mjs';
import { jsNumber, unescape } from './dict-values.mjs';

/** The name of a set must end in one of these, in any case. */
export const JS_NAME_WORDS = Object.freeze(['status', 'state', 'type', 'kind', 'stage', 'phase', 'level', 'role', 'mode', 'category']);
const NAME_FILTER = new RegExp(`(?:${JS_NAME_WORDS.join('|')})$`, 'i');
const AS_CONST = /^\s*as\s+const\b/;
const ASSIGNMENT = /(?:\b(?:const|let|var)\s+|\bexports\.)([A-Za-z_$][\w$]*)\s*=\s*\{/dg;

/** `{ key, valueStart }` for an object member `key: value` at `[start, end)`; null for a spread, a method, a shorthand or a computed key. */
function keyOf(source, start, end) {
  const { code, strings } = source;
  let key = null;
  let after = start;
  if (code[start] === "'" || code[start] === '"') {
    const string = strings.get(start);
    if (string === undefined || string.interpolated) return null;
    key = unescape(string.raw);
    after = string.end + 1;
  } else {
    const word = /^(?:[A-Za-z_$][\w$]*|\d+(?:\.\d+)?)/.exec(code.slice(start, end));
    if (word === null) return null;
    key = /^\d/.test(word[0]) ? String(Number(word[0])) : word[0];
    after = start + word[0].length;
  }
  const colon = /^\s*:/.exec(code.slice(after, end));
  return colon === null ? null : { key, valueStart: after + colon[0].length };
}

/** The literal a value is: `{ value }` for a string or a number, else null. */
function literalValue(source, start, end) {
  const { text, code, strings } = source;
  let first = start;
  while (first < end && /\s/.test(code[first])) first += 1;
  if (code[first] === "'" || code[first] === '"' || code[first] === '`') {
    const string = strings.get(first);
    if (string !== undefined && !string.interpolated && /^\s*$/.test(code.slice(string.end + 1, end))) return { value: unescape(string.raw), at: first };
    return null;
  }
  const number = jsNumber(text.slice(first, end));
  return number === null ? null : { value: number, at: first };
}

/** The entries of a nested object as `{ key, text, line }`, or null when it is not a table of string literals. */
function stringTable(source, open, close) {
  const entries = [];
  for (const part of splitTopLevel(source.code, open + 1, close)) {
    const keyed = keyOf(source, part.start, part.end);
    const literal = keyed === null ? null : literalValue(source, keyed.valueStart, part.end);
    if (literal === null || typeof literal.value !== 'string') return null;
    entries.push({ key: keyed.key, text: literal.value, line: source.lineAt(literal.at) });
  }
  return entries.length === 0 ? null : entries;
}

/**
 * The candidate objects of a JavaScript file, or with `asConst` the `as const` objects of a TypeScript file:
 * `{ name, line, members, skippedMembers, tableEntries }`;
 * each reverse-table entry is already attached to its members and is also
 * returned in `tableEntries` as `{ key, text, line, member }` for the ledger.
 */
export function readJsObjects(source, { asConst = false } = {}) {
  const { code, lineAt } = source;
  const commentsFor = commentFinder(source);
  const found = [];
  ASSIGNMENT.lastIndex = 0;
  let match;
  while ((match = ASSIGNMENT.exec(code)) !== null) {
    const name = match[1];
    if (!NAME_FILTER.test(name)) continue;
    if (asConst && !match[0].startsWith('const')) continue;
    const open = match.index + match[0].length - 1;
    const close = matchingBracket(code, open);
    if (close < 0) continue;
    if (asConst && !AS_CONST.test(code.slice(close + 1, close + 40))) continue;
    const members = [];
    const nested = [];
    let skippedMembers = 0;
    for (const part of splitTopLevel(code, open + 1, close)) {
      const keyed = keyOf(source, part.start, part.end);
      if (keyed === null) {
        skippedMembers += 1;
        continue;
      }
      const literal = literalValue(source, keyed.valueStart, part.end);
      if (literal !== null) {
        members.push({ name: keyed.key, computed: true, value: literal.value, line: lineAt(part.start), comments: commentsFor(part.start, part.end) });
        continue;
      }
      let first = keyed.valueStart;
      while (first < part.end && /\s/.test(code[first])) first += 1;
      if (code[first] === '{' && matchingBracket(code, first) === part.end - 1) nested.push({ open: first, close: part.end - 1 });
      else skippedMembers += 1;
    }
    const values = new Set(members.map((member) => String(member.value)));
    const tableEntries = [];
    const unmatchedEntries = [];
    for (const table of nested) {
      const entries = stringTable(source, table.open, table.close);
      if (entries === null || !entries.some((entry) => values.has(entry.key))) {
        skippedMembers += 1;
        continue;
      }
      for (const entry of entries) {
        const named = members.filter((candidate) => String(candidate.value) === entry.key);
        if (named.length === 0) unmatchedEntries.push({ key: entry.key, line: entry.line });
        for (const member of named) tableEntries.push({ ...entry, member });
      }
    }
    found.push({ name, line: lineAt(match.indices[1][0]), members, skippedMembers, tableEntries, unmatchedEntries });
  }
  return found;
}
