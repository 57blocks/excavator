/**
 * fingerprint-scan.mjs
 *
 * Reads only `files.<path>.totalLines` out of `fingerprints.json` with a
 * streaming, validating JSON scanner (openspec change `artifact-view`, task
 * 4A.6). The bake needs one number per file, but the file also carries every
 * function, class, import and export of every file; JSON.parse of the whole
 * document was the bake's largest transient allocation on a large target.
 * The scanner keeps no object tree: only the keys it must compare and the
 * resulting path -> line-count map. Pure (fed byte chunks by the caller: the
 * bake from a Node read stream, the page from a dropped File's stream).
 *
 * Semantics match JSON.parse followed by the former lookup exactly: the
 * whole document must be valid JSON ("not valid JSON (...)" otherwise); the
 * top level must be an object whose last `files` member is an object, not
 * an array ("has no "files" object" otherwise; the former reading accepted an
 * array as an empty map); a file's line count is its entry's last
 * `totalLines` member when that is an integer >= 0. Duplicate keys resolve
 * last-wins, as JSON.parse does. Bytes >= 0x80 occur only inside strings in
 * UTF-8 JSON, so the scanner works on bytes and decodes only captured keys.
 */

const UTF8 = new TextDecoder('utf-8');

export class FingerprintFormatError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'FingerprintFormatError';
  }
}

const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const ESCAPES = new Set([0x22, 0x5c, 0x2f, 0x62, 0x66, 0x6e, 0x72, 0x74]);
const LITERALS = { 0x74: 'true', 0x66: 'false', 0x6e: 'null' };

/** @param {number} b */
const isSpace = (b) => b === 0x20 || b === 0x0a || b === 0x0d || b === 0x09;
/** @param {number} b */
const isHex = (b) => (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x46) || (b >= 0x61 && b <= 0x66);
/** @param {number} b */
const isNumberByte = (b) => (b >= 0x30 && b <= 0x39) || b === 0x2d || b === 0x2b || b === 0x2e || b === 0x65 || b === 0x45;

/**
 * Container roles: 'top' (the document object), 'files' (its `files`
 * object), 'entry' (one file's object), 'other' (anything else).
 * @typedef {{ kind: 'obj'|'arr', role: 'top'|'files'|'entry'|'other', state: string, key: string|null }} Frame
 */

export class FingerprintScanner {
  constructor() {
    /** @type {Frame[]} */
    this.stack = [];
    /** @type {Map<string, number>} */
    this.counts = new Map();
    this.done = false; // the top-level value is complete
    this.topIsObject = false;
    this.filesIsObject = false;
    this.filesSeen = false;
    /** Current file path while inside a `files` member value. */
    this.entryPath = /** @type {string|null} */ (null);
    // token state
    this.mode = 'value'; // value | string | escape | unicode | number | literal
    this.capture = false; // capture the current string's bytes
    /** @type {number[]} */
    this.bytes = [];
    this.hexLeft = 0;
    this.literal = '';
    this.literalAt = 0;
    this.stringIsKey = false;
    this.offset = 0;
  }

  /** @param {string} message */
  fail(message) {
    throw new FingerprintFormatError(`not valid JSON (${message} at byte ${this.offset})`);
  }

  get top() {
    return this.stack[this.stack.length - 1];
  }

  /** Role and meaning of a value about to start in the current position. */
  valueRole() {
    const frame = this.top;
    if (!frame) return 'top';
    if (frame.kind === 'obj') {
      if (frame.role === 'top' && frame.key === 'files') return 'files';
      if (frame.role === 'files') return 'entry';
      if (frame.role === 'entry' && frame.key === 'totalLines') return 'total';
    }
    return 'other';
  }

  /** A complete scalar or container value ended in the current frame. */
  valueDone() {
    const frame = this.top;
    if (!frame) {
      this.done = true;
      return;
    }
    frame.state = 'commaOrEnd';
  }

  /** @param {'string'|'number'|'literal'|'container'} kind @param {unknown} value */
  scalar(kind, value) {
    const role = this.valueRole();
    if (role === 'files') {
      this.filesSeen = true;
      this.filesIsObject = false;
      this.counts.clear();
    } else if (role === 'total' && this.entryPath !== null) {
      if (kind === 'number' && Number.isInteger(value) && /** @type {number} */ (value) >= 0) this.counts.set(this.entryPath, /** @type {number} */ (value));
      else this.counts.delete(this.entryPath);
    }
    this.valueDone();
  }

  /** @param {'obj'|'arr'} kind */
  open(kind) {
    const role = this.valueRole();
    if (role === 'top') this.topIsObject = kind === 'obj';
    if (role === 'files') {
      this.filesSeen = true;
      this.filesIsObject = kind === 'obj';
      this.counts.clear();
    }
    if (role === 'total' && this.entryPath !== null) this.counts.delete(this.entryPath);
    const frameRole = kind === 'obj' && (role === 'top' || role === 'files' || role === 'entry') ? role : 'other';
    this.stack.push({ kind, role: /** @type {any} */ (frameRole), state: kind === 'obj' ? 'keyOrEnd' : 'valueOrEnd', key: null });
  }

  close() {
    this.stack.pop();
    const parent = this.top;
    if (parent && parent.role === 'files') this.entryPath = null;
    this.valueDone();
  }

  /** Whether keys of the current object are compared or recorded. */
  keysMatter() {
    const frame = this.top;
    return frame.role === 'top' || frame.role === 'files' || frame.role === 'entry';
  }

  /** @param {string} key */
  keyDone(key) {
    const frame = this.top;
    frame.key = key;
    frame.state = 'colon';
    if (frame.role === 'files') {
      // A repeated path replaces the earlier entry, as in JSON.parse.
      this.entryPath = key;
      this.counts.delete(key);
    }
  }

  decodeCaptured() {
    const raw = UTF8.decode(Uint8Array.from(this.bytes));
    this.bytes = [];
    return /** @type {string} */ (JSON.parse(`"${raw}"`));
  }

  endNumber() {
    let text = '';
    for (const b of this.bytes) text += String.fromCharCode(b);
    this.bytes = [];
    if (!NUMBER.test(text)) this.fail(`malformed number ${JSON.stringify(text)}`);
    this.mode = 'value';
    this.scalar('number', Number(text));
  }

  /** @param {Uint8Array} buf */
  feed(buf) {
    for (let i = 0; i < buf.length; i += 1, this.offset += 1) {
      const b = buf[i];
      switch (this.mode) {
        case 'string':
          if (b === 0x22) {
            this.mode = 'value';
            if (this.stringIsKey) this.keyDone(this.capture ? this.decodeCaptured() : '');
            else {
              if (this.capture) this.bytes = [];
              this.scalar('string', null);
            }
          } else if (b === 0x5c) {
            this.mode = 'escape';
            if (this.capture) this.bytes.push(b);
          } else if (b < 0x20) {
            this.fail('control character in string');
          } else if (this.capture) this.bytes.push(b);
          continue;
        case 'escape':
          if (b === 0x75) {
            this.mode = 'unicode';
            this.hexLeft = 4;
          } else if (ESCAPES.has(b)) this.mode = 'string';
          else this.fail('bad escape');
          if (this.capture) this.bytes.push(b);
          continue;
        case 'unicode':
          if (!isHex(b)) this.fail('bad unicode escape');
          if (this.capture) this.bytes.push(b);
          this.hexLeft -= 1;
          if (this.hexLeft === 0) this.mode = 'string';
          continue;
        case 'literal':
          if (b !== this.literal.charCodeAt(this.literalAt)) this.fail(`bad literal, expected ${this.literal}`);
          this.literalAt += 1;
          if (this.literalAt === this.literal.length) {
            this.mode = 'value';
            this.scalar('literal', null);
          }
          continue;
        case 'number':
          if (isNumberByte(b)) {
            this.bytes.push(b);
            continue;
          }
          this.endNumber();
          break; // reprocess this byte as structure
        default:
          break;
      }
      this.structural(b);
    }
  }

  /** @param {number} b */
  structural(b) {
    if (isSpace(b)) return;
    if (this.done) this.fail('trailing content');
    const frame = this.top;
    const state = frame ? frame.state : 'value';
    if (frame && frame.kind === 'obj' && (state === 'keyOrEnd' || state === 'key')) {
      if (b === 0x7d && state === 'keyOrEnd') return this.close();
      if (b !== 0x22) this.fail('expected a key');
      this.mode = 'string';
      this.stringIsKey = true;
      this.capture = this.keysMatter();
      return;
    }
    if (frame && state === 'colon') {
      if (b !== 0x3a) this.fail("expected ':'");
      frame.state = 'value';
      return;
    }
    if (frame && state === 'commaOrEnd') {
      if (b === 0x2c) {
        frame.state = frame.kind === 'obj' ? 'key' : 'value';
        return;
      }
      if ((b === 0x7d && frame.kind === 'obj') || (b === 0x5d && frame.kind === 'arr')) return this.close();
      this.fail("expected ',' or a closing bracket");
    }
    // A value is expected (document start, after ':' or ',' or '[').
    if (frame && frame.kind === 'arr' && state === 'valueOrEnd' && b === 0x5d) return this.close();
    if (b === 0x7b) return this.open('obj');
    if (b === 0x5b) return this.open('arr');
    if (b === 0x22) {
      this.mode = 'string';
      this.stringIsKey = false;
      this.capture = false;
      return;
    }
    if (b === 0x2d || (b >= 0x30 && b <= 0x39)) {
      this.mode = 'number';
      this.bytes = [b];
      return;
    }
    const literal = /** @type {Record<number, string>} */ (LITERALS)[b];
    if (literal) {
      this.mode = 'literal';
      this.literal = literal;
      this.literalAt = 1;
      return;
    }
    this.fail('unexpected character');
  }

  finish() {
    if (this.mode === 'number') this.endNumber();
    if (this.mode !== 'value' || !this.done) this.fail('unexpected end of input');
    if (!this.topIsObject || !this.filesSeen || !this.filesIsObject) throw new FingerprintFormatError('has no "files" object');
    return this.counts;
  }
}

/**
 * Per-file `totalLines` from a stream of byte chunks; files without a usable
 * count are absent.
 * @param {AsyncIterable<Uint8Array>} chunks
 * @returns {Promise<Map<string, number>>}
 */
export async function scanFingerprintLineCounts(chunks) {
  const scanner = new FingerprintScanner();
  for await (const chunk of chunks) scanner.feed(chunk);
  return scanner.finish();
}
