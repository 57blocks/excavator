/**
 * xml-entities.mjs
 *
 * XML entity and character references, for the readers of name-binding-
 * references (openspec: changes/name-binding-references, design D6): the EL
 * lexer reads `&amp;&amp;` in an attribute as `&&`, and the descriptor reader
 * reads `a&amp;b` in a name as `a&b`. Pure string functions.
 *
 * The five predefined entities and numeric references decode to their
 * character. A named reference that is none of those (an HTML `&nbsp;` in a
 * page, a DTD entity) names a character this reader cannot know: `decodeEntity`
 * answers REPLACEMENT for it, never the letters between the `&` and the `;`.
 * Those letters would be read as an identifier and, in an expression, as a
 * name.
 */

const PREDEFINED = Object.freeze({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" });

/** The character that stands for a reference this module cannot decode. */
export const REPLACEMENT = '�';

/** A reference: group 1 decimal, group 2 hexadecimal, group 3 a name. Global: use `matchAll`. */
export const ENTITY_REFERENCE = /&(?:#([0-9]+)|#[xX]([0-9a-fA-F]+)|([A-Za-z][A-Za-z0-9]*));/g;

/**
 * The text a matched reference stands for.
 *
 * @param {RegExpMatchArray} match a match of ENTITY_REFERENCE
 * @param {{ keepUnknown?: boolean }} [options] `keepUnknown`: leave a named
 *   reference that is not predefined as written, instead of REPLACEMENT
 * @returns {string}
 */
export function decodeEntity(match, { keepUnknown = false } = {}) {
  const [written, decimal, hexadecimal, named] = match;
  if (named !== undefined) {
    if (Object.hasOwn(PREDEFINED, named)) return PREDEFINED[named];
    return keepUnknown ? written : REPLACEMENT;
  }
  const code = decimal !== undefined ? Number.parseInt(decimal, 10) : Number.parseInt(hexadecimal, 16);
  // A surrogate half or a value past U+10FFFF is no character.
  if (!Number.isInteger(code) || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) || code === 0) return REPLACEMENT;
  return String.fromCodePoint(code);
}

/** `text` with every reference decoded; an unknown named one stays as written. */
export function decodeXmlText(text) {
  if (!text.includes('&')) return text;
  return text.replace(ENTITY_REFERENCE, (...args) => decodeEntity(args, { keepUnknown: true }));
}
