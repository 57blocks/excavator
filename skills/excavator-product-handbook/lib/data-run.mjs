/**
 * `handbook.mjs data <projectRoot> <out>` (openspec change handbook-data-tables,
 * design D1 and D5): extract the data section's facts, check their shape, write
 * `<out>/data.json` and return the one line the run reports. Written on every
 * call: the extraction is deterministic and costs one scan.
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { extractData } from './data-extract.mjs';
import { checkDataShape } from './data-shape.mjs';
import { writeJson } from './json-file.mjs';

/** The report line, computed from the counts. */
export function dataLine(counts) {
  const gaps = `${counts.gaps} gaps (${counts.operations.unnamed} unnamed operations, ${counts.migrationsUnsplit} unsplit migrations, ${counts.declarations.unresolved} unresolved model names)`;
  return `Data: ${counts.tables} tables; ${counts.migrations} migrations (${counts.migrationsReplayed} replayed, ${counts.migrationsUnsplit} not split, ${counts.migrationsDownOnly} down only); ${counts.dropped} dropped; ${counts.onlyInMigrations} names only in migrations; ${counts.declaredOnly} declared only; ${counts.removedButDeclared} removed but still declared; ${counts.changedNeverCreated} changed but never created; ${gaps}.`;
}

/** Write `<out>/data.json`; returns `{ status, lines }`. A shape problem is a bug in the extraction: exit 1 and every problem printed. */
export function runData(projectRoot, out) {
  const data = extractData(projectRoot);
  const problems = checkDataShape(data);
  if (problems.length > 0) return { status: 1, lines: ['data.json was not written: the extraction produced a value that fails its own shape check', ...problems] };
  mkdirSync(out, { recursive: true });
  writeJson(join(out, 'data.json'), data);
  return { status: 0, lines: [dataLine(data.counts)] };
}
