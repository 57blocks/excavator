/**
 * model-entry-points.mjs
 *
 * Checks the entry points an area analyzer wrote for the files the scripts did
 * not recognise (openspec: changes/route-entry-points, design D10). The
 * analyzer is a model, so nothing it writes is taken on trust: an entry is
 * accepted only when
 *   - it names one of the area's `unrecognisedFiles`;
 *   - its `line` is inside that file as it is on disk;
 *   - its `quote`, trimmed, is non-empty, at most MAX_QUOTE_CHARS long and a
 *     substring of that line;
 *   - its optional `skipReason` (why the entry point starts no business flow)
 *     is a string.
 * An accepted entry keeps `skipReason`, trimmed, when it is not blank, and
 * counts as skipped; a blank one is dropped and counted in skipWithoutReason.
 * A rejected entry's reason has no effect.
 * Everything else is counted under a named reason and never reaches the merged
 * graph. Pure over `readLines`, so a test can supply the file text.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { relativeInsideRoot } from './split-domain-areas.mjs';

export const MAX_QUOTE_CHARS = 200;
export const MODEL_ENTRY_REJECTIONS = Object.freeze(['file-not-unrecognised', 'line-out-of-range', 'quote-mismatch', 'malformed']);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const optionalText = (value) => value === undefined || value === null || typeof value === 'string';

/** The lines of a project file, or null when it cannot be read or escapes the root. */
export function readProjectLines(projectRoot, file) {
  const rel = relativeInsideRoot(file);
  if (rel === null) return null;
  let text;
  try {
    text = readFileSync(join(projectRoot, rel), 'utf-8');
  } catch {
    return null;
  }
  const lines = text.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * @param {{ entries: unknown, unrecognisedFiles: Iterable<string>, readLines: (file: string) => string[] | null }} input
 * @returns {{ accepted: object[], rejected: Record<string, number>, skipWithoutReason: number }}
 *   accepted entries are { file, line, method, path, quote, source: 'model', skipReason? }
 */
export function checkModelEntryPoints({ entries, unrecognisedFiles, readLines }) {
  const rejected = Object.fromEntries(MODEL_ENTRY_REJECTIONS.map((reason) => [reason, 0]));
  const accepted = [];
  let skipWithoutReason = 0;
  if (entries === undefined) return { accepted, rejected, skipWithoutReason };
  if (!Array.isArray(entries)) {
    rejected.malformed += 1;
    return { accepted, rejected, skipWithoutReason };
  }
  const allowed = new Set(unrecognisedFiles);
  for (const entry of entries) {
    if (!isObject(entry) || typeof entry.file !== 'string' || !Number.isInteger(entry.line)
      || typeof entry.quote !== 'string' || !optionalText(entry.method) || !optionalText(entry.path)
      || (entry.skipReason !== undefined && typeof entry.skipReason !== 'string')) {
      rejected.malformed += 1;
      continue;
    }
    const file = relativeInsideRoot(entry.file);
    if (file === null || !allowed.has(file)) { rejected['file-not-unrecognised'] += 1; continue; }
    const lines = readLines(file);
    if (lines === null || entry.line < 1 || entry.line > lines.length) { rejected['line-out-of-range'] += 1; continue; }
    const quote = entry.quote.trim();
    if (quote.length === 0 || quote.length > MAX_QUOTE_CHARS || !lines[entry.line - 1].includes(quote)) {
      rejected['quote-mismatch'] += 1;
      continue;
    }
    const record = { file, line: entry.line, method: entry.method ?? null, path: entry.path ?? null, quote, source: 'model' };
    const skipReason = typeof entry.skipReason === 'string' ? entry.skipReason.trim() : null;
    if (skipReason) record.skipReason = skipReason;
    else if (skipReason !== null) skipWithoutReason += 1;
    accepted.push(record);
  }
  return { accepted, rejected, skipWithoutReason };
}

export default { checkModelEntryPoints, readProjectLines, MAX_QUOTE_CHARS, MODEL_ENTRY_REJECTIONS };
