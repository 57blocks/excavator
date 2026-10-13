/**
 * text-table.mjs
 *
 * A per-segment string table with UTF-8 byte accounting, for the source-text
 * segments the budget can drop whole (`evidenceText`, `excerpts`,
 * `indexLiterals`). Each lives in its own table, never in the global one, so
 * dropping a segment leaves none of its bytes behind. Pure (no `Buffer`), so
 * the page's directory reader uses it too.
 */

/** UTF-8 byte length of a string, as Node counts it for a utf-8 Buffer (a test pins the two). */
export function utf8Length(text) {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else bytes += 3;
    } else bytes += 3; // BMP, and a lone surrogate (encoded as U+FFFD, 3 bytes)
  }
  return bytes;
}

export class TextTable {
  constructor() {
    /** @type {Map<string, number>} */
    this._ids = new Map();
    /** @type {string[]} */
    this.strings = [];
    this.bytes = 0;
  }

  /** @param {string} text */
  id(text) {
    let id = this._ids.get(text);
    if (id === undefined) {
      id = this.strings.length;
      this.strings.push(text);
      this._ids.set(text, id);
      this.bytes += utf8Length(text);
    }
    return id;
  }
}
