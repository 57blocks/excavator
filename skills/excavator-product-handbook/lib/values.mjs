/**
 * Value checks (design D8). A label must occur in one of its item's
 * passages, compared after normalization. A number in reader-visible text,
 * with thousands commas removed, must occur as a number in one of the item's
 * passages, whose numbers are read after removing thousands commas and
 * underscore separators between digits.
 */

import { normalize } from './normalize.mjs';

const NUMBER = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;

/** True when `label` occurs in one of `passages`. */
export function labelOccurs(label, passages) {
  const needle = normalize(label).text;
  return needle !== '' && passages.some((passage) => normalize(passage).text.includes(needle));
}

/** The numbers in `text` (after normalization, so full-width digits count), thousands commas removed. */
export function numbersIn(text) {
  return Array.from(normalize(text).text.matchAll(NUMBER), (match) => match[0].replace(/,/g, ''));
}

/** The set of numbers the passages state, read both as written and with `_` separators between digits removed. */
export function passageNumbers(passages) {
  const found = new Set();
  for (const passage of passages) {
    for (const text of [passage, passage.replace(/(?<=\d)_(?=\d)/g, '')]) {
      for (const number of numbersIn(text)) found.add(number);
    }
  }
  return found;
}

/** The numbers of `text` that no passage states, each once. */
export function missingNumbers(text, passages) {
  const stated = passageNumbers(passages);
  return [...new Set(numbersIn(text).filter((number) => !stated.has(number)))];
}
