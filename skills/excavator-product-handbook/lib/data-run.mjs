/**
 * `handbook.mjs data <projectRoot> <out>` (openspec changes
 * handbook-data-tables, design D1 and D5, and handbook-status-dictionary,
 * design D1): extract the data section's facts and the status dictionary,
 * check the shape of both, write `<out>/data.json` and then
 * `<out>/dictionaries.json`, and return the two lines the run reports. Written
 * on every call: the extraction is deterministic and costs one scan of each.
 * Nothing is written unless both pass their shape check.
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { extractData } from './data-extract.mjs';
import { checkDataShape } from './data-shape.mjs';
import { extractDictionaries } from './dict-extract.mjs';
import { dictionariesLine } from './dict-run.mjs';
import { checkDictionariesShape } from './dict-shape.mjs';
import { writeJson } from './json-file.mjs';

/** The report line, computed from the counts. */
export function dataLine(counts) {
  const gaps = `${counts.gaps} gaps (${counts.operations.unnamed} unnamed operations, ${counts.migrationsUnsplit} unsplit migrations, ${counts.declarations.unresolved} unresolved model names)`;
  return `Data: ${counts.tables} tables; ${counts.migrations} migrations (${counts.migrationsReplayed} replayed, ${counts.migrationsUnsplit} not split, ${counts.migrationsDownOnly} down only); ${counts.dropped} dropped; ${counts.onlyInMigrations} names only in migrations; ${counts.declaredOnly} declared only; ${counts.removedButDeclared} removed but still declared; ${counts.changedNeverCreated} changed but never created; ${gaps}.`;
}

/** Write `<out>/data.json` and `<out>/dictionaries.json`; returns `{ status, lines }`. A shape problem is a bug in the extraction: exit 1, nothing written, every problem printed. */
export function runData(projectRoot, out) {
  const data = extractData(projectRoot);
  const problems = checkDataShape(data);
  if (problems.length > 0) return { status: 1, lines: ['data.json was not written: the extraction produced a value that fails its own shape check', ...problems] };
  const dictionaries = extractDictionaries(projectRoot);
  const dictionaryProblems = checkDictionariesShape(dictionaries);
  if (dictionaryProblems.length > 0) return { status: 1, lines: ['dictionaries.json was not written: the extraction produced a value that fails its own shape check', ...dictionaryProblems] };
  mkdirSync(out, { recursive: true });
  writeJson(join(out, 'data.json'), data);
  writeJson(join(out, 'dictionaries.json'), dictionaries);
  return { status: 0, lines: [dataLine(data.counts), dictionariesLine(dictionaries.counts)] };
}
