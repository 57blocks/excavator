/**
 * A light reader of Go and of JavaScript and TypeScript text for the status
 * dictionary (openspec change handbook-status-dictionary, design D2 and D3):
 * it finds the string literals and the comments, so a name inside either is
 * not taken for code, and it keeps the comments as ranges so their text can be
 * attached to a member. It is not a parser: a regular expression literal that
 * holds a quote can confuse it. Nothing is run or imported.
 */

import { lineIndex } from './data-js-tokens.mjs';

const blank = (text) => text.replace(/[^\n]/g, ' ');

/** The index of the `}` that closes a `${` whose body starts at `from`; the text length when there is none. */
function endOfInterpolation(text, from) {
  let depth = 1;
  for (let i = from; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return text.length;
}

/** The index of the closing quote of the string that opens at `i`, and whether it holds `${`. */
function endOfString(text, i, language) {
  const quote = text[i];
  const n = text.length;
  let k = i + 1;
  let interpolated = false;
  while (k < n) {
    const c = text[k];
    if (c === '\\' && !(language === 'go' && quote === '`')) {
      k += 2;
      continue;
    }
    if (c === quote) break;
    if (quote !== '`' && c === '\n') break;
    if (language === 'js' && quote === '`' && c === '$' && text[k + 1] === '{') {
      interpolated = true;
      k = endOfInterpolation(text, k + 2) + 1;
      continue;
    }
    k += 1;
  }
  return { end: Math.min(k, n), interpolated };
}

/**
 * The reading of one file: `{ text, language, code, strings, comments, lineAt }`.
 * `code` is the text with every comment replaced by spaces and every string
 * body replaced by spaces (newlines and quotes kept), so it has the same
 * length and the same line starts as `text`. `strings` maps the index of an
 * opening quote to `{ end, raw, interpolated }`. `comments` are
 * `{ start, end, kind }` with `kind` `line` or `block`, `end` exclusive.
 * `language` is `go` (a backtick string is raw) or `js`.
 */
export function readSource(text, language) {
  const strings = new Map();
  const comments = [];
  const parts = [];
  const n = text.length;
  let last = 0;
  let i = 0;
  while (i < n) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '/' && next === '/') {
      let end = text.indexOf('\n', i);
      if (end < 0) end = n;
      comments.push({ start: i, end, kind: 'line' });
      parts.push(text.slice(last, i), blank(text.slice(i, end)));
      last = end;
      i = end;
    } else if (ch === '/' && next === '*') {
      const close = text.indexOf('*/', i + 2);
      const end = close < 0 ? n : close + 2;
      comments.push({ start: i, end, kind: 'block' });
      parts.push(text.slice(last, i), blank(text.slice(i, end)));
      last = end;
      i = end;
    } else if (ch === "'" || ch === '"' || ch === '`') {
      const { end, interpolated } = endOfString(text, i, language);
      strings.set(i, { end, raw: text.slice(i + 1, end), interpolated });
      parts.push(text.slice(last, i + 1), blank(text.slice(i + 1, end)));
      last = end;
      i = end + 1;
    } else {
      i += 1;
    }
  }
  parts.push(text.slice(last));
  return { text, language, code: parts.join(''), strings, comments, lineAt: lineIndex(text) };
}

/** The index of the bracket that closes the one at `open` (any of `([{`), counted in `code`; -1 when there is none. */
export function matchingBracket(code, open) {
  const closeOf = { '(': ')', '[': ']', '{': '}' };
  const opener = code[open];
  const closer = closeOf[opener];
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === opener) depth += 1;
    else if (code[i] === closer) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** The ranges `[start, end)` of the parts of `code[from, to)` between top-level commas, brackets nested, each trimmed; empty parts dropped. */
export function splitTopLevel(code, from, to) {
  const parts = [];
  let depth = 0;
  let start = from;
  const push = (end) => {
    let s = start;
    let e = end;
    while (s < e && /\s/.test(code[s])) s += 1;
    while (e > s && /\s/.test(code[e - 1])) e -= 1;
    if (e > s) parts.push({ start: s, end: e });
  };
  for (let i = from; i < to; i += 1) {
    const ch = code[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === ',' && depth === 0) {
      push(i);
      start = i + 1;
    }
  }
  push(to);
  return parts;
}
