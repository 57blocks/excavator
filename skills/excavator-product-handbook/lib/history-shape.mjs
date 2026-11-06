/**
 * The shape of `<out>/entries/history.json` and its loader (openspec change
 * handbook-history-appendix, design D2). The file is written by the `history`
 * command (history-run.mjs) from git and the project files; no model writes
 * any of it. The check holds the exact keys and the types, so a renderer reads
 * the file without guarding each field.
 */

import { join } from 'node:path';

import { isObject, readJson } from './json-file.mjs';

export const HISTORY_FORMAT = 'excavator-product-handbook-history/1';
export const HISTORY_FILE = 'entries/history.json';
/** Why the project has no history at all (the hotspot product's reasons). */
export const NO_HISTORY_REASONS = Object.freeze(['not-a-repository', 'inside-repository']);
/** Why one application has no history: the project's reasons, or a repository with no commit under the directory. */
export const APP_REASONS = Object.freeze([...NO_HISTORY_REASONS, 'no-commits']);

const isString = (value) => typeof value === 'string' && value !== '';
const isCount = (value) => Number.isInteger(value) && value >= 0;
const isDay = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const nullOr = (test) => (value) => value === null || test(value);

/** Problems of the exact keys of `value` (an object) against `spec`: a key to a test, each test given the value and returning true when it holds. */
function objectProblems(value, path, spec) {
  if (!isObject(value)) return [`${path}: must be an object`];
  const problems = [];
  for (const [key, test] of Object.entries(spec)) {
    if (!Object.hasOwn(value, key)) problems.push(`${path}: missing key "${key}"`);
    else if (!test(value[key])) problems.push(`${path}.${key}: has a value of the wrong kind`);
  }
  for (const key of Object.keys(value)) if (!Object.hasOwn(spec, key)) problems.push(`${path}: unexpected key "${key}"`);
  return problems;
}

const listOf = (test) => (value) => Array.isArray(value) && value.every(test);
const rowOf = (spec) => (value) => objectProblems(value, 'row', spec).length === 0;

const YEAR_ROW = rowOf({ year: (v) => Number.isInteger(v) && v >= 1970, commits: isCount, byApp: (v) => isObject(v) && Object.values(v).every((n) => Number.isInteger(n) && n >= 1) });
const APP_ROW = rowOf({ dir: isString, first: nullOr(isDay), last: nullOr(isDay), commits: nullOr(isCount), authors: nullOr(isCount), authors80: nullOr(isCount), reason: nullOr((v) => APP_REASONS.includes(v)) });
const HOTSPOT_ROW = rowOf({ path: isString, app: nullOr(isString), commits: isCount, authors: isCount, lines: isCount, last: isDay, uncertain: isCount, features: listOf(isString) });
const PAIR_ROW = rowOf({ a: isString, b: isString, commits: isCount });
const TEST_ROW = rowOf({ dir: isString, sourceFiles: isCount, testFiles: isCount });

/** Every way `doc` departs from the shape of history.json; an empty list means it fits. A row's problem is named by its list and position. */
export function checkHistoryShape(doc) {
  const top = objectProblems(doc, '(top level)', {
    format: (v) => v === HISTORY_FORMAT,
    noHistory: nullOr((v) => objectProblems(v, 'noHistory', { reason: (r) => NO_HISTORY_REASONS.includes(r) }).length === 0),
    years: Array.isArray,
    apps: Array.isArray,
    hotspots: Array.isArray,
    coChange: Array.isArray,
    tests: Array.isArray,
  });
  if (top.length > 0) return top;
  const problems = [];
  const rows = [['years', YEAR_ROW], ['apps', APP_ROW], ['hotspots', HOTSPOT_ROW], ['coChange', PAIR_ROW], ['tests', TEST_ROW]];
  for (const [key, test] of rows) doc[key].forEach((row, index) => { if (!test(row)) problems.push(`${key}[${index}]: is not a ${key} row of the format`); });
  return problems;
}

/** `{ state: 'ok', history }`, `{ state: 'missing' }` or `{ state: 'malformed' }` (not JSON, or a shape the check refuses). */
export function loadHistorySection(outDir) {
  const read = readJson(join(outDir, HISTORY_FILE));
  if (read.missing) return { state: 'missing' };
  if (!read.ok || checkHistoryShape(read.value).length > 0) return { state: 'malformed' };
  return { state: 'ok', history: read.value };
}
