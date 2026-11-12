/**
 * Passage normalization for check-lane, the same rule doc-map.py applies to
 * a quote (openspec change prd-feature-pipeline, task 2.3): NFKC applied to
 * each base character together with the combining marks after it; soft
 * hyphens, zero-width characters and the byte-order mark dropped; curly
 * quotes, primes, dashes and the ellipsis folded to ASCII; every run of white
 * space made one space, none at either end; case kept.
 *
 * Every special character is built from its code point so this file holds
 * only ASCII. One difference from Python: a "combining mark" here is Unicode
 * category Mn, where Python uses a nonzero canonical combining class; the two
 * differ only on marks that never compose, so the compared text is the same.
 */

const chars = (...points) => points.map((point) => String.fromCodePoint(point));
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

const INVISIBLE = new Set(chars(0x00ad, 0x200b, 0x200c, 0x200d, 0x2060, 0xfeff));
const FOLDS = new Map([
  ...chars(0x2018, 0x2019, 0x201a, 0x201b, 0x2032).map((c) => [c, "'"]),
  ...chars(0x201c, 0x201d, 0x201e, 0x201f, 0x2033).map((c) => [c, '"']),
  ...chars(0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2212).map((c) => [c, '-']),
  [String.fromCodePoint(0x2026), '...'],
]);
// Python's str.isspace(): bidi class WS, B or S, or category Zs.
const SPACES = new Set(chars(
  ...range(0x09, 0x0d), ...range(0x1c, 0x20), 0x85, 0xa0, 0x1680,
  ...range(0x2000, 0x200a), 0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
));
const COMBINING = /^\p{Mn}$/u;

/**
 * The text as compared, and for each of its characters the UTF-16 offset in
 * `text` it came from.
 * @param {string} text
 * @returns {{ text: string, starts: number[] }}
 */
export function normalize(text) {
  const out = [];
  const starts = [];
  let blankAt = null;
  const points = Array.from(text);
  let offset = 0;
  let i = 0;
  while (i < points.length) {
    let j = i + 1;
    let groupLength = points[i].length;
    while (j < points.length && COMBINING.test(points[j])) {
      groupLength += points[j].length;
      j += 1;
    }
    const origin = offset;
    for (const char of Array.from(points.slice(i, j).join('').normalize('NFKC'))) {
      if (INVISIBLE.has(char)) continue;
      const folded = FOLDS.get(char) ?? char;
      if (SPACES.has(folded)) {
        if (blankAt === null) blankAt = origin;
        continue;
      }
      if (blankAt !== null) {
        if (out.length > 0) {
          out.push(' ');
          starts.push(blankAt);
        }
        blankAt = null;
      }
      for (const piece of Array.from(folded)) {
        out.push(piece);
        starts.push(origin);
      }
    }
    offset += groupLength;
    i = j;
  }
  return { text: out.join(''), starts };
}

/**
 * How often `passage` occurs in `fileText` after normalization (overlaps
 * included), and the 1-based line of its start when it occurs exactly once.
 * An empty passage occurs nowhere.
 * @returns {{ count: number, line: number|null }}
 */
export function findOnce(fileText, passage) {
  const needle = normalize(passage).text;
  if (needle === '') return { count: 0, line: null };
  const haystack = normalize(fileText);
  const first = haystack.text.indexOf(needle);
  let count = 0;
  for (let at = first; at !== -1; at = haystack.text.indexOf(needle, at + 1)) count += 1;
  if (count !== 1) return { count, line: null };
  const origin = haystack.starts[first];
  let line = 1;
  for (let k = fileText.indexOf('\n'); k !== -1 && k < origin; k = fileText.indexOf('\n', k + 1)) line += 1;
  return { count, line };
}
