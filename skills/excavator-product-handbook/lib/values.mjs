/**
 * Value checks (design D8). A label must occur in one of its item's
 * passages, compared after normalization. A number in reader-visible text,
 * with thousands commas removed, must occur as a number in one of the item's
 * passages, whose numbers are read after removing thousands commas and
 * underscore separators between digits.
 */

import { normalize } from './normalize.mjs';

const NUMBER = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;

const NAMED_ENTITIES = Object.freeze({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' });
const ENTITY = /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z]{2,8}));/g;

/** `text` with HTML named (amp, lt, gt, quot, apos, nbsp) and numeric character references decoded; any other reference stays as written. */
export function decodeEntities(text) {
  return text.replace(ENTITY, (whole, dec, hex, name) => {
    if (name !== undefined) return NAMED_ENTITIES[name] ?? whole;
    const code = dec !== undefined ? Number(dec) : parseInt(hex, 16);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : whole;
  });
}

/** `text` as a label is compared: entities decoded, then normalized (white space made one space); case is kept. */
export const comparable = (text) => normalize(decodeEntities(text)).text;

/** True when `label` occurs in one of `passages`. */
export function labelOccurs(label, passages) {
  const needle = comparable(label);
  return needle !== '' && passages.some((passage) => comparable(passage).includes(needle));
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
