/** JSON files of a PRD run: read with a reason on failure, written with stable 2-space formatting. */

import { readFileSync, renameSync, writeFileSync } from 'node:fs';

/** `{ ok: true, value }`, `{ ok: false, missing: true }` or `{ ok: false, reason }`. */
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

/** Write `value` as 2-space JSON with a final newline, through a temp file so a reader never sees half of it. */
export function writeJson(path, value) {
  const temp = `${path}.tmp-${process.pid}`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temp, path);
}

export const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
export const isString = (value) => typeof value === 'string' && value.trim() !== '';
export const isCount = (value) => Number.isInteger(value) && value >= 0;
export const isStringArray = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string');
