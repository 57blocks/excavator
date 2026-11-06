/**
 * Migrations (openspec change handbook-data-tables, design D2): which files of
 * a migration directory are migrations, where the `up` part of a script
 * migration is, which operations it holds, and what tables the files leave
 * when they are replayed in file name order. Only the `up` part counts; the
 * `down` part is never read for operations. Every file and every operation
 * lands in a named bucket (the caller records them in data.json).
 */

import { lineIndex, tokenizeJs } from './data-js-tokens.mjs';
import { neutralizeEscapes, sqlOperations, stripSqlComments } from './data-sql-ops.mjs';

export const SCRIPT_EXTENSIONS = Object.freeze(['js', 'cjs', 'mjs', 'ts']);

/** A line that starts the `up` (or `down`) part: a method or property, `[module.]exports.<name> =`, or an exported function or const. */
const partLine = (name) => new RegExp(`^[ \\t]*(?:(?:async[ \\t]+)?${name}[ \\t]*[:(]|(?:module\\.)?exports\\.${name}[ \\t]*=|export[ \\t]+(?:async[ \\t]+)?function[ \\t]+${name}\\b|export[ \\t]+const[ \\t]+${name}[ \\t]*=)`);
const UP_LINE = partLine('up');
const DOWN_LINE = partLine('down');

/** Method names of the migration API whose first argument is a table name, and the operation each is. */
const CALLS = Object.freeze({
  createTable: 'create-table', dropTable: 'drop-table', renameTable: 'rename-table', addColumn: 'add-column', removeColumn: 'remove-column',
  changeColumn: 'change-column', renameColumn: 'rename-column', addIndex: 'add-index', removeIndex: 'remove-index', addConstraint: 'add-constraint',
  removeConstraint: 'remove-constraint', bulkInsert: 'bulk-insert', bulkUpdate: 'bulk-update', bulkDelete: 'bulk-delete',
});
const CALL = new RegExp(`\\.\\s*(${Object.keys(CALLS).join('|')})\\s*\\(`, 'g');

/** The bucket (create, drop, rename or change) an operation name belongs to. */
export function bucketOf(op) {
  if (op === 'create-table') return 'create';
  if (op === 'drop-table') return 'drop';
  if (op === 'rename-table') return 'rename';
  return 'change';
}

/** `{ start, end }` of the `up` part of a script migration, or `{ reason }` when it cannot be told from the `down` part. */
export function splitUp(text) {
  const ups = [];
  const downs = [];
  let offset = 0;
  for (const line of text.split('\n')) {
    if (UP_LINE.test(line)) ups.push(offset);
    else if (DOWN_LINE.test(line)) downs.push(offset);
    offset += line.length + 1;
  }
  if (ups.length === 0) return { reason: 'no up' };
  if (ups.length > 1) return { reason: 'more than one up' };
  const start = ups[0];
  const down = downs.find((at) => at > start);
  return { start, end: down ?? text.length };
}

/** The string literal that starts at the first non-space of `code` at or after `from`, and the index after it; null when what is there is not a plain literal. */
function literalAt(code, strings, from) {
  let i = from;
  while (i < code.length && /\s/.test(code[i])) i += 1;
  const token = strings.get(i);
  if (token === undefined || token.interpolated) return null;
  let j = token.end + 1;
  while (j < code.length && /\s/.test(code[j])) j += 1;
  if (code[j] !== ',' && code[j] !== ')') return null;
  return { value: token.raw, after: j, at: i };
}

/**
 * The operations of one script migration's `up` part, in position order:
 * `{ index, op, via, name, from? }` with `name` null when the table name is not
 * a literal. `index` is a character offset in `text`: where the table name
 * literal starts (the first one for `renameTable`), so a call split over lines
 * is cited at the line that shows the name; the method name when there is no
 * literal. `up` is `{ start, end }`.
 */
export function scriptOperations(text, up) {
  const { code, strings } = tokenizeJs(text);
  const found = [];
  CALL.lastIndex = up.start;
  let call;
  while ((call = CALL.exec(code)) !== null && call.index < up.end) {
    const op = CALLS[call[1]];
    const first = literalAt(code, strings, CALL.lastIndex);
    let name = first === null ? null : first.value;
    let from;
    if (op === 'rename-table') {
      const second = first === null || code[first.after] !== ',' ? null : literalAt(code, strings, first.after + 1);
      if (second === null) name = null;
      else {
        from = first.value;
        name = second.value;
      }
    }
    const at = name === null ? call.index + call[0].indexOf(call[1]) : first.at;
    found.push({ index: at, op, via: 'call', name, ...(from === undefined ? {} : { from }) });
  }
  for (const [start, token] of strings) {
    if (start < up.start || start >= up.end) continue;
    for (const statement of sqlOperations(neutralizeEscapes(token.raw))) {
      const { at, name, from, op } = statement;
      found.push({ index: start + 1 + at, op, via: 'sql', name, ...(from === undefined ? {} : { from }) });
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

/** The operations of a `.sql` migration: the whole file, comments left out. */
export function sqlFileOperations(text) {
  return sqlOperations(stripSqlComments(text)).map((statement) => ({ index: statement.at, op: statement.op, via: 'sql', name: statement.name, ...(statement.from === undefined ? {} : { from: statement.from }) }));
}

/** Read one migration file: `{ bucket, ops }` with `ops` carrying `line`. `form` is `script` or `sql`; a `.down.sql` file is a down-only file. */
export function readMigration(file, form, text) {
  const lineAt = lineIndex(text);
  if (form === 'sql') {
    if (/\.down\.sql$/i.test(file)) return { bucket: 'down-only', ops: [] };
    return { bucket: 'replayed', ops: sqlFileOperations(text).map((op) => ({ ...op, line: lineAt(op.index) })) };
  }
  const up = splitUp(text);
  if (up.reason !== undefined) return { bucket: 'unsplit', ops: [], reason: up.reason };
  return { bucket: 'replayed', ops: scriptOperations(text, up).map((op) => ({ ...op, line: lineAt(op.index) })) };
}

/** Turn the `named` of each place of a table's history into `as` (kept only when it is not the table's final name). */
function finalizeNames(name, entry) {
  for (const place of [entry.createdBy, ...entry.changes]) {
    if (place === null) continue;
    if (place.named !== name) place.as = place.named;
    delete place.named;
  }
}

/**
 * Replay the migrations of one directory in the order given (already sorted
 * by file name). `migrations` are `{ file, ops }`. Returns
 * `{ tables, dropped, operations }`: `tables` maps each table that exists at the
 * end to `{ createdBy: { file, line, as? } | null, changes }`; `dropped` lists the
 * drops of tables nothing created again; `operations` is the ledger, one row
 * for each operation with its bucket. Each `dropped` entry also carries the
 * `history` (`{ createdBy, changes }`, the drop included) of the table it
 * dropped, for the caller that finds the table still declared. A change or a create that cites the table
 * under another name (the table was renamed later) has `as`, the name its line
 * shows; a rename cites the old name, so it has `as` too.
 */
export function replay(migrations) {
  const tables = new Map();
  const dropped = [];
  const operations = [];
  const touch = (name) => {
    let entry = tables.get(name);
    if (entry === undefined) {
      entry = { createdBy: null, changes: [] };
      tables.set(name, entry);
    }
    return entry;
  };
  for (const { file, ops } of migrations) {
    for (const op of ops) {
      const { line, via } = op;
      // `named` is the name this line shows; replay turns it into `as` once the final name is known.
      const change = (extra = {}, named = op.name) => ({ file, line, op: op.op, via, ...extra, named });
      const row = { file, line, op: op.op, via, table: op.name, bucket: op.name === null ? 'unnamed' : bucketOf(op.op) };
      if (op.from !== undefined) row.from = op.from;
      operations.push(row);
      if (op.name === null) continue;
      if (op.op === 'create-table') {
        const existing = tables.get(op.name);
        if (existing !== undefined && existing.createdBy !== null) {
          existing.changes.push(change());
        } else {
          const index = dropped.findIndex((entry) => entry.name === op.name);
          if (index >= 0) dropped.splice(index, 1);
          tables.set(op.name, { createdBy: { file, line, named: op.name }, changes: [change()] });
        }
      } else if (op.op === 'drop-table') {
        const existing = tables.get(op.name);
        tables.delete(op.name);
        const history = existing ?? { createdBy: null, changes: [] };
        history.changes.push(change());
        finalizeNames(op.name, history);
        dropped.push({ name: op.name, file, line, createdBy: existing?.createdBy?.file ?? null, history });
      } else if (op.op === 'rename-table') {
        const old = tables.get(op.from);
        tables.delete(op.from);
        const revived = dropped.findIndex((entry) => entry.name === op.name);
        if (revived >= 0) dropped.splice(revived, 1);
        const entry = old ?? { createdBy: null, changes: [] };
        entry.changes.push(change({ from: op.from }, op.from));
        tables.set(op.name, entry);
      } else {
        touch(op.name).changes.push(change());
      }
    }
  }
  for (const [name, entry] of tables) finalizeNames(name, entry);
  return { tables, dropped, operations };
}
