/**
 * Where a cited passage sits in its file (design D14): the first and the last
 * line it covers, found with the same normalization the citation check uses,
 * so a passage that passed that check is found here. Offsets are mapped back
 * through `normalize`, whose per-character table is indexed by code point.
 */

import { normalize } from './normalize.mjs';

/** The 1-based line of UTF-16 offset `offset` in `text`. */
function lineAt(text, offset) {
  let line = 1;
  for (let k = text.indexOf('\n'); k !== -1 && k < offset; k = text.indexOf('\n', k + 1)) line += 1;
  return line;
}

/**
 * `{ startLine, endLine }` of the one occurrence of `passage` in `fileText`,
 * or null when it occurs zero times or more than once.
 */
export function locatePassage(fileText, passage) {
  const needle = normalize(passage).text;
  if (needle === '') return null;
  const haystack = normalize(fileText);
  const first = haystack.text.indexOf(needle);
  if (first === -1 || haystack.text.indexOf(needle, first + 1) !== -1) return null;
  const firstChar = Array.from(haystack.text.slice(0, first)).length;
  const lastChar = firstChar + Array.from(needle).length - 1;
  return { startLine: lineAt(fileText, haystack.starts[firstChar]), endLine: lineAt(fileText, haystack.starts[lastChar]) };
}
