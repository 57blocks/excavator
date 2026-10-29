/**
 * data-chunks.mjs
 *
 * Splits the explorer page's data object into gzip-compressed parts, each small enough
 * that the page never holds more than `PART_CHARS` characters in one string
 * (openspec: changes/explorer-chunked-data, design D2-D3). V8 caps one string at
 * 536,870,888 characters; a large project's data is several times that as one JSON text.
 *
 * Layout, per data file (the keys of the data object):
 *   - every top-level array goes out of the header: its elements are packed in order into
 *     parts of at most `partChars` characters of JSON; one element over the limit is its own part;
 *   - the other top-level fields are packed in order into header parts, a JSON object each;
 *     one field over the limit is its own header part;
 *   - a value that is not an object is one value, with the same rule.
 * The `sources` table is grouped by path order into parts of `{ "<path>": <entry> }`.
 *
 * The index says where everything is, in the data's own key and field order, so the page can
 * answer "is this file / source here" without decoding a part, and rebuilds each file with the
 * fields in their original order:
 *   { version, files: { "<name>": { value: <part> } | { fields: [{ key, part } | { key, parts: [..] }] }
 *                                 | { paths: { "<path>": <part> } } } }
 * where `paths` is the entry of the `sources` table.
 * A part is the base64 of a gzip of its JSON text. gzip is written with a zero time header,
 * so the same data gives the same bytes on the same zlib.
 *
 * A value that cannot be written as one string (JSON.stringify throws a RangeError) is an
 * error that names the data file and the field.
 *
 * Deterministic and model-free.
 */

import { gzipSync } from 'node:zlib';

/** The most characters one part holds once decoded: 32 times smaller than V8's one-string limit. */
export const PART_CHARS = 16 * 1024 * 1024;

export const INDEX_VERSION = 1;
export const SOURCES_FILE_KEY = 'sources';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && typeof value.toJSON !== 'function';

/** The JSON text of a value, undefined when JSON leaves the value out. A value too large for one string is an error naming `where`. */
function stringify(value, where) {
  try {
    return JSON.stringify(value);
  } catch (error) {
    if (error instanceof RangeError) {
      throw new Error(`cannot write ${where} as one string: ${error.message}; the value is too large to be packed into the page`);
    }
    throw error;
  }
}

/** Accumulates JSON member texts and hands out one part's text whenever the next member would pass the limit. */
class Packer {
  constructor(open, close, limit, flush) {
    this.open = open;
    this.close = close;
    this.limit = limit;
    this.flush = flush;
    this.items = [];
    this.chars = 2;
  }

  /** `text` is one member (an element, or `"key":value`); `owner` is whatever the caller wants handed back with the part it lands in. */
  add(text, owner) {
    if (this.items.length > 0 && this.chars + 1 + text.length > this.limit) this.finish();
    this.chars += text.length + (this.items.length > 0 ? 1 : 0);
    this.items.push({ text, owner });
  }

  finish() {
    if (this.items.length === 0) return;
    const text = `${this.open}${this.items.map((item) => item.text).join(',')}${this.close}`;
    this.flush(text, this.items.map((item) => item.owner));
    this.items = [];
    this.chars = 2;
  }
}

/**
 * @param {Record<string, unknown>} data
 * @param {{ partChars?: number }} [options] `partChars` replaces the limit (the tests use a tiny one)
 * @returns {{ index: object, parts: { id: string, base64: Buffer }[], keyBytes: Record<string, number> }}
 *   `keyBytes` is the size in bytes of each data key's JSON text, from the pieces (no whole-value string)
 */
export function chunkExplorerData(data, options = {}) {
  const limit = options.partChars ?? PART_CHARS;
  const parts = [];
  const addPart = (text) => {
    const id = parts.length;
    parts.push({ id: `xv-part-${id}`, base64: Buffer.from(gzipSync(Buffer.from(text, 'utf-8')).toString('base64'), 'ascii') });
    return id;
  };

  const files = Object.create(null);
  const keyBytes = {};

  for (const [name, value] of Object.entries(data)) {
    if (name === SOURCES_FILE_KEY && isObject(value)) {
      ({ entry: files[name], bytes: keyBytes[name] } = chunkSources(value, limit, addPart));
    } else if (isObject(value)) {
      ({ entry: files[name], bytes: keyBytes[name] } = chunkFile(name, value, limit, addPart));
    } else {
      const text = stringify(value, `${name} (the whole file)`);
      if (text === undefined) continue;
      files[name] = { value: addPart(text) };
      keyBytes[name] = Buffer.byteLength(text);
    }
  }

  return { index: { version: INDEX_VERSION, files }, parts, keyBytes };
}

/** One data file that is an object: header parts for its plain fields, array parts for each array field. */
function chunkFile(name, value, limit, addPart) {
  const fields = [];
  // Fields in their own order; an array's parts are added as the field is reached, the plain fields go through the header packer.
  const header = new Packer('{', '}', limit, (text, owners) => {
    const part = addPart(text);
    for (const field of owners) field.part = part;
  });
  let bytes = 2;
  let members = 0;

  for (const [key, field] of Object.entries(value)) {
    if (Array.isArray(field)) {
      const entry = { key, parts: [] };
      const arrayBytes = chunkArray(name, key, field, limit, addPart, entry.parts);
      fields.push(entry);
      bytes += Buffer.byteLength(JSON.stringify(key)) + 1 + arrayBytes + (members > 0 ? 1 : 0);
      members += 1;
      continue;
    }
    const text = stringify(field, `${name} field "${key}"`);
    if (text === undefined) continue;
    const entry = { key, part: -1 };
    fields.push(entry);
    header.add(`${JSON.stringify(key)}:${text}`, entry);
    bytes += Buffer.byteLength(JSON.stringify(key)) + 1 + Buffer.byteLength(text) + (members > 0 ? 1 : 0);
    members += 1;
  }
  header.finish();
  return { entry: { fields }, bytes };
}

/** The elements of one array in parts of at most `limit` characters; returns the byte size of the array's JSON text. */
function chunkArray(name, key, array, limit, addPart, partIds) {
  const packer = new Packer('[', ']', limit, (text) => partIds.push(addPart(text)));
  let bytes = 2;
  array.forEach((element, position) => {
    const text = stringify(element, `${name} field "${key}" element ${position}`) ?? 'null';
    packer.add(text, null);
    bytes += Buffer.byteLength(text) + (position > 0 ? 1 : 0);
  });
  packer.finish();
  return bytes;
}

/** The sources table in parts of `{ "<path>": <entry> }`, taken in path order; the index lists the paths in the table's own order. */
function chunkSources(table, limit, addPart) {
  const owners = new Map();
  const packer = new Packer('{', '}', limit, (text, paths) => {
    const part = addPart(text);
    for (const path of paths) owners.set(path, part);
  });
  const texts = new Map();
  let bytes = 2;
  let members = 0;
  for (const [path, entry] of Object.entries(table)) {
    const text = stringify(entry, `${SOURCES_FILE_KEY} entry "${path}"`);
    if (text === undefined) continue;
    texts.set(path, text);
    bytes += Buffer.byteLength(JSON.stringify(path)) + 1 + Buffer.byteLength(text) + (members > 0 ? 1 : 0);
    members += 1;
  }
  for (const path of [...texts.keys()].sort()) packer.add(`${JSON.stringify(path)}:${texts.get(path)}`, path);
  packer.finish();
  const paths = Object.create(null);
  for (const path of texts.keys()) paths[path] = owners.get(path);
  return { entry: { paths }, bytes };
}
