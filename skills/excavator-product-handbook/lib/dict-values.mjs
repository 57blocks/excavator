/**
 * The values a member can have (openspec change handbook-status-dictionary,
 * design D2): string and integer literals as Go and as TypeScript write them,
 * and the few Go expressions with `iota` the extraction computes, by Go's
 * rules. Anything else is not computed and is kept as written. Nothing is run.
 */

import { matchingBracket } from './dict-text.mjs';

const SIMPLE_ESCAPES = { a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '\\': '\\', '"': '"', "'": "'", '`': '`', 0: '\0' };

/** The text of a string body with its escapes resolved; the character after an unknown backslash is kept. */
export function unescape(raw) {
  return raw.replace(/\\(?:x([0-9a-fA-F]{2})|u([0-9a-fA-F]{4})|U([0-9a-fA-F]{8})|([0-7]{3})|([\s\S]))/g, (_, x, u, bigU, octal, simple) => {
    if (x !== undefined) return String.fromCodePoint(parseInt(x, 16));
    if (u !== undefined) return String.fromCodePoint(parseInt(u, 16));
    if (bigU !== undefined) return String.fromCodePoint(parseInt(bigU, 16));
    if (octal !== undefined) return String.fromCodePoint(parseInt(octal, 8));
    return SIMPLE_ESCAPES[simple] ?? simple;
  });
}

const INTEGER = /^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|0[0-7_]*|[1-9][0-9_]*)$/;

/** A Go integer literal as a BigInt, or null. */
export function goInteger(token) {
  if (!INTEGER.test(token)) return null;
  const clean = token.replace(/_/g, '');
  try {
    return /^0[0-7]+$/.test(clean) ? BigInt(`0o${clean.slice(1)}`) : BigInt(clean);
  } catch {
    return null;
  }
}

/** A BigInt as a number when it is an exact one, else null. */
const safe = (big) => (big >= BigInt(Number.MIN_SAFE_INTEGER) && big <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(big) : null);

/** A string literal that is the whole of `text` (Go: "..." or a raw string), or null. */
export function goStringLiteral(text) {
  const t = text.trim();
  const interpreted = /^"((?:[^"\\\n]|\\.)*)"$/.exec(t);
  if (interpreted !== null) return unescape(interpreted[1]);
  const raw = /^`([^`]*)`$/.exec(t);
  return raw === null ? null : raw[1];
}

/** A number literal as TypeScript and JavaScript write it, with an optional sign, or null. */
export function jsNumber(text) {
  const match = /^([+-]?)\s*(0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?|\.\d+)$/.exec(text.trim());
  if (match === null) return null;
  const value = Number(match[2].replace(/_/g, ''));
  if (Number.isNaN(value)) return null;
  return match[1] === '-' ? -value : value;
}

/**
 * The value of a Go expression for the item at position `iota` of its group:
 * `{ computed: true, value }` for a string or an integer literal and for the
 * forms `iota`, `iota + k`, `iota - k`, `k + iota`, `iota * k`, `k * iota`,
 * `1 << iota` and `1 << (iota + k)` (k an integer literal); else
 * `{ computed: false }`.
 */
export function evalGoExpression(expression, iota) {
  let text = expression.trim();
  const string = goStringLiteral(text);
  if (string !== null) return { computed: true, value: string };
  while (text.startsWith('(') && matchingBracket(text, 0) === text.length - 1) text = text.slice(1, -1).trim();
  const t = text.replace(/\s+/g, '');
  const at = BigInt(iota);
  const k = (token) => goInteger(token);
  let result = null;
  let m;
  if (goInteger(t.replace(/^-/, '')) !== null) result = t.startsWith('-') ? -goInteger(t.slice(1)) : goInteger(t);
  else if (t === 'iota') result = at;
  else if ((m = /^iota([+-])(.+)$/.exec(t)) !== null && k(m[2]) !== null) result = m[1] === '+' ? at + k(m[2]) : at - k(m[2]);
  else if ((m = /^(.+)\+iota$/.exec(t)) !== null && k(m[1]) !== null) result = k(m[1]) + at;
  else if ((m = /^iota\*(.+)$/.exec(t)) !== null && k(m[1]) !== null) result = at * k(m[1]);
  else if ((m = /^(.+)\*iota$/.exec(t)) !== null && k(m[1]) !== null) result = k(m[1]) * at;
  else if (t === '1<<iota') result = 1n << at;
  else if ((m = /^1<<\(iota\+(.+)\)$/.exec(t)) !== null && k(m[1]) !== null) result = 1n << (at + k(m[1]));
  if (result === null) return { computed: false };
  const value = safe(result);
  return value === null ? { computed: false } : { computed: true, value };
}
