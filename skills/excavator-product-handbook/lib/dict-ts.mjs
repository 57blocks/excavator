/**
 * TypeScript value sets (openspec change handbook-status-dictionary, design
 * D2): `enum E { ... }` and `const enum E { ... }`. A member with a value
 * written as a string or a number keeps it; a member with no value takes the
 * previous number plus one (the first takes 0), as TypeScript does. After a
 * string member, or after a value that is another expression, there is no
 * number to count up from, so the value is not computed and says so. Nothing
 * is run.
 */

import { commentFinder } from './dict-comments.mjs';
import { matchingBracket, splitTopLevel } from './dict-text.mjs';
import { jsNumber, unescape } from './dict-values.mjs';

const collapse = (text) => text.replace(/\s+/g, ' ').trim();
const ENUM = /(?:^|[^\w$.])enum\s+([A-Za-z_$][\w$]*)\s*\{/g;

/** The name of an enum member that starts at `start` in `code`: `{ name, end }`, or null when it is not an identifier or a string. */
function memberName(source, start, limit) {
  const { code, strings } = source;
  if (code[start] === "'" || code[start] === '"') {
    const string = strings.get(start);
    return string === undefined || string.interpolated ? null : { name: unescape(string.raw), end: string.end + 1 };
  }
  const ident = /^[A-Za-z_$][\w$]*/.exec(code.slice(start, limit));
  return ident === null ? null : { name: ident[0], end: start + ident[0].length };
}

/** The value written as an initializer, `{ computed, value }` or `{ computed: false, value, reason }`. */
function initializerValue(source, start, end) {
  const { text, code, strings } = source;
  const raw = text.slice(start, end).trim();
  const first = start + (text.slice(start, end).length - text.slice(start, end).trimStart().length);
  if (code[first] === "'" || code[first] === '"' || code[first] === '`') {
    const string = strings.get(first);
    if (string !== undefined && !string.interpolated && /^\s*$/.test(code.slice(string.end + 1, end))) return { computed: true, value: unescape(string.raw) };
  }
  const number = jsNumber(raw);
  if (number !== null) return { computed: true, value: number };
  return { computed: false, value: collapse(raw), reason: 'expression' };
}

/**
 * The enums of a TypeScript file: `{ name, line, members, skippedMembers }`.
 * A member part that is neither an identifier nor a string name, or has
 * something after the name that is not `= value`, is counted in `skippedMembers`.
 */
export function readTsEnums(source) {
  const { code, lineAt } = source;
  const commentsFor = commentFinder(source);
  const found = [];
  ENUM.lastIndex = 0;
  let match;
  while ((match = ENUM.exec(code)) !== null) {
    const open = match.index + match[0].length - 1;
    const close = matchingBracket(code, open);
    if (close < 0) continue;
    const members = [];
    let skippedMembers = 0;
    let previous = null;
    for (const part of splitTopLevel(code, open + 1, close)) {
      const named = memberName(source, part.start, part.end);
      const rest = named === null ? null : code.slice(named.end, part.end).trim();
      if (named === null || (rest !== '' && !rest.startsWith('='))) {
        skippedMembers += 1;
        previous = { computed: false };
        continue;
      }
      let value;
      if (rest !== '') value = initializerValue(source, code.indexOf('=', named.end) + 1, part.end);
      else if (previous === null) value = { computed: true, value: 0 };
      else if (previous.computed && typeof previous.value === 'number') value = { computed: true, value: previous.value + 1 };
      else value = { computed: false, value: null, reason: 'after-uncomputed' };
      previous = value;
      members.push({ name: named.name, ...value, line: lineAt(part.start), comments: commentsFor(part.start, part.end) });
    }
    found.push({ name: match[1], line: lineAt(match.index + match[0].indexOf('enum')), members, skippedMembers });
  }
  return found;
}
