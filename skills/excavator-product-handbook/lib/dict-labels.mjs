/**
 * Display names (openspec change handbook-status-dictionary, design D3 and
 * D4). A display name is a string literal a mapping table gives a member:
 * Go: an entry of a `map[K]string{ ... }` literal whose key is `C`, `pkg.C`,
 * `C.Method()` or `pkg.C.Method()`; TypeScript: an object entry whose key is
 * `[E.M]` or `[E['M']]`. (The reverse tables of JavaScript objects are read
 * with the object, dict-js.mjs.) An entry is read in two steps: here from the
 * text, then resolved against the value sets of the same application, and it
 * lands in the `label` bucket (a member has it), `unmatchedKey` (no member
 * has that name) or `ambiguousKey` (more than one member has it). Nothing is
 * guessed: an entry that does not resolve to exactly one member gives no name.
 */

import { matchingBracket, splitTopLevel } from './dict-text.mjs';
import { goStringLiteral, unescape } from './dict-values.mjs';

const GO_KEY = /^([A-Za-z_]\w*)(?:\.([A-Za-z_]\w*))?$/;
const byteOrder = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** The index of the first `:` outside brackets in `code[from, to)`, or -1. */
function topLevelColon(code, from, to) {
  let depth = 0;
  for (let i = from; i < to; i += 1) {
    const ch = code[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === ':' && depth === 0) return i;
  }
  return -1;
}

/** `{ qualifier, name }` for a key written as a member reference, else null; a trailing `.Method()` is dropped. */
export function goKeyReference(key) {
  const compact = key.replace(/\s+/g, '');
  const withoutCall = compact.replace(/\.[A-Za-z_]\w*\(\)$/, '');
  if (withoutCall === compact && compact.endsWith(')')) return null;
  const m = GO_KEY.exec(withoutCall);
  return m === null ? null : m[2] === undefined ? { qualifier: null, name: m[1] } : { qualifier: m[1], name: m[2] };
}

/** The entries of the `map[K]string{ ... }` literals of a Go file: `{ line, key, qualifier, name, text }`, the line being the one of the string. */
export function readGoMapEntries(source) {
  const { code, text, strings, lineAt } = source;
  const entries = [];
  for (const start of code.matchAll(/\bmap\s*\[/g)) {
    const bracket = start.index + start[0].length - 1;
    const close = matchingBracket(code, bracket);
    if (close < 0) continue;
    const head = /^\s*string\s*\{/.exec(code.slice(close + 1, close + 40));
    if (head === null) continue;
    const open = close + head[0].length;
    const end = matchingBracket(code, open);
    if (end < 0) continue;
    for (const part of splitTopLevel(code, open + 1, end)) {
      const colon = topLevelColon(code, part.start, part.end);
      if (colon < 0) continue;
      let valueStart = colon + 1;
      while (valueStart < part.end && /\s/.test(code[valueStart])) valueStart += 1;
      const string = code[valueStart] === '"' || code[valueStart] === '`' ? strings.get(valueStart) : undefined;
      if (string === undefined || string.end !== part.end - 1) continue;
      const key = code.slice(part.start, colon).trim();
      const reference = goKeyReference(key);
      const literal = goStringLiteral(text.slice(valueStart, part.end));
      if (reference === null || literal === null) continue;
      entries.push({ line: lineAt(valueStart), key: key.replace(/\s+/g, ''), ...reference, text: literal });
    }
  }
  return entries;
}

const TS_KEY = /\[\s*([A-Za-z_$][\w$]*)\s*(?:\.\s*([A-Za-z_$][\w$]*)|\[\s*(['"])([^'"\\\n]*)\3\s*\])\s*\]\s*:\s*/g;

/** The entries of a TypeScript file keyed `[E.M]` or `[E['M']]` with a string literal value: `{ line, key, enumName, name, text }`. */
export function readTsLabelEntries(source) {
  const { code, text, strings, lineAt } = source;
  const entries = [];
  TS_KEY.lastIndex = 0;
  let match;
  while ((match = TS_KEY.exec(text)) !== null) {
    if (code[match.index] !== '[') continue;
    const before = code.slice(0, match.index).trimEnd().slice(-1);
    if (before !== '{' && before !== ',') continue;
    const valueStart = match.index + match[0].length;
    const string = code[valueStart] === "'" || code[valueStart] === '"' || code[valueStart] === '`' ? strings.get(valueStart) : undefined;
    if (string === undefined || string.interpolated || !/^\s*[,}]/.test(code.slice(string.end + 1, string.end + 200))) continue;
    const key = match[0].replace(/\]\s*:\s*$/, '').slice(1).replace(/\s+/g, '');
    entries.push({ line: lineAt(valueStart), key, enumName: match[1], name: match[2] ?? match[4], text: unescape(string.raw) });
  }
  return entries;
}

/** The place and text of a name on a member. */
const labelOf = (entry, file) => ({ text: entry.text, file, line: entry.line });

/**
 * Resolve the entries against the value sets: attach each display name to the
 * member it names and return the ledger rows. `goEntries` and `tsEntries`
 * carry `file`, `application` and (Go) `directory`; `goMembers` are
 * `{ application, directory, pkg, member, dictionary }`; `dictionaries` are
 * the ones TypeScript entries are matched against.
 */
export function resolveLabels({ goEntries, tsEntries, goMembers, dictionaries }) {
  const rows = [];
  const attach = (entry, targets) => {
    const base = { kind: 'map-entry', file: entry.file, line: entry.line, key: entry.key };
    if (targets.length === 0) rows.push({ ...base, bucket: 'unmatchedKey' });
    else if (targets.length > 1) rows.push({ ...base, bucket: 'ambiguousKey' });
    else {
      const { dictionary, member } = targets[0];
      member.labels.push(labelOf(entry, entry.file));
      rows.push({ ...base, bucket: 'label', dictionary, member: member.name });
    }
  };
  const goByName = new Map();
  for (const item of goMembers) goByName.set(item.member.name, [...(goByName.get(item.member.name) ?? []), item]);
  for (const entry of goEntries) {
    const same = (goByName.get(entry.name) ?? []).filter((item) => item.application === entry.application && (entry.qualifier === null ? item.directory === entry.directory : item.pkg === entry.qualifier));
    attach(entry, same);
  }
  const enums = dictionaries.filter((dictionary) => dictionary.form === 'ts-enum');
  for (const entry of tsEntries) {
    let targets = enums
      .filter((dictionary) => dictionary.application === entry.application && dictionary.name === entry.enumName)
      .flatMap((dictionary) => dictionary.members.filter((member) => member.name === entry.name).map((member) => ({ dictionary, member })));
    if (targets.length > 1) {
      const inFile = targets.filter((target) => target.dictionary.file === entry.file);
      if (inFile.length === 1) targets = inFile;
    }
    attach(entry, targets);
  }
  for (const dictionary of dictionaries) for (const member of dictionary.members) member.labels.sort((a, b) => byteOrder(a.file, b.file) || a.line - b.line);
  return rows;
}
