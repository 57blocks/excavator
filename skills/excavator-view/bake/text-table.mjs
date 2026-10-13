/**
 * text-table.mjs
 *
 * A per-segment string table with UTF-8 byte accounting, for the source-text
 * segments the budget can drop whole (`evidenceText`, `excerpts`,
 * `indexLiterals`). Each lives in its own table, never in the global one, so
 * dropping a segment leaves none of its bytes behind.
 */

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
      this.bytes += Buffer.byteLength(text, 'utf-8');
    }
    return id;
  }
}
