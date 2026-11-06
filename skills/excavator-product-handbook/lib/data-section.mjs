/**
 * The data section as the outputs read it (openspec change
 * handbook-data-tables, design D5): `<out>/data.json`, checked with the shape
 * check the `data` command writes it under. Only the technical view shows it.
 * The page gets the part of it the data page draws, not the ledgers.
 */

import { join } from 'node:path';

import { checkDataShape } from './data-shape.mjs';
import { readJson } from './json-file.mjs';

export const DATA_FILE = 'data.json';

/** `{ state: 'ok', data }`, `{ state: 'missing' }` or `{ state: 'malformed' }` (not JSON, or a shape the check refuses). */
export function loadDataSection(outDir) {
  const read = readJson(join(outDir, DATA_FILE));
  if (read.missing) return { state: 'missing' };
  if (!read.ok || checkDataShape(read.value).length > 0) return { state: 'malformed' };
  return { state: 'ok', data: read.value };
}

/** The ui key of a recognized-form key: `go-table-name` is `md.data.form.goTableName`. */
export const formKey = (form) => `md.data.form.${form.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())}`;

/** The part of a checked data object the page shows: the lists and the counts, without the ledgers, the changes or the scan counts. */
export function pageSection(data) {
  return {
    recognized: data.recognized,
    applications: data.applications,
    tables: data.tables.map((table) => ({ name: table.name, sources: table.sources, createdBy: table.createdBy, lastChangedBy: table.lastChangedBy, mentions: table.mentions })),
    dropped: data.dropped,
    changedNeverCreated: data.changedNeverCreated,
    declaredOnly: data.declaredOnly,
    removedButDeclared: data.removedButDeclared,
    onlyInMigrations: data.onlyInMigrations,
    gaps: data.gaps,
    counts: data.counts,
  };
}
