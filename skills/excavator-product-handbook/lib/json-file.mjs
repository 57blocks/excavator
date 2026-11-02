/** JSON files of a handbook run: read with a reason on failure, written atomically with stable 2-space formatting. */

import { readFileSync, renameSync, writeFileSync } from 'node:fs';

/** `{ ok: true, value }`, `{ ok: false, missing: true, reason }` or `{ ok: false, reason }`. */
export function readJson(path) {
  let text;
  try {
    text = readFileSync(path, 'utf-8');
  } catch (error) {
    if (error.code === 'ENOENT') return { ok: false, missing: true, reason: 'is missing' };
    return { ok: false, reason: `cannot be read (${error.message})` };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false, reason: `is not valid JSON (${error.message})` };
  }
}

/** Write text through a temp file and a rename, so a reader never sees half of it. */
export function writeTextAtomic(path, text) {
  const temp = `${path}.tmp-${process.pid}`;
  writeFileSync(temp, text);
  renameSync(temp, path);
}

/** Write `value` as 2-space JSON with a final newline, atomically. */
export function writeJson(path, value) {
  writeTextAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

export const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
