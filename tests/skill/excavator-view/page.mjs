/** Helpers that read a packed explorer page back the way the browser would: the index and the compressed parts, and the manifest block. */

import { gunzipSync } from 'node:zlib';

const BLOCK = (id) => new RegExp(`<script type="application/json" id="${id}">([\\s\\S]*?)</script>`);
const PART = /<script type="application\/octet-stream" id="(xv-part-\d+)">([A-Za-z0-9+/=]*)<\/script>/g;

/** The decoded JSON text of every data part, by part number, in the order the page holds them. */
export function partTexts(html) {
  const texts = [];
  for (const match of html.matchAll(PART)) {
    const number = Number(match[1].slice('xv-part-'.length));
    if (number !== texts.length) throw new Error(`part ${match[1]} is out of order`);
    texts.push(gunzipSync(Buffer.from(match[2], 'base64')).toString('utf-8'));
  }
  return texts;
}

/** The page's index block, parsed. */
export function explorerIndex(html) {
  const index = BLOCK('xv-explorer-index').exec(html);
  if (!index) throw new Error('no index block in the page');
  return JSON.parse(index[1]);
}

/** The data object rebuilt from the index and the parts: the keys and fields in the order they were packed. */
function rebuild(index, texts) {
  const parsed = new Map();
  const part = (n) => {
    if (!parsed.has(n)) parsed.set(n, JSON.parse(texts[n]));
    return parsed.get(n);
  };
  const data = {};
  for (const [name, entry] of Object.entries(index.files)) {
    if ('value' in entry) {
      data[name] = part(entry.value);
    } else if ('paths' in entry) {
      const table = Object.create(null);
      for (const [path, n] of Object.entries(entry.paths)) table[path] = part(n)[path];
      data[name] = table;
    } else {
      const file = {};
      for (const field of entry.fields) {
        // defineProperty: a field named __proto__ stays an own field.
        const value = 'parts' in field ? field.parts.flatMap((n) => part(n)) : part(field.part)[field.key];
        Object.defineProperty(file, field.key, { value, enumerable: true, writable: true, configurable: true });
      }
      data[name] = file;
    }
  }
  return data;
}

/** The data object and the pack's manifest of an explorer page. */
export function explorerPage(html) {
  const manifest = BLOCK('xv-explorer-manifest').exec(html);
  if (!manifest) throw new Error('no manifest block in the page');
  return { data: rebuild(explorerIndex(html), partTexts(html)), manifest: JSON.parse(manifest[1]) };
}

/** The page's text with every decoded part appended: what a "this text is nowhere in the page" check has to look through, since the parts are compressed. */
export function pageContent(html) {
  return `${html}\n${partTexts(html).join('\n')}`;
}

/** The raw text of one JSON block, as the page holds it (before parsing). */
export function blockText(html, id) {
  const match = BLOCK(id).exec(html);
  return match ? match[1] : null;
}
