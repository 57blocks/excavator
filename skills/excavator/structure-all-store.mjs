/**
 * structure-all-store.mjs
 *
 * Line-oriented persistence for the structure extraction result (openspec:
 * changes/knowledge-graph-line-store, design D4). `structure-all.json` used to
 * be one whole-document JSON — 45% of V8's single-string limit on
 * apache/hadoop — written by the `structure-all.mjs` child script and parsed
 * whole by every reader. `structure-all.jsonl` stores one record per line.
 *
 * Layout (one record per line, compact JSON):
 *   1. exactly one `header` record (must be line 1):
 *        { record: 'header', format, keys, fields, resultCount }
 *      `keys` is the result object's top-level key order, `fields` every
 *      top-level value except `results` (`scriptCompleted`, `chunkSize`,
 *      `filesRequested`, `filesAnalyzed`, `byStatus`, ...).
 *   2. one { record: 'result', result } per element of `results`, in order.
 *
 * `readStructureAll` returns an object strictly deep-equal to what was
 * written and validates as it reads: header first with the expected
 * `format`, no second header, no unknown record type, and exactly
 * `resultCount` results. Any failure throws `StructureAllFormatError`.
 *
 * Contract: openspec/specs/fact-graph/spec.md (requirement "图谱持久化不受单字符串上限约束且往返无损")
 */

import { readFileSync } from 'node:fs';
import { DEFAULT_READ_BLOCK_SIZE, readLineFile, writeLineFile } from './jsonl-lines.mjs';
import { DEFAULT_LIMIT_CHARS, serializeJsonProduct } from './product-serialization.mjs';

/** The current on-disk file name, inside `.excavator/intermediate/`. */
export const STRUCTURE_ALL_FILE = 'structure-all.jsonl';

/** The retired whole-document file name; never read by default. */
export const LEGACY_STRUCTURE_ALL_FILE = 'structure-all.json';

/** Stamped on every header record. */
export const STRUCTURE_ALL_FORMAT = 'excavator-structure-all-lines/1';

const RESULTS_KEY = 'results';

export class StructureAllFormatError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StructureAllFormatError';
  }
}

/**
 * Persist a structure-all result object as line records. Each record is
 * serialized on its own, so only a single record can reach `limit`, and that
 * fails as a named ProductTooLargeError.
 *
 * @param {string} path
 * @param {{ results: object[], [key: string]: * }} output
 * @param {{ limit?: number }} [options]
 * @returns {{ bytes: number, lines: number, maxLineChars: number }}
 */
export function writeStructureAll(path, output, { limit = DEFAULT_LIMIT_CHARS } = {}) {
  if (!output || !Array.isArray(output[RESULTS_KEY])) {
    throw new TypeError('writeStructureAll: output.results must be an array');
  }
  const keys = Object.keys(output).filter((key) => output[key] !== undefined);
  const fields = {};
  for (const key of keys) {
    if (key !== RESULTS_KEY) {
      Object.defineProperty(fields, key, { value: output[key], enumerable: true, writable: true, configurable: true });
    }
  }
  return writeLineFile(path, (push) => {
    const emit = (record) => push(serializeJsonProduct(STRUCTURE_ALL_FILE, record, { limit }));
    emit({ record: 'header', format: STRUCTURE_ALL_FORMAT, keys, fields, resultCount: output[RESULTS_KEY].length });
    for (const result of output[RESULTS_KEY]) emit({ record: 'result', result: result === undefined ? null : result });
  });
}

/**
 * Read a `structure-all.jsonl` file, validating it as it is read. When
 * `stats` is given, `stats.maxLineChars` is set to the longest line read.
 *
 * @param {string} path
 * @param {{ blockSize?: number, stats?: { maxLineChars?: number } }} [options]
 * @returns {object}
 */
export function readStructureAll(path, { blockSize = DEFAULT_READ_BLOCK_SIZE, stats = null } = {}) {
  let header = null;
  let lineNo = 0;
  let maxLineChars = 0;
  const results = [];

  function fail(message) {
    throw new StructureAllFormatError(`${path}: ${message} (line ${lineNo})`);
  }

  readLineFile(path, (line) => {
    lineNo += 1;
    if (line.length > maxLineChars) maxLineChars = line.length;
    let record;
    try {
      record = JSON.parse(line);
    } catch (error) {
      fail(`invalid JSON (${error.message})`);
    }
    if (header === null) {
      if (record === null || typeof record !== 'object' || record.record !== 'header' || record.format !== STRUCTURE_ALL_FORMAT) {
        fail(`expected the first line to be a header record with format "${STRUCTURE_ALL_FORMAT}"`);
      }
      const { keys, fields, resultCount } = record;
      if (!Array.isArray(keys) || !keys.every((key) => typeof key === 'string') || new Set(keys).size !== keys.length
        || !keys.includes(RESULTS_KEY)) {
        fail('header "keys" must be an array of distinct strings including "results"');
      }
      if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) fail('header "fields" must be an object');
      for (const key of keys) {
        if (key !== RESULTS_KEY && !Object.hasOwn(fields, key)) fail(`header lists key "${key}" but carries no value for it`);
      }
      if (!Number.isInteger(resultCount) || resultCount < 0) fail('header "resultCount" must be a non-negative integer');
      header = record;
      return;
    }
    const kind = record !== null && typeof record === 'object' ? record.record : undefined;
    if (kind === 'header') fail('a second header record is not allowed after line 1');
    if (kind !== 'result') fail(`unknown record type: ${JSON.stringify(kind)}`);
    if (!Object.hasOwn(record, 'result')) fail('result record has no "result" value');
    results.push(record.result);
  }, { blockSize });

  if (header === null) fail('missing header record (file is empty)');
  if (results.length !== header.resultCount) {
    fail(`result count mismatch: header declares ${header.resultCount}, found ${results.length}`);
  }
  if (stats) stats.maxLineChars = maxLineChars;

  const output = {};
  for (const key of header.keys) {
    const value = key === RESULTS_KEY ? results : header.fields[key];
    Object.defineProperty(output, key, { value, enumerable: true, writable: true, configurable: true });
  }
  return output;
}

/**
 * Read a structure-all result from an explicit path: `.jsonl` through this
 * store, anything else as one JSON document. For CLI `--structure` arguments
 * that may point at a caller-supplied JSON fixture; default paths are always
 * `.jsonl`.
 *
 * @param {string} path
 * @returns {object}
 */
export function readStructureAllPath(path) {
  return path.endsWith('.jsonl') ? readStructureAll(path) : JSON.parse(readFileSync(path, 'utf-8'));
}

export default {
  STRUCTURE_ALL_FILE,
  LEGACY_STRUCTURE_ALL_FILE,
  STRUCTURE_ALL_FORMAT,
  StructureAllFormatError,
  writeStructureAll,
  readStructureAll,
  readStructureAllPath,
};
