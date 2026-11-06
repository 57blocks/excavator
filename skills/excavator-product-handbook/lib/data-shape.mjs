/**
 * The shape of `data.json` and its counts (openspec change handbook-data-tables,
 * design D5). The counts are computed from the lists, here and nowhere else:
 * the extraction writes them with `computeCounts`, and the check recomputes
 * them from the lists it reads, so a count that disagrees with its list is a
 * problem and a renderer can read `counts` without counting again.
 */

import { NO_APPLICATION } from './data-files.mjs';
import { isObject } from './json-file.mjs';

export const DATA_FORMAT = 'excavator-product-handbook-data/1';
/** The declaration forms this version recognizes; the page words each by its key. */
export const RECOGNIZED = Object.freeze(['migration-calls', 'migration-sql', 'go-table-name', 'js-table-name', 'sql-file-create-table']);

const OPERATION_BUCKETS = Object.freeze(['create', 'drop', 'rename', 'change', 'unnamed']);
const MIGRATION_BUCKETS = Object.freeze(['replayed', 'unsplit', 'down-only']);

/** The counts of a data object whose lists are well formed. */
export function computeCounts(data) {
  const operation = (bucket) => data.operations.filter((row) => row.bucket === bucket).length;
  const migration = (bucket) => data.migrations.filter((row) => row.bucket === bucket).length;
  const declaration = (test) => data.declarations.filter(test).length;
  const unsplit = data.gaps.unsplitMigrations.length;
  const unnamed = data.gaps.unnamedOperations.length;
  const unresolved = data.gaps.unresolvedModelNames.length;
  return {
    tables: data.tables.length,
    migrations: data.migrations.length,
    migrationsReplayed: migration('replayed'),
    migrationsUnsplit: migration('unsplit'),
    migrationsDownOnly: migration('down-only'),
    otherMigrationFiles: data.gaps.otherMigrationFiles.length,
    operations: {
      total: data.operations.length,
      create: operation('create'),
      drop: operation('drop'),
      rename: operation('rename'),
      change: operation('change'),
      unnamed: operation('unnamed'),
    },
    declarations: {
      total: data.declarations.length,
      model: declaration((row) => row.kind === 'model' && row.bucket === 'resolved'),
      sql: declaration((row) => row.kind === 'sql' && row.bucket === 'resolved'),
      unresolved: declaration((row) => row.bucket === 'unresolved'),
    },
    dropped: data.dropped.length,
    droppedButDeclared: data.droppedButDeclared.length,
    changedNeverCreated: data.changedNeverCreated.length,
    declaredOnly: data.declaredOnly.length,
    onlyInMigrations: data.onlyInMigrations.length,
    tablesInSeveralApplications: data.tables.filter((table) => Object.keys(table.mentions).filter((key) => key !== NO_APPLICATION).length >= 2).length,
    gaps: unsplit + unnamed + unresolved,
  };
}

const isString = (value) => typeof value === 'string' && value !== '';
const isLine = (value) => Number.isInteger(value) && value >= 1;
const isCount = (value) => Number.isInteger(value) && value >= 0;

/** Check an array of rows with a field test per key; problems name `path[i].key`. */
function rows(problems, value, path, fields) {
  if (!Array.isArray(value)) {
    problems.push(`${path} is not a list`);
    return false;
  }
  let ok = true;
  value.forEach((row, i) => {
    if (!isObject(row)) {
      problems.push(`${path}[${i}] is not an object`);
      ok = false;
      return;
    }
    for (const [key, test] of Object.entries(fields)) {
      if (!test(row[key], row)) {
        problems.push(`${path}[${i}].${key} is not valid`);
        ok = false;
      }
    }
  });
  return ok;
}

const oneOf = (list) => (value) => list.includes(value);
const nullOr = (test) => (value) => value === null || test(value);
const optional = (test) => (value) => value === undefined || test(value);

/** Problems of a `data.json` value, one line each; an empty list means the shape holds. */
export function checkDataShape(value) {
  if (!isObject(value)) return ['data.json is not a JSON object'];
  const problems = [];
  if (value.format !== DATA_FORMAT) problems.push(`format is ${JSON.stringify(value.format)}, expected ${DATA_FORMAT}`);
  if (!Array.isArray(value.recognized) || !value.recognized.every((key) => RECOGNIZED.includes(key))) problems.push('recognized is not a list of known form keys');

  const lists = {
    applications: rows(problems, value.applications, 'applications', { directory: (v) => typeof v === 'string', migrations: isCount }),
    migrations: rows(problems, value.migrations, 'migrations', { file: isString, application: (v) => typeof v === 'string', form: oneOf(['script', 'sql']), bucket: oneOf(MIGRATION_BUCKETS) }),
    operations: rows(problems, value.operations, 'operations', {
      file: isString, line: isLine, op: isString, via: oneOf(['call', 'sql']), table: nullOr(isString), bucket: oneOf(OPERATION_BUCKETS), from: optional(isString),
    }),
    declarations: rows(problems, value.declarations, 'declarations', { kind: oneOf(['model', 'sql']), file: isString, line: isLine, table: nullOr(isString), bucket: oneOf(['resolved', 'unresolved']) }),
    tables: rows(problems, value.tables, 'tables', {
      name: isString,
      sources: (v) => Array.isArray(v) && v.every((s) => isObject(s) && ['migration', 'model', 'sql'].includes(s.kind) && isString(s.file) && isLine(s.line) && optional(isString)(s.as)),
      createdBy: nullOr(isString),
      lastChangedBy: nullOr(isString),
      directories: (v) => Array.isArray(v) && v.every(isString),
      changes: (v) => Array.isArray(v) && v.every((c) => isObject(c) && isString(c.file) && isLine(c.line) && isString(c.op) && ['call', 'sql'].includes(c.via) && optional(isString)(c.from) && optional(isString)(c.as)),
      mentions: (v) => isObject(v) && Object.values(v).every((list) => Array.isArray(list) && list.every((m) => isObject(m) && isString(m.file) && isLine(m.line) && ['a', 'b', 'c'].includes(m.rule))),
    }),
    dropped: rows(problems, value.dropped, 'dropped', { name: isString, file: isString, line: isLine, createdBy: nullOr(isString), directory: isString }),
  };
  for (const key of ['changedNeverCreated', 'declaredOnly', 'droppedButDeclared', 'onlyInMigrations']) {
    if (!Array.isArray(value[key]) || !value[key].every(isString)) {
      problems.push(`${key} is not a list of table names`);
      lists[key] = false;
    }
  }
  let gapsOk = isObject(value.gaps);
  if (!gapsOk) problems.push('gaps is not an object');
  else {
    gapsOk = [
      rows(problems, value.gaps.unsplitMigrations, 'gaps.unsplitMigrations', { file: isString }),
      rows(problems, value.gaps.unnamedOperations, 'gaps.unnamedOperations', { file: isString, line: isLine, op: isString, via: oneOf(['call', 'sql']) }),
      rows(problems, value.gaps.unresolvedModelNames, 'gaps.unresolvedModelNames', { file: isString, line: isLine, expression: (v) => typeof v === 'string', matches: nullOr(isCount) }),
      rows(problems, value.gaps.otherMigrationFiles, 'gaps.otherMigrationFiles', { file: isString, reason: isString }),
    ].every(Boolean);
  }
  if (!isObject(value.scanned) || !['filesSearched', 'skippedBinary', 'skippedTooLarge', 'skippedUnreadable', 'skippedSymlinks'].every((key) => isCount(value.scanned[key]))) problems.push('scanned does not hold the file counts');
  if (!isObject(value.counts)) problems.push('counts is not an object');

  const wellFormed = problems.length === 0 && Object.values(lists).every(Boolean) && gapsOk;
  if (!wellFormed) return problems;

  const names = new Set();
  for (const table of value.tables) {
    if (names.has(table.name)) problems.push(`table ${table.name} is listed twice`);
    names.add(table.name);
  }
  for (const key of ['changedNeverCreated', 'declaredOnly', 'droppedButDeclared', 'onlyInMigrations']) {
    for (const name of value[key]) if (!names.has(name)) problems.push(`${key} names ${name}, which is not in tables`);
  }
  value.operations.forEach((row, i) => {
    if ((row.table === null) !== (row.bucket === 'unnamed')) problems.push(`operations[${i}].bucket does not match its table name`);
  });
  value.declarations.forEach((row, i) => {
    if ((row.table === null) !== (row.bucket === 'unresolved')) problems.push(`declarations[${i}].bucket does not match its table name`);
  });
  if (problems.length > 0) return problems;

  const computed = computeCounts(value);
  for (const [key, expected] of Object.entries(computed)) {
    if (JSON.stringify(value.counts[key]) !== JSON.stringify(expected)) problems.push(`counts.${key} is ${JSON.stringify(value.counts[key])}, the lists give ${JSON.stringify(expected)}`);
  }
  for (const key of Object.keys(value.counts)) if (!(key in computed)) problems.push(`counts.${key} is not a known count`);
  return problems;
}
