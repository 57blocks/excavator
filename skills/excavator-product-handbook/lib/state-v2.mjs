/**
 * state.json of a Markdown-chapter run (format /2): one record per chapter with its
 * status, attempts, reasons and the sha256 of the file the record is about.
 * A state.json of any other format belongs to an older version of the skill and is
 * never read or changed here.
 */

import { join } from 'node:path';

import { UsageError } from './errors.mjs';
import { readJson, writeJson } from './json-file.mjs';

export const STATE_FORMAT_V2 = 'excavator-product-handbook-state/2';
const FILE = 'state.json';

/**
 * `{ ok: true, state }` (an empty state when the file is missing) or
 * `{ ok: false, line }` when the file has another format.
 */
export function loadStateV2(outDir) {
  const read = readJson(join(outDir, FILE));
  if (read.missing) return { ok: true, state: { format: STATE_FORMAT_V2, chapters: {} } };
  if (!read.ok) throw new UsageError(`${FILE} ${read.reason}`);
  const value = read.value;
  if (value === null || typeof value !== 'object' || value.format !== STATE_FORMAT_V2) {
    const format = value !== null && typeof value === 'object' && typeof value.format === 'string' ? value.format : 'no format';
    return { ok: false, line: `state.json is from an older version of this skill (${format}); run again with --fresh` };
  }
  return { ok: true, state: { format: STATE_FORMAT_V2, chapters: value.chapters ?? {} } };
}

/** Write `state` atomically. */
export const saveStateV2 = (outDir, state) => writeJson(join(outDir, FILE), state);
