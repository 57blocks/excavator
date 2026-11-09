/**
 * The status dictionary as the outputs read it (openspec change
 * handbook-status-dictionary, design D6): `<out>/dictionaries.json`, checked
 * with the shape check the `data` command writes it under. Only the technical
 * view shows it. The page gets the part of it the dictionary page draws: not
 * the candidate ledger, not the scan counts.
 */

import { join } from 'node:path';

import { checkDictionariesShape } from './dict-shape.mjs';
import { readJson } from './json-file.mjs';

export const DICT_FILE = 'dictionaries.json';

/** `{ state: 'ok', data }`, `{ state: 'missing' }` or `{ state: 'malformed' }` (not JSON, or a shape the check refuses). */
export function loadDictionariesSection(outDir) {
  const read = readJson(join(outDir, DICT_FILE));
  if (read.missing) return { state: 'missing' };
  if (!read.ok || checkDictionariesShape(read.value).length > 0) return { state: 'malformed' };
  return { state: 'ok', data: read.value };
}

/** The ui key of a form key: `ts-const-object` is `md.dict.form.tsConstObject`. */
export const dictFormKey = (form) => `md.dict.form.${form.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())}`;

/** The part of a checked dictionaries object the page shows: the value sets, the mismatches and the counts. */
export function dictionariesPageSection(data) {
  return { recognized: data.recognized, applications: data.applications, dictionaries: data.dictionaries, mismatches: data.mismatches, counts: data.counts };
}
