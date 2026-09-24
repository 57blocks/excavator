/**
 * product-serialization.mjs
 *
 * Serialization-ceiling helper (openspec: changes/product-serialization-
 * ceiling, capability `product-serialization`, design D5). Every whole-
 * document JSON product Lazy builds in-process (`knowledge-graph.json`,
 * `meta.json`, `source-manifest.json`, Lazy's own intermediate products, and
 * the joined text `build-fact-graph.mjs` measures for its facts digest) is
 * meant to go through `serializeJsonProduct` instead of a bare
 * `JSON.stringify`, so the runtime's own single-string ceiling
 * (`buffer.constants.MAX_STRING_LENGTH`) is visible before it is hit, and —
 * when it IS hit — the run fails with a named error naming the product, the
 * characters required and the limit, instead of an anonymous
 * `RangeError: Invalid string length` mid-publish (see proposal.md's Hadoop
 * incident: `knowledge-graph.json`/`fingerprints.json` had already been
 * written to their final location when `source-index.json` blew past the
 * limit and crashed with no product name attached).
 *
 * Success path has no extra cost (design D5's own framing: the success path
 * pays nothing extra): `JSON.stringify` runs exactly once, and its own
 * `.length` is the recorded
 * character count. Only a failure path pays for `computeSerializedLength`'s
 * recursive, string-free length accounting — either because `JSON.stringify`
 * itself threw a `RangeError` (the result would exceed V8's own limit), or
 * because the result exceeded a caller-supplied smaller `limit` (tests inject
 * one to make the failure reproducible without gigabytes of fixture data).
 *
 * `computeSerializedLength` mirrors `JSON.stringify`'s own algorithm
 * (ECMA-262 `SerializeJSONProperty` / `QuoteJSONString`) closely enough to
 * match its `.length` exactly for every shape this project's products
 * contain: string quoting/escaping (control characters, and surrogate
 * pairs/lone surrogates per the ES2019 well-formed-JSON.stringify fix),
 * `toJSON`, `undefined`/function/symbol omission from objects and
 * null-substitution inside arrays, non-finite numbers serialized as `null`,
 * and indentation at any non-negative integer width (Lazy only ever uses 0
 * or 2, but the accounting is not special-cased to just those two). It
 * deliberately does NOT attempt to replicate a `replacer` function or a
 * string `space` argument — this project never passes either. A value
 * `JSON.stringify` itself refuses to serialize at all for a reason that has
 * nothing to do with size (a BigInt, or a root value that itself serializes
 * to `undefined`) is reported as a plain `TypeError`, not a
 * `ProductTooLargeError`.
 *
 * Contract: openspec/changes/product-serialization-ceiling/specs/
 *           product-serialization/spec.md
 */

import { constants as bufferConstants } from 'node:buffer';

/** The runtime's own single-string ceiling — read live, never hardcoded (the
 *  spec requires this ceiling to come from the runtime itself, never a
 *  literal constant). On Node 22.16 this is 536,870,888. */
export const DEFAULT_LIMIT_CHARS = bufferConstants.MAX_STRING_LENGTH;

export class ProductTooLargeError extends Error {
  /** @param {{ product: string, requiredChars: number, limitChars: number }} args */
  constructor({ product, requiredChars, limitChars }) {
    super(
      `product "${product}" requires ${requiredChars} characters to serialize, ` +
      `which exceeds the runtime single-string limit of ${limitChars} characters`,
    );
    this.name = 'ProductTooLargeError';
    this.product = product;
    this.requiredChars = requiredChars;
    this.limitChars = limitChars;
  }
}

// ---------------------------------------------------------------------------
// computeSerializedLength — a recursive character-count accounting that
// never builds the candidate string, mirroring JSON.stringify's algorithm.
// Exported so its correctness is directly unit-testable against real
// `JSON.stringify(v)` / `JSON.stringify(v, null, 2)` output on tricky inputs.
// ---------------------------------------------------------------------------

/** Applies a value's own `toJSON(key)` exactly once, like `JSON.stringify`
 *  does — the RESULT of a `toJSON` call is serialized as-is, its own
 *  (possible) `toJSON` is not chained a second time. Verified against real
 *  `JSON.stringify` behavior for a double-`toJSON` fixture (see the test
 *  file) before relying on it here. */
function resolveToJSON(value, key) {
  if (value !== null && typeof value === 'object' && typeof value.toJSON === 'function') {
    return value.toJSON(key);
  }
  return value;
}

/** `true` for exactly the values JSON.stringify omits from an object
 *  property (and substitutes with `null` inside an array). */
function isOmitted(value) {
  return value === undefined || typeof value === 'function' || typeof value === 'symbol';
}

/** Length of `JSON.stringify`'s quoted-and-escaped form of a string,
 *  counting UTF-16 code units the same way `.length` does — never building
 *  the escaped string itself. Mirrors ECMA-262's `QuoteJSONString`:
 *  `"` and `\` each become a 2-char escape; the five named control escapes
 *  (`\b \t \n \f \r`) are 2 chars; any other C0 control character becomes a
 *  6-char `\u00XX`; a lone (unpaired) surrogate becomes a 6-char `\uDXXX`
 *  (the ES2019 well-formed-string fix — verified empirically against Node's
 *  real `JSON.stringify` before being relied on here); a valid surrogate
 *  pair passes through unescaped, contributing 1 per code unit like any
 *  other character. */
function quotedStringLength(str) {
  let length = 2; // surrounding quotes
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code === 0x22 || code === 0x5c) { length += 2; continue; } // " or \
    if (code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d) {
      length += 2; continue; // \b \t \n \f \r
    }
    if (code < 0x20) { length += 6; continue; } // \u00XX
    if (code >= 0xd800 && code <= 0xdbff) { // high surrogate
      const next = i + 1 < str.length ? str.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) { length += 2; i += 1; continue; } // valid pair
      length += 6; continue; // lone high surrogate -> \uDXXX
    }
    if (code >= 0xdc00 && code <= 0xdfff) { length += 6; continue; } // lone low surrogate
    length += 1;
  }
  return length;
}

/** Length of a scalar (already `toJSON`-resolved, already known not to be
 *  `null`/omitted/object) value's JSON form. */
function scalarLength(value) {
  const t = typeof value;
  if (t === 'boolean') return value ? 4 : 5; // true / false
  if (t === 'number') return Number.isFinite(value) ? String(value).length : 4; // NaN/Infinity -> null
  if (t === 'string') return quotedStringLength(value);
  if (t === 'bigint') throw new TypeError('computeSerializedLength: cannot serialize a BigInt');
  throw new TypeError(`computeSerializedLength: unexpected value type "${t}"`);
}

/** Length of one already-`toJSON`-resolved value's JSON form at nesting
 *  `depth` (1 = the outermost object/array's own entries). */
function valueLength(value, indent, depth) {
  if (value === null) return 4;
  if (typeof value !== 'object') return scalarLength(value);
  return Array.isArray(value) ? arrayLength(value, indent, depth) : objectLength(value, indent, depth);
}

function objectLength(obj, indent, depth) {
  const parts = [];
  for (const key of Object.keys(obj)) {
    const resolved = resolveToJSON(obj[key], key);
    if (isOmitted(resolved)) continue; // whole key:value pair is dropped
    parts.push({ key, resolved });
  }
  if (parts.length === 0) return 2; // "{}" — collapses even when indented

  let total = indent > 0 ? 2 : 1; // "{" plus, when indented, the newline after it
  parts.forEach(({ key, resolved }, i) => {
    if (indent > 0) total += indent * depth;
    total += quotedStringLength(key);
    total += 1; // ":"
    if (indent > 0) total += 1; // space after colon
    total += valueLength(resolved, indent, depth + 1);
    if (i < parts.length - 1) total += 1; // ","
    if (indent > 0) total += 1; // newline after this entry
  });
  if (indent > 0) total += indent * (depth - 1); // closing brace's own indentation
  total += 1; // "}"
  return total;
}

function arrayLength(arr, indent, depth) {
  const n = arr.length;
  if (n === 0) return 2; // "[]" — collapses even when indented

  let total = indent > 0 ? 2 : 1; // "[" plus, when indented, the newline after it
  for (let i = 0; i < n; i++) {
    const resolved = resolveToJSON(arr[i], String(i));
    const elementLength = isOmitted(resolved) ? 4 /* null */ : valueLength(resolved, indent, depth + 1);
    if (indent > 0) total += indent * depth;
    total += elementLength;
    if (i < n - 1) total += 1; // ","
    if (indent > 0) total += 1; // newline after this element
  }
  if (indent > 0) total += indent * (depth - 1); // closing bracket's own indentation
  total += 1; // "]"
  return total;
}

/**
 * The exact character length `JSON.stringify(value, null, indent)` would
 * produce, computed without ever allocating that string. Throws a
 * `TypeError` for anything `JSON.stringify` itself cannot serialize for a
 * reason unrelated to size (a BigInt anywhere in the structure, or a root
 * value that itself serializes to `undefined`).
 *
 * @param {*} value
 * @param {number} [indent] number of spaces per indent level (0 = compact)
 * @returns {number}
 */
export function computeSerializedLength(value, indent = 0) {
  const resolved = resolveToJSON(value, '');
  if (isOmitted(resolved)) {
    throw new TypeError(
      'computeSerializedLength: the root value serializes to undefined (JSON.stringify would ' +
      'return undefined, not a string, for this input)',
    );
  }
  if (resolved === null) return 4;
  return typeof resolved !== 'object' ? scalarLength(resolved) : valueLength(resolved, indent, 1);
}

// ---------------------------------------------------------------------------
// serializeJsonProduct — the call site every whole-document JSON write in
// this project goes through.
// ---------------------------------------------------------------------------

/**
 * Serialize one whole-document JSON product, enforcing the runtime's
 * single-string ceiling up front instead of letting it surface as an
 * anonymous `RangeError` mid-publish.
 *
 * @param {string} name product name, used verbatim in the thrown error and
 *   in any headroom entry recorded (e.g. `"knowledge-graph.json"`).
 * @param {*} value the value to serialize.
 * @param {{ indent?: number, limit?: number, recorder?: ReturnType<typeof createHeadroomRecorder> }} [options]
 *   `limit` defaults to `DEFAULT_LIMIT_CHARS`; tests inject a smaller one to
 *   exercise the failure path deterministically. `recorder`, when given, has
 *   `chars` recorded on success via its `recordChars` method.
 * @returns {string}
 * @throws {ProductTooLargeError} when the serialized length exceeds `limit`
 *   (whether or not `JSON.stringify` itself was able to build the string).
 */
export function serializeJsonProduct(name, value, { indent = 0, limit = DEFAULT_LIMIT_CHARS, recorder = null } = {}) {
  let result;
  try {
    result = JSON.stringify(value, null, indent);
  } catch (error) {
    // Only V8's own "the result would exceed the single-string ceiling"
    // RangeError is ours to reinterpret. A RangeError can also mean
    // something unrelated to size (most notably "Maximum call stack size
    // exceeded" from a deeply/circularly nested structure recursing through
    // JSON.stringify's own serializer) — that must propagate unchanged, not
    // be reported as a ProductTooLargeError with a fabricated requiredChars.
    if (!(error instanceof RangeError) || !/Invalid string length/.test(error.message)) throw error;
    const requiredChars = computeSerializedLength(value, indent);
    throw new ProductTooLargeError({ product: name, requiredChars, limitChars: limit });
  }
  if (result.length > limit) {
    throw new ProductTooLargeError({ product: name, requiredChars: result.length, limitChars: limit });
  }
  recorder?.recordChars(name, result.length, limit);
  return result;
}

// ---------------------------------------------------------------------------
// Headroom recorder — collects {product, chars|bytes, limitChars,
// percentOfLimit, measuredAs} entries across a run's several products
// (including sub-process products whose byte size is measured via
// fs.statSync rather than serialized in-process) and reports them sorted by
// how close each one is to the ceiling.
// ---------------------------------------------------------------------------

/**
 * @returns {{
 *   recordChars: (product: string, chars: number, limitChars: number) => void,
 *   recordBytes: (product: string, bytes: number, limitChars: number) => void,
 *   entries: () => Array<{ product: string, chars?: number, bytes?: number, limitChars: number, percentOfLimit: number, measuredAs: 'chars'|'bytes' }>,
 * }}
 */
export function createHeadroomRecorder() {
  const entries = [];
  return {
    recordChars(product, chars, limitChars) {
      entries.push({ product, chars, limitChars, percentOfLimit: (chars / limitChars) * 100, measuredAs: 'chars' });
    },
    recordBytes(product, bytes, limitChars) {
      entries.push({ product, bytes, limitChars, percentOfLimit: (bytes / limitChars) * 100, measuredAs: 'bytes' });
    },
    /** Snapshot of every entry recorded so far, sorted by percent of limit descending. */
    entries() {
      return [...entries].sort((a, b) => b.percentOfLimit - a.percentOfLimit);
    },
  };
}

export default {
  DEFAULT_LIMIT_CHARS,
  ProductTooLargeError,
  computeSerializedLength,
  serializeJsonProduct,
  createHeadroomRecorder,
};
