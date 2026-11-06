// O1 of openspec change handbook-data-tables: the data extraction on a
// purpose-built project with two applications. Every expectation below is
// written by hand from the fixture files, never produced by the code.
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';

import { extractData } from '../../../skills/excavator-product-handbook/lib/data-extract.mjs';
import { repoRoot } from './helpers.mjs';

const FIXTURE = join(repoRoot, 'tests/fixtures/product-handbook/data-project');
const MIG = 'node-app/migrations/';
const m = (name) => `${MIG}${name}`;

const data = extractData(FIXTURE);
const table = (name) => data.tables.find((entry) => entry.name === name);
const names = (list) => list.map((entry) => (typeof entry === 'string' ? entry : entry.name));

describe('the table list', () => {
  it('holds the tables the up parts leave, plus the declared ones, sorted by name', () => {
    expect(names(data.tables)).toEqual([
      'accounts', 'audit_log', 'cache_entries', 'esm_const_t', 'esm_fn_t', 'exports_up_t', 'ghost_table', 'go_orders',
      'invoices', 'ledger_entries', 'model_only_events', 'module_up_t', 'orders', 'reports', 'sql_migrated', 'sql_other',
      'staging_q', 'staging_y', 'tags', 'ts_events', 'users',
    ]);
  });

  it('keeps a table whose down part drops it, with the file that creates it', () => {
    const users = table('users');
    expect(users.createdBy).toBe(m('001-create-users.js'));
    expect(names(data.dropped)).not.toContain('users');
    expect(names(data.dropped)).not.toContain('orders');
  });

  it('records the create, the changes in file order and the last change of a table', () => {
    const users = table('users');
    expect(users.changes).toEqual([
      { file: m('001-create-users.js'), line: 5, op: 'create-table', via: 'call' },
      { file: m('003-add-users-email.js'), line: 5, op: 'add-column', via: 'call' },
      { file: m('009-raw-sql.js'), line: 8, op: 'create-index', via: 'sql' },
      { file: m('009-raw-sql.js'), line: 9, op: 'insert', via: 'sql' },
      { file: m('009-raw-sql.js'), line: 11, op: 'delete', via: 'sql' },
      { file: m('009-raw-sql.js'), line: 12, op: 'truncate', via: 'sql' },
    ]);
    expect(users.lastChangedBy).toBe(m('009-raw-sql.js'));
    expect(users.sources).toEqual([
      { kind: 'migration', file: m('001-create-users.js'), line: 5 },
      { kind: 'model', file: 'node-app/models/user.js', line: 5 },
    ]);
  });

  it('reads a createTable whose name is on the next line, and ignores a call inside a comment', () => {
    const orders = table('orders');
    expect(orders.sources).toEqual([{ kind: 'migration', file: m('002-create-orders.js'), line: 6 }]);
    expect(orders.changes.map((c) => [c.file, c.line, c.op])).toEqual([
      [m('002-create-orders.js'), 6, 'create-table'],
      [m('002-create-orders.js'), 12, 'add-index'],
      [m('009-raw-sql.js'), 10, 'update'],
    ]);
  });

  it('follows a rename by call: the new name has the history, the old name is gone', () => {
    expect(names(data.tables)).not.toContain('old_invoices');
    const invoices = table('invoices');
    expect(invoices.createdBy).toBe(m('006-old-invoices.js'));
    expect(invoices.lastChangedBy).toBe(m('007-rename-invoices.js'));
    expect(invoices.changes).toEqual([
      { file: m('006-old-invoices.js'), line: 5, op: 'create-table', via: 'call' },
      { file: m('007-rename-invoices.js'), line: 5, op: 'rename-table', via: 'call', from: 'old_invoices' },
    ]);
  });

  it('follows a rename by SQL: ALTER TABLE ... RENAME TO and RENAME TABLE with several pairs', () => {
    expect(names(data.tables)).not.toContain('audit_entries');
    expect(names(data.tables)).not.toContain('staging_x');
    expect(names(data.tables)).not.toContain('staging_p');
    expect(table('audit_log').changes).toEqual([
      { file: m('009-raw-sql.js'), line: 5, op: 'create-table', via: 'sql' },
      { file: m('009-raw-sql.js'), line: 6, op: 'alter-table', via: 'sql' },
      { file: m('009-raw-sql.js'), line: 7, op: 'rename-table', via: 'sql', from: 'audit_entries' },
    ]);
    expect(table('staging_y').changes.at(-1)).toEqual({ file: m('010-raw-rename.js'), line: 7, op: 'rename-table', via: 'sql', from: 'staging_x' });
    expect(table('staging_q').changes.at(-1)).toEqual({ file: m('010-raw-rename.js'), line: 7, op: 'rename-table', via: 'sql', from: 'staging_p' });
  });

  it('takes the last segment of a qualified, quoted name and reads a template literal over several lines', () => {
    expect(table('reports').sources).toEqual([{ kind: 'migration', file: m('009-raw-sql.js'), line: 14 }]);
    expect(table('sql_other').sources).toEqual([{ kind: 'migration', file: m('017-extra.sql'), line: 4 }]);
  });

  it('reads a .sql migration as one up part, skipping its comments, and does not replay a .down.sql file', () => {
    expect(table('sql_migrated').sources).toEqual([{ kind: 'migration', file: m('017-extra.sql'), line: 3 }]);
    expect(names(data.tables)).not.toContain('commented_out');
    expect(names(data.dropped)).not.toContain('sql_migrated');
  });

  it('reads a TypeScript migration', () => {
    expect(table('ts_events').sources).toEqual([{ kind: 'migration', file: m('018-ts-events.ts'), line: 3 }]);
  });

  it('puts a table created again after a drop back, with the new create', () => {
    const cache = table('cache_entries');
    expect(cache.createdBy).toBe(m('016-recreate-cache.js'));
    expect(cache.changes).toEqual([{ file: m('016-recreate-cache.js'), line: 5, op: 'create-table', via: 'call' }]);
    expect(names(data.dropped)).not.toContain('cache_entries');
  });

  it('keeps a table that a migration changes but no migration creates, and says so', () => {
    const ghost = table('ghost_table');
    expect(ghost.createdBy).toBeNull();
    expect(ghost.sources).toEqual([]);
    expect(ghost.changes).toEqual([{ file: m('011-ghost.js'), line: 5, op: 'add-column', via: 'call' }]);
    expect(ghost.lastChangedBy).toBe(m('011-ghost.js'));
    expect(data.changedNeverCreated).toEqual(['ghost_table']);
  });
});

describe('the dropped tables', () => {
  it('lists the tables a migration drops and nothing recreates, each with the dropping migration', () => {
    expect(data.dropped).toEqual([
      { name: 'temp_logs', file: m('005-drop-temp-logs.js'), line: 5, createdBy: m('004-temp-logs.js'), directory: 'node-app/migrations' },
      { name: 'tmp_a', file: m('009-raw-sql.js'), line: 17, createdBy: m('009-raw-sql.js'), directory: 'node-app/migrations' },
      { name: 'tmp_b', file: m('009-raw-sql.js'), line: 17, createdBy: m('009-raw-sql.js'), directory: 'node-app/migrations' },
    ]);
    expect(names(data.tables)).not.toContain('temp_logs');
  });
});

describe('the declared tables', () => {
  it('resolves a literal, one constant and a qualified constant with String(), and takes the func line', () => {
    expect(table('go_orders').sources).toEqual([{ kind: 'model', file: 'go-app/models/order.go', line: 5 }]);
    expect(table('accounts').sources).toEqual([{ kind: 'model', file: 'go-app/models/account.go', line: 7 }]);
    expect(table('tags').sources).toEqual([{ kind: 'model', file: 'go-app/models/tag.go', line: 9 }]);
  });

  it('reads tableName from a JavaScript model and ignores one inside a comment', () => {
    expect(table('model_only_events').sources).toEqual([{ kind: 'model', file: 'node-app/models/event.js', line: 5 }]);
    expect(names(data.tables)).not.toContain('comment_only_table');
  });

  it('reads CREATE TABLE of a .sql file outside a migration directory', () => {
    expect(table('ledger_entries').sources).toEqual([{ kind: 'sql', file: 'node-app/db/schema.sql', line: 2 }]);
  });

  it('lists the tables declared and not created by any migration', () => {
    expect(data.declaredOnly).toEqual(['accounts', 'go_orders', 'ledger_entries', 'model_only_events', 'tags']);
  });

  it('puts a model name it cannot read to a literal in a bucket, with the position and why', () => {
    expect(data.gaps.unresolvedModelNames).toEqual([
      { file: 'go-app/models/dup.go', line: 7, expression: 'tableDup', matches: 2 },
      { file: 'go-app/models/format.go', line: 5, expression: 'fmt.Sprintf("fmt_%s", f.Suffix)', matches: null },
      { file: 'go-app/models/zero.go', line: 5, expression: 'pkg.MissingName', matches: 0 },
      { file: 'node-app/models/concat.js', line: 5, expression: "'part_' + suffix", matches: null },
      { file: 'node-app/models/dynamic.js', line: 5, expression: 'computeName()', matches: null },
    ]);
    for (const name of ['dup_one', 'dup_two', 'fmt_%s', 'part_']) expect(names(data.tables)).not.toContain(name);
  });
});

describe('the migrations', () => {
  it('counts the migrations of each application', () => {
    expect(data.applications).toEqual([
      { directory: 'go-app', migrations: 0 },
      { directory: 'node-app', migrations: 23 },
    ]);
  });

  it('puts a file without an up part and a file with two up parts in the unsplit bucket', () => {
    expect(data.gaps.unsplitMigrations).toEqual([{ file: m('012-no-up.js') }, { file: m('013-two-ups.js') }]);
    expect(names(data.tables)).not.toContain('not_replayed');
    expect(names(data.tables)).not.toContain('also_not_replayed');
    const bucket = (file) => data.migrations.find((entry) => entry.file === file).bucket;
    expect(bucket(m('012-no-up.js'))).toBe('unsplit');
    expect(bucket(m('013-two-ups.js'))).toBe('unsplit');
    expect(bucket(m('017-extra.down.sql'))).toBe('down-only');
    expect(bucket(m('017-extra.sql'))).toBe('replayed');
    expect(bucket(m('001-create-users.js'))).toBe('replayed');
  });

  it('finds the up part of a migration that exports up and down by name, and does not replay its down part', () => {
    const bucket = (file) => data.migrations.find((entry) => entry.file === file).bucket;
    for (const file of ['019-exports-up.js', '020-module-exports-up.js', '021-export-function.ts', '022-export-const.ts']) expect(bucket(m(file))).toBe('replayed');
    expect(table('exports_up_t').sources).toEqual([{ kind: 'migration', file: m('019-exports-up.js'), line: 4 }]);
    expect(table('module_up_t').sources).toEqual([{ kind: 'migration', file: m('020-module-exports-up.js'), line: 4 }]);
    expect(table('esm_fn_t').sources).toEqual([{ kind: 'migration', file: m('021-export-function.ts'), line: 4 }]);
    expect(table('esm_const_t').sources).toEqual([{ kind: 'migration', file: m('022-export-const.ts'), line: 4 }]);
    for (const name of ['exports_up_t', 'module_up_t', 'esm_fn_t', 'esm_const_t']) expect(names(data.dropped)).not.toContain(name);
  });

  it('counts the README and a file in a subdirectory of the migration directory in the other bucket', () => {
    expect(data.gaps.otherMigrationFiles).toEqual([
      { file: m('README.md'), reason: 'extension' },
      { file: m('seeds/seed.js'), reason: 'nested' },
    ]);
  });

  it('puts an operation whose table name is not a literal in the unnamed bucket, with file and line', () => {
    expect(data.gaps.unnamedOperations).toEqual([
      { file: m('008-computed-names.js'), line: 7, op: 'create-table', via: 'call' },
      { file: m('008-computed-names.js'), line: 8, op: 'add-index', via: 'call' },
      { file: m('008-computed-names.js'), line: 9, op: 'create-table', via: 'call' },
      { file: m('008-computed-names.js'), line: 10, op: 'create-table', via: 'call' },
      { file: m('009-raw-sql.js'), line: 19, op: 'drop-table', via: 'sql' },
    ]);
  });
});

describe('the operation ledger', () => {
  const tuples = data.operations.map((o) => [o.file.replace(MIG, ''), o.line, o.op, o.table, o.bucket]);
  it('has one row for each recognized operation, in file and position order, each in one bucket', () => {
    expect(tuples).toEqual([
      ['001-create-users.js', 5, 'create-table', 'users', 'create'],
      ['002-create-orders.js', 6, 'create-table', 'orders', 'create'],
      ['002-create-orders.js', 12, 'add-index', 'orders', 'change'],
      ['003-add-users-email.js', 5, 'add-column', 'users', 'change'],
      ['004-temp-logs.js', 5, 'create-table', 'temp_logs', 'create'],
      ['005-drop-temp-logs.js', 5, 'drop-table', 'temp_logs', 'drop'],
      ['006-old-invoices.js', 5, 'create-table', 'old_invoices', 'create'],
      ['007-rename-invoices.js', 5, 'rename-table', 'invoices', 'rename'],
      ['008-computed-names.js', 7, 'create-table', null, 'unnamed'],
      ['008-computed-names.js', 8, 'add-index', null, 'unnamed'],
      ['008-computed-names.js', 9, 'create-table', null, 'unnamed'],
      ['008-computed-names.js', 10, 'create-table', null, 'unnamed'],
      ['009-raw-sql.js', 5, 'create-table', 'audit_entries', 'create'],
      ['009-raw-sql.js', 6, 'alter-table', 'audit_entries', 'change'],
      ['009-raw-sql.js', 7, 'rename-table', 'audit_log', 'rename'],
      ['009-raw-sql.js', 8, 'create-index', 'users', 'change'],
      ['009-raw-sql.js', 9, 'insert', 'users', 'change'],
      ['009-raw-sql.js', 10, 'update', 'orders', 'change'],
      ['009-raw-sql.js', 11, 'delete', 'users', 'change'],
      ['009-raw-sql.js', 12, 'truncate', 'users', 'change'],
      ['009-raw-sql.js', 14, 'create-table', 'reports', 'create'],
      ['009-raw-sql.js', 15, 'create-table', 'tmp_a', 'create'],
      ['009-raw-sql.js', 16, 'create-table', 'tmp_b', 'create'],
      ['009-raw-sql.js', 17, 'drop-table', 'tmp_a', 'drop'],
      ['009-raw-sql.js', 17, 'drop-table', 'tmp_b', 'drop'],
      ['009-raw-sql.js', 19, 'drop-table', null, 'unnamed'],
      ['010-raw-rename.js', 5, 'create-table', 'staging_x', 'create'],
      ['010-raw-rename.js', 6, 'create-table', 'staging_p', 'create'],
      ['010-raw-rename.js', 7, 'rename-table', 'staging_y', 'rename'],
      ['010-raw-rename.js', 7, 'rename-table', 'staging_q', 'rename'],
      ['011-ghost.js', 5, 'add-column', 'ghost_table', 'change'],
      ['014-cache-entries.js', 5, 'create-table', 'cache_entries', 'create'],
      ['015-drop-cache.js', 5, 'drop-table', 'cache_entries', 'drop'],
      ['016-recreate-cache.js', 5, 'create-table', 'cache_entries', 'create'],
      ['017-extra.sql', 3, 'create-table', 'sql_migrated', 'create'],
      ['017-extra.sql', 4, 'create-table', 'sql_other', 'create'],
      ['018-ts-events.ts', 3, 'create-table', 'ts_events', 'create'],
      ['019-exports-up.js', 4, 'create-table', 'exports_up_t', 'create'],
      ['020-module-exports-up.js', 4, 'create-table', 'module_up_t', 'create'],
      ['021-export-function.ts', 4, 'create-table', 'esm_fn_t', 'create'],
      ['022-export-const.ts', 4, 'create-table', 'esm_const_t', 'create'],
    ]);
  });

  it('records where each renamed table came from', () => {
    const renames = data.operations.filter((o) => o.bucket === 'rename').map((o) => [o.table, o.from]);
    expect(renames).toEqual([['invoices', 'old_invoices'], ['audit_log', 'audit_entries'], ['staging_y', 'staging_x'], ['staging_q', 'staging_p']]);
  });
});

describe('where a table name appears outside the migrations', () => {
  const where = (name) => Object.fromEntries(Object.entries(table(name).mentions).map(([app, list]) => [app, list.map((x) => `${x.file}:${x.line}:${x.rule}`)]));

  it('records rule a (a string that is the whole name) and rule b (after FROM, JOIN, INTO, UPDATE or TABLE)', () => {
    expect(where('users')).toEqual({
      '': ['tools/report.py:3:b'],
      'node-app': ['node-app/models/user.js:5:a', 'node-app/src/orders-service.js:4:a', 'node-app/src/orders-service.js:7:b'],
    });
    expect(where('orders')).toEqual({
      '': ['tools/report.py:4:a'],
      'node-app': ['node-app/src/near.js:11:b', 'node-app/src/orders-service.js:3:b'],
    });
    expect(where('invoices')).toEqual({
      'go-app': ['go-app/store/invoices.go:4:b'],
      'node-app': ['node-app/src/orders-service.js:8:b'],
    });
  });

  it('does not match a name that is part of a longer identifier, another case or a keyword prefix', () => {
    const near = [];
    for (const t of data.tables) for (const list of Object.values(t.mentions)) for (const x of list) if (x.file === 'node-app/src/near.js') near.push(`${t.name}:${x.line}`);
    expect(near).toEqual(['orders:11']);
  });

  it('counts a model declaration and a constant declaration as an appearance', () => {
    expect(where('model_only_events')).toEqual({ 'node-app': ['node-app/models/event.js:5:a'] });
    expect(where('accounts')).toEqual({ 'go-app': ['go-app/models/account.go:3:a'] });
    expect(where('go_orders')).toEqual({ 'go-app': ['go-app/models/order.go:6:a'] });
    expect(where('tags')).toEqual({ 'go-app': ['go-app/models/tag.go:5:a'] });
    expect(where('ledger_entries')).toEqual({ 'node-app': ['node-app/db/schema.sql:2:b'] });
  });

  it('never counts a file of a migration directory, seeds included', () => {
    for (const t of data.tables) for (const list of Object.values(t.mentions)) for (const x of list) expect(x.file).not.toContain('/migrations/');
  });

  it('lists the tables whose name appears only in migrations', () => {
    expect(data.onlyInMigrations).toEqual(['audit_log', 'cache_entries', 'esm_const_t', 'esm_fn_t', 'exports_up_t', 'ghost_table', 'module_up_t', 'reports', 'sql_migrated', 'sql_other', 'staging_q', 'staging_y', 'ts_events']);
    for (const name of data.onlyInMigrations) expect(table(name).mentions).toEqual({});
  });
});

describe('the counts and the recognized forms', () => {
  it('are computed from the lists', () => {
    expect(data.counts).toEqual({
      tables: 21,
      migrations: 23,
      migrationsReplayed: 20,
      migrationsUnsplit: 2,
      migrationsDownOnly: 1,
      otherMigrationFiles: 2,
      operations: { total: 41, create: 19, drop: 4, rename: 4, change: 9, unnamed: 5 },
      declarations: { total: 11, model: 5, sql: 1, unresolved: 5 },
      dropped: 3,
      changedNeverCreated: 1,
      declaredOnly: 5,
      onlyInMigrations: 13,
      tablesInSeveralApplications: 1,
      gaps: 12,
    });
  });

  it('names the forms this version recognizes, by key', () => {
    expect(data.format).toBe('excavator-product-handbook-data/1');
    expect(data.recognized).toEqual(['migration-calls', 'migration-sql', 'go-table-name', 'js-table-name', 'sql-file-create-table']);
  });

  it('counts the files searched', () => {
    expect(data.scanned).toEqual({ filesSearched: 18, skippedBinary: 0, skippedTooLarge: 0, skippedUnreadable: 0, skippedSymlinks: 0 });
  });
});
