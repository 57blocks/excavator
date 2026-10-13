/**
 * bundle-codec.mjs
 *
 * The ONE implementation of the `excavator-view-bundle/1` data format
 * (openspec change `artifact-view`, design D3). The bake script
 * (`build-view.mjs`) encodes with it and decodes its own output as a
 * pre-write self-check; the page template (`packages/view`) imports this same
 * file by relative path and decodes with it in the browser. There is no second
 * implementation to drift.
 *
 * Zero dependencies. The decode path uses only globals present in Node >= 22
 * and current browsers (`atob`, `TextDecoder`, `Blob`, `Response`,
 * `DecompressionStream`, typed arrays); it imports no `node:` module. The
 * encode path needs gzip and loads `node:zlib` with a dynamic import, only
 * when compression is requested, so bundlers never see it on the decode path.
 *
 * Bundle model (what `encodeBundle` takes and `decodeBundle` returns):
 *   an ordered object `{ [segmentName]: Table | JsonValue }`, where a Table is
 *   `{ rows: number, columns: { [columnName]: Int32Array } }` with every
 *   column exactly `rows` long. Anything that is not a Table is a JSON
 *   segment and must be JSON-serializable.
 *
 * Wire format: see FORMAT.md next to this file.
 */

/** Format identifier written on the first line. An incompatible change bumps it. */
export const BUNDLE_FORMAT = 'excavator-view-bundle/1';

/** Cell encoding shared by every string-valued column (see FORMAT.md). */
export const CELL_ABSENT = -1;
export const CELL_NULL = -2;
/** Cells at or below this value index the `values` table: index = CELL_VALUE_BASE - cell. */
export const CELL_VALUE_BASE = -3;

const SEGMENT_NAME = /^[a-z][a-zA-Z0-9.]*$/;
const COLUMN_NAME = /^[a-z][a-zA-Z0-9]*$/;

export class BundleFormatError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'BundleFormatError';
  }
}

export class BundleDecodeError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'BundleDecodeError';
  }
}

function assertLittleEndian() {
  const probe = new Uint8Array(new Uint32Array([1]).buffer);
  if (probe[0] !== 1) {
    throw new BundleFormatError('excavator-view-bundle requires a little-endian platform');
  }
}

// ---------------------------------------------------------------------------
// Builders shared by the bake script
// ---------------------------------------------------------------------------

/** A growable Int32 column. */
export class Int32Builder {
  /** @param {number} [initialCapacity] */
  constructor(initialCapacity = 1024) {
    this._data = new Int32Array(Math.max(16, initialCapacity));
    this.length = 0;
  }

  /** @param {number} value */
  push(value) {
    if (this.length === this._data.length) {
      const grown = new Int32Array(this._data.length * 2);
      grown.set(this._data);
      this._data = grown;
    }
    this._data[this.length] = value;
    this.length += 1;
  }

  /** @param {number} index */
  get(index) {
    return this._data[index];
  }

  /** @returns {Int32Array} a right-sized copy */
  finish() {
    return this._data.slice(0, this.length);
  }
}

/**
 * Global string interner plus a deduplicated table of non-string JSON values,
 * turning any field value into one Int32 cell:
 *   undefined -> CELL_ABSENT, null -> CELL_NULL, string -> its string id,
 *   anything else -> CELL_VALUE_BASE - (its index in `values`).
 */
export class Interner {
  constructor() {
    /** @type {Map<string, number>} */
    this._ids = new Map();
    /** @type {string[]} */
    this.strings = [];
    /** @type {Map<string, number>} */
    this._valueIds = new Map();
    /** @type {string[]} JSON text of each distinct non-string value */
    this._valueTexts = [];
  }

  /** @param {string} text @returns {number} */
  intern(text) {
    let id = this._ids.get(text);
    if (id === undefined) {
      id = this.strings.length;
      this.strings.push(text);
      this._ids.set(text, id);
    }
    return id;
  }

  /** @param {unknown} value @returns {number} */
  cell(value) {
    if (value === undefined) return CELL_ABSENT;
    if (value === null) return CELL_NULL;
    if (typeof value === 'string') return this.intern(value);
    const text = JSON.stringify(value);
    if (text === undefined) return CELL_ABSENT;
    let id = this._valueIds.get(text);
    if (id === undefined) {
      id = this._valueTexts.length;
      this._valueTexts.push(text);
      this._valueIds.set(text, id);
    }
    return CELL_VALUE_BASE - id;
  }

  /** @returns {unknown[]} the distinct non-string values, by index */
  values() {
    return this._valueTexts.map((text) => JSON.parse(text));
  }
}

/**
 * Resolve one cell back to its value against decoded `strings` and `values`.
 * @param {number} cell
 * @param {string[]} strings
 * @param {unknown[]} values
 */
export function cellValue(cell, strings, values) {
  if (cell === CELL_ABSENT) return undefined;
  if (cell === CELL_NULL) return null;
  if (cell >= 0) return strings[cell];
  return values[CELL_VALUE_BASE - cell];
}

/**
 * @param {number} rows
 * @param {Record<string, Int32Array>} columns
 * @returns {{ rows: number, columns: Record<string, Int32Array> }}
 */
export function table(rows, columns) {
  return { rows, columns };
}

/** @param {unknown} value */
export function isTable(value) {
  if (value === null || typeof value !== 'object') return false;
  const candidate = /** @type {{ rows?: unknown, columns?: unknown }} */ (value);
  if (!Number.isInteger(candidate.rows) || candidate.columns === null || typeof candidate.columns !== 'object') return false;
  const cols = Object.values(/** @type {object} */ (candidate.columns));
  return cols.length > 0 && cols.every((col) => col instanceof Int32Array);
}

// ---------------------------------------------------------------------------
// Encode (Node only)
// ---------------------------------------------------------------------------

/** @param {Uint8Array} bytes @returns {string} */
function toBase64(bytes) {
  const NodeBuffer = /** @type {any} */ (globalThis).Buffer;
  if (NodeBuffer) return NodeBuffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, /** @type {any} */ (bytes.subarray(i, i + CHUNK)));
  }
  return btoa(binary);
}

/**
 * Serialize one segment value to raw bytes plus its header fields.
 * @param {string} name
 * @param {unknown} value
 */
function segmentBytes(name, value) {
  if (!SEGMENT_NAME.test(name)) throw new BundleFormatError(`invalid segment name: ${JSON.stringify(name)}`);
  if (isTable(value)) {
    const { rows, columns } = /** @type {{ rows: number, columns: Record<string, Int32Array> }} */ (value);
    const names = Object.keys(columns);
    const bytes = new Uint8Array(rows * names.length * 4);
    const view = new Int32Array(bytes.buffer);
    names.forEach((col, i) => {
      if (!COLUMN_NAME.test(col)) throw new BundleFormatError(`segment ${name}: invalid column name ${JSON.stringify(col)}`);
      if (columns[col].length !== rows) {
        throw new BundleFormatError(`segment ${name}: column ${col} has ${columns[col].length} values, expected ${rows}`);
      }
      view.set(columns[col], i * rows);
    });
    return { kind: 'i32', bytes, rows, columns: names };
  }
  const text = JSON.stringify(value);
  if (text === undefined) throw new BundleFormatError(`segment ${name}: value is not JSON-serializable`);
  return { kind: 'json', bytes: new TextEncoder().encode(text), rows: 0, columns: [] };
}

/**
 * Encode a bundle. Returns the payload as an array of lines (never one joined
 * string, so a large bundle is written piecewise), plus per-segment sizes.
 *
 * @param {Record<string, unknown>} segments
 * @param {{ compress?: boolean }} [options]
 * @returns {Promise<{
 *   lines: string[],
 *   segments: Array<{ name: string, kind: 'json'|'i32', rawBytes: number, storedBytes: number, compressed: boolean, base64Chars: number }>,
 *   totalChars: number,
 * }>}
 */
export async function encodeBundle(segments, { compress = true } = {}) {
  assertLittleEndian();
  /** @type {null | ((buf: Uint8Array) => Uint8Array)} */
  let gzip = null;
  if (compress) {
    const zlib = await import('node:zlib');
    gzip = (buf) => zlib.gzipSync(buf);
  }
  const lines = [BUNDLE_FORMAT];
  const report = [];
  for (const [name, value] of Object.entries(segments)) {
    const seg = segmentBytes(name, value);
    const stored = gzip ? gzip(seg.bytes) : seg.bytes;
    const base64 = toBase64(stored);
    const fields = [`@${name}`, seg.kind, String(seg.bytes.length), String(stored.length), gzip ? 'gzip' : 'raw'];
    if (seg.kind === 'i32') fields.push(String(seg.rows), seg.columns.join(','));
    lines.push(fields.join(' '), base64);
    report.push({
      name,
      kind: /** @type {'json'|'i32'} */ (seg.kind),
      rawBytes: seg.bytes.length,
      storedBytes: stored.length,
      compressed: Boolean(gzip),
      base64Chars: base64.length,
    });
  }
  const totalChars = lines.reduce((sum, line) => sum + line.length + 1, 0);
  return { lines, segments: report, totalChars };
}

// ---------------------------------------------------------------------------
// Decode (Node and browser; no node: imports)
// ---------------------------------------------------------------------------

/** @param {string} text @returns {Uint8Array} */
function fromBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** @param {Uint8Array} bytes @returns {Promise<Uint8Array>} */
async function gunzip(bytes) {
  if (typeof DecompressionStream !== 'function') {
    throw new BundleDecodeError(
      'this environment has no DecompressionStream, so compressed segments cannot be read; re-bake the view with --raw',
    );
  }
  const stream = new Blob([/** @type {BlobPart} */ (bytes)]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Parse one segment header line.
 * @param {string} line
 */
function parseSegmentHeader(line) {
  const parts = line.split(' ');
  const [tag, kind, rawText, storedText, codec, rowsText, colsText] = parts;
  const name = tag.slice(1);
  const rawBytes = Number(rawText);
  const storedBytes = Number(storedText);
  const ok = tag.startsWith('@') && SEGMENT_NAME.test(name)
    && (kind === 'json' || kind === 'i32')
    && Number.isInteger(rawBytes) && rawBytes >= 0
    && Number.isInteger(storedBytes) && storedBytes >= 0
    && (codec === 'gzip' || codec === 'raw')
    && (kind === 'json' ? parts.length === 5 : parts.length === 7);
  if (!ok) throw new BundleFormatError(`malformed segment header: ${JSON.stringify(line.slice(0, 200))}`);
  let rows = 0;
  /** @type {string[]} */
  let columns = [];
  if (kind === 'i32') {
    rows = Number(rowsText);
    columns = colsText.split(',');
    if (!Number.isInteger(rows) || rows < 0 || !columns.every((c) => COLUMN_NAME.test(c))) {
      throw new BundleFormatError(`malformed table header for segment ${name}`);
    }
    if (rawBytes !== rows * columns.length * 4) {
      throw new BundleFormatError(`segment ${name}: ${rawBytes} raw bytes do not match ${rows} rows x ${columns.length} columns`);
    }
  }
  return { name, kind, rawBytes, storedBytes, compressed: codec === 'gzip', rows, columns };
}

/**
 * Decode a bundle payload one segment at a time, in payload order: yields
 * `{ name, value, rawBytes, storedBytes, compressed }` and keeps nothing, so
 * a caller that only inspects each segment (the bake's pre-write
 * self-check) never holds a second copy of the whole bundle. Same checks and
 * failures as `decodeBundle`, which is built on it.
 *
 * @param {string | string[]} payload
 * @returns {AsyncGenerator<{ name: string, value: unknown, rawBytes: number, storedBytes: number, compressed: boolean }>}
 */
export async function* decodeSegments(payload) {
  assertLittleEndian();
  const lines = (Array.isArray(payload) ? payload : payload.split('\n'))
    .map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
  // Only surrounding blank lines are insignificant: an empty raw segment's
  // payload line is legitimately empty and must keep its position.
  let first = 0;
  let last = lines.length;
  while (first < last && lines[first].trim() === '') first += 1;
  while (last > first && lines[last - 1].trim() === '' && (last - 1 - first) % 2 === 1) last -= 1;
  if (first === last) throw new BundleFormatError('empty view bundle');
  if (lines[first] !== BUNDLE_FORMAT) {
    throw new BundleFormatError(`unsupported view bundle version ${JSON.stringify(lines[first].slice(0, 80))}; this page reads ${BUNDLE_FORMAT}`);
  }
  if ((last - first - 1) % 2 !== 0) throw new BundleFormatError('view bundle has a segment header without a payload line');

  const seen = new Set();
  for (let i = first + 1; i < last; i += 2) {
    const header = parseSegmentHeader(lines[i]);
    if (seen.has(header.name)) throw new BundleFormatError(`duplicate segment ${header.name}`);
    seen.add(header.name);
    const stored = fromBase64(lines[i + 1]);
    if (stored.length !== header.storedBytes) {
      throw new BundleFormatError(`segment ${header.name}: expected ${header.storedBytes} stored bytes, found ${stored.length}`);
    }
    const raw = header.compressed ? await gunzip(stored) : stored;
    if (raw.length !== header.rawBytes) {
      throw new BundleFormatError(`segment ${header.name}: expected ${header.rawBytes} raw bytes, found ${raw.length}`);
    }
    let value;
    if (header.kind === 'i32') {
      const aligned = raw.byteOffset % 4 === 0 ? raw : raw.slice();
      const all = new Int32Array(aligned.buffer, aligned.byteOffset, header.rows * header.columns.length);
      /** @type {Record<string, Int32Array>} */
      const columns = {};
      header.columns.forEach((col, c) => {
        columns[col] = all.slice(c * header.rows, (c + 1) * header.rows);
      });
      value = table(header.rows, columns);
    } else {
      try {
        value = JSON.parse(new TextDecoder().decode(raw));
      } catch (error) {
        throw new BundleFormatError(`segment ${header.name}: invalid JSON (${/** @type {Error} */ (error).message})`);
      }
    }
    yield { name: header.name, value, rawBytes: header.rawBytes, storedBytes: header.storedBytes, compressed: header.compressed };
  }
}

/**
 * Decode a bundle payload (the placeholder's text content, or the `lines`
 * array `encodeBundle` returned). Throws `BundleFormatError` for an unknown
 * version or malformed structure, `BundleDecodeError` when a segment cannot
 * be decompressed.
 *
 * @param {string | string[]} payload
 * @returns {Promise<{ format: string, segments: Record<string, unknown>, sizes: Array<{ name: string, rawBytes: number, storedBytes: number, compressed: boolean }> }>}
 */
export async function decodeBundle(payload) {
  /** @type {Record<string, unknown>} */
  const segments = {};
  const sizes = [];
  for await (const { name, value, rawBytes, storedBytes, compressed } of decodeSegments(payload)) {
    Object.defineProperty(segments, name, { value, enumerable: true, writable: true, configurable: true });
    sizes.push({ name, rawBytes, storedBytes, compressed });
  }
  return { format: BUNDLE_FORMAT, segments, sizes };
}
