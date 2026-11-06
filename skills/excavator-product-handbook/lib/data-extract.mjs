/**
 * The data section's extraction (openspec change handbook-data-tables, design
 * D2 to D6): read the project's source statically, never build or run it, and
 * return the object `data.json` holds. Zero model calls; the same project
 * gives the same object, with no run time and no local path. Every migration
 * file, every recognized migration operation and every model table-name
 * declaration lands in exactly one named bucket.
 */

import { goStringDeclarations, goTableNames, jsTableNames, JS_EXTENSIONS, resolveGoExpression, sqlFileTables } from './data-models.mjs';
import { NO_APPLICATION, byteOrder, listProject, readText } from './data-files.mjs';
import { findMentions } from './data-mentions.mjs';
import { SCRIPT_EXTENSIONS, readMigration, replay } from './data-migrations.mjs';
import { DATA_FORMAT, RECOGNIZED, computeCounts } from './data-shape.mjs';

const extensionOf = (rel) => {
  const name = rel.slice(rel.lastIndexOf('/') + 1);
  return name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
};
const dirOf = (rel) => rel.slice(0, rel.lastIndexOf('/'));
const nameOf = (rel) => rel.slice(rel.lastIndexOf('/') + 1);
const byFileLine = (a, b) => byteOrder(a.file, b.file) || a.line - b.line;

/** Group the files of the migration directories: `{ directories, other }`; `directories` maps a directory to its direct-child migration candidates. */
function groupMigrationFiles(files) {
  const directories = new Map();
  const other = [];
  for (const file of files) {
    if (file.migration === null) continue;
    if (!file.migration.direct) {
      other.push({ file: file.rel, reason: 'nested' });
      continue;
    }
    const ext = extensionOf(file.rel);
    const form = SCRIPT_EXTENSIONS.includes(ext) ? 'script' : ext === 'sql' ? 'sql' : null;
    if (form === null) {
      other.push({ file: file.rel, reason: 'extension' });
      continue;
    }
    const list = directories.get(file.migration.directory) ?? [];
    list.push({ file, form });
    directories.set(file.migration.directory, list);
  }
  return { directories, other };
}

/** Read the migrations of every directory and replay them; returns the pieces `extractData` assembles. */
function readMigrations(files) {
  const { directories, other } = groupMigrationFiles(files);
  const migrations = [];
  const histories = [];
  const unsplit = [];
  for (const directory of [...directories.keys()].sort(byteOrder)) {
    const entries = directories.get(directory).sort((a, b) => byteOrder(nameOf(a.file.rel), nameOf(b.file.rel)));
    const replayable = [];
    for (const { file, form } of entries) {
      const read = readText({ abs: file.abs, size: 0 });
      if (read.skipped !== undefined) {
        other.push({ file: file.rel, reason: read.skipped });
        continue;
      }
      const result = readMigration(file.rel, form, read.text);
      migrations.push({ file: file.rel, application: file.application, form, bucket: result.bucket });
      if (result.bucket === 'unsplit') unsplit.push({ file: file.rel });
      if (result.bucket === 'replayed') replayable.push({ file: file.rel, ops: result.ops });
    }
    histories.push({ directory, ...replay(replayable) });
  }
  other.sort((a, b) => byteOrder(a.file, b.file));
  return { migrations, histories, unsplit, other };
}

/** Read the declared tables of the files outside the migration directories; returns declarations and what the pass skipped. */
function readDeclarations(files) {
  const skipped = { binary: 0, tooLarge: 0, unreadable: 0 };
  let searched = 0;
  const goDeclarations = new Map();
  const goFunctions = [];
  const declarations = [];
  const unresolved = [];
  for (const file of files) {
    if (file.migration !== null) continue;
    const read = readText(file);
    if (read.skipped !== undefined) {
      skipped[read.skipped] += 1;
      continue;
    }
    searched += 1;
    const ext = extensionOf(file.rel);
    if (ext === 'go') {
      const perApp = goDeclarations.get(file.application) ?? new Map();
      goDeclarations.set(file.application, perApp);
      for (const { ident, value } of goStringDeclarations(read.text)) perApp.set(ident, [...(perApp.get(ident) ?? []), value]);
      for (const found of goTableNames(read.text)) goFunctions.push({ file: file.rel, application: file.application, ...found });
    } else if (JS_EXTENSIONS.includes(ext)) {
      for (const found of jsTableNames(read.text)) {
        if (found.name !== null) declarations.push({ kind: 'model', file: file.rel, line: found.line, table: found.name, bucket: 'resolved' });
        else {
          declarations.push({ kind: 'model', file: file.rel, line: found.line, table: null, bucket: 'unresolved' });
          unresolved.push({ file: file.rel, line: found.line, expression: found.expression, matches: null });
        }
      }
    } else if (ext === 'sql') {
      for (const found of sqlFileTables(read.text)) declarations.push({ kind: 'sql', file: file.rel, line: found.line, table: found.name, bucket: 'resolved' });
    }
  }
  for (const fn of goFunctions) {
    const resolved = resolveGoExpression(fn.expression, goDeclarations.get(fn.application) ?? new Map());
    if (resolved.name !== null) declarations.push({ kind: 'model', file: fn.file, line: fn.line, table: resolved.name, bucket: 'resolved' });
    else {
      declarations.push({ kind: 'model', file: fn.file, line: fn.line, table: null, bucket: 'unresolved' });
      unresolved.push({ file: fn.file, line: fn.line, expression: fn.expression ?? '', matches: resolved.matches });
    }
  }
  declarations.sort(byFileLine);
  unresolved.sort(byFileLine);
  return { declarations, unresolved, skipped, searched };
}

/** The tables of every migration history and every resolved declaration, merged by name. */
function mergeTables(histories, declarations) {
  const byName = new Map();
  const ensure = (name) => {
    let table = byName.get(name);
    if (table === undefined) {
      table = { name, sources: [], createdBy: null, lastChangedBy: null, directories: [], changes: [], mentions: {} };
      byName.set(name, table);
    }
    return table;
  };
  const primary = new Map();
  for (const history of histories) {
    for (const [name, entry] of history.tables) {
      const table = ensure(name);
      table.directories.push(history.directory);
      if (entry.createdBy !== null) table.sources.push({ kind: 'migration', file: entry.createdBy.file, line: entry.createdBy.line, ...(entry.createdBy.as === undefined ? {} : { as: entry.createdBy.as }) });
      table.changes.push(...entry.changes);
      const first = primary.get(name);
      if (first === undefined || (first.createdBy === null && entry.createdBy !== null)) primary.set(name, entry);
    }
  }
  for (const [name, entry] of primary) {
    const table = byName.get(name);
    table.createdBy = entry.createdBy?.file ?? null;
    table.lastChangedBy = entry.changes.at(-1)?.file ?? null;
  }
  for (const declaration of declarations) {
    if (declaration.bucket === 'resolved') ensure(declaration.table).sources.push({ kind: declaration.kind, file: declaration.file, line: declaration.line });
  }
  for (const table of byName.values()) table.sources.sort((a, b) => byFileLine(a, b) || byteOrder(a.kind, b.kind));
  return [...byName.values()].sort((a, b) => byteOrder(a.name, b.name));
}

/** Add each table's mentions (design D4), grouped by application. */
function addMentions(files, tables) {
  const names = new Set(tables.map((table) => table.name));
  const byApplication = new Map();
  if (names.size > 0) {
    for (const file of files) {
      if (file.migration !== null) continue;
      const read = readText(file);
      if (read.skipped !== undefined) continue;
      let into = byApplication.get(file.application);
      if (into === undefined) {
        into = new Map();
        byApplication.set(file.application, into);
      }
      findMentions(file.rel, read.text, names, into);
    }
  }
  for (const table of tables) {
    for (const application of [...byApplication.keys()].sort(byteOrder)) {
      const rows = byApplication.get(application).get(table.name);
      if (rows !== undefined) table.mentions[application] = [...rows.values()].sort((a, b) => byFileLine(a, b) || byteOrder(a.rule, b.rule));
    }
  }
}

/** Extract the data section's facts from the project at `projectRootArg`. */
export function extractData(projectRootArg) {
  const project = listProject(projectRootArg);
  const { migrations, histories, unsplit, other } = readMigrations(project.files);
  const { declarations, unresolved, skipped, searched } = readDeclarations(project.files);
  const tables = mergeTables(histories, declarations);
  addMentions(project.files, tables);

  const applications = project.roots.map((directory) => ({ directory, migrations: migrations.filter((entry) => entry.application === directory).length }));
  const outside = migrations.filter((entry) => entry.application === NO_APPLICATION).length;
  if (outside > 0) applications.push({ directory: NO_APPLICATION, migrations: outside });

  const operations = histories.flatMap((history) => history.operations);
  const dropped = histories.flatMap((history) => history.dropped.map((entry) => ({ ...entry, directory: history.directory })));
  dropped.sort((a, b) => byteOrder(a.name, b.name) || byFileLine(a, b));

  const named = (list) => list.map((table) => table.name);
  const data = {
    format: DATA_FORMAT,
    recognized: [...RECOGNIZED],
    applications,
    migrations,
    operations,
    declarations,
    tables,
    dropped,
    changedNeverCreated: named(tables.filter((table) => table.createdBy === null && table.changes.length > 0)),
    declaredOnly: named(tables.filter((table) => table.createdBy === null && table.sources.some((source) => source.kind !== 'migration'))),
    onlyInMigrations: named(tables.filter((table) => table.changes.length > 0 && Object.keys(table.mentions).length === 0)),
    gaps: {
      unsplitMigrations: unsplit,
      unnamedOperations: operations.filter((row) => row.bucket === 'unnamed').map(({ file, line, op, via }) => ({ file, line, op, via })),
      unresolvedModelNames: unresolved,
      otherMigrationFiles: other,
    },
    scanned: { filesSearched: searched, skippedBinary: skipped.binary, skippedTooLarge: skipped.tooLarge, skippedUnreadable: skipped.unreadable, skippedSymlinks: project.symlinks },
  };
  data.counts = computeCounts(data);
  return data;
}
