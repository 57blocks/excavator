// O1 of openspec change handbook-data-tables: conservation. Every migration
// file, every recognized operation and every model table-name declaration of
// the fixture lands in exactly one named bucket; the totals are checked
// against counts made here from the fixture files, not from the extraction.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { extractData } from '../../../skills/excavator-product-handbook/lib/data-extract.mjs';
import { repoRoot } from './helpers.mjs';

const FIXTURE = join(repoRoot, 'tests/fixtures/product-handbook/data-project');
const data = extractData(FIXTURE);

function filesUnder(dir, prefix = '') {
  return readdirSync(dir).sort().flatMap((name) => {
    const abs = join(dir, name);
    const rel = prefix === '' ? name : `${prefix}/${name}`;
    return statSync(abs).isDirectory() ? filesUnder(abs, rel) : [rel];
  });
}
const allFiles = filesUnder(FIXTURE);

describe('migration files', () => {
  const inMigrationDir = allFiles.filter((file) => file.startsWith('node-app/migrations/'));

  it('each file of the migration directory is in exactly one of: a migration bucket, the other bucket', () => {
    const migrationFiles = data.migrations.map((entry) => entry.file);
    const otherFiles = data.gaps.otherMigrationFiles.map((entry) => entry.file);
    expect(new Set([...migrationFiles, ...otherFiles]).size).toBe(migrationFiles.length + otherFiles.length);
    expect([...migrationFiles, ...otherFiles].sort()).toEqual(inMigrationDir);
    expect(inMigrationDir).toHaveLength(32);
  });

  it('every migration has a bucket, and the bucket counts add up to the migrations', () => {
    const buckets = ['replayed', 'unsplit', 'down-only'];
    for (const entry of data.migrations) expect(buckets).toContain(entry.bucket);
    const sum = data.counts.migrationsReplayed + data.counts.migrationsUnsplit + data.counts.migrationsDownOnly;
    expect(sum).toBe(data.migrations.length);
    expect(data.counts.migrations).toBe(30);
    expect(data.gaps.unsplitMigrations.map((e) => e.file)).toEqual(data.migrations.filter((e) => e.bucket === 'unsplit').map((e) => e.file));
  });

  it('the per-application migration counts add up to the migrations', () => {
    expect(data.applications.reduce((sum, a) => sum + a.migrations, 0)).toBe(data.migrations.length);
  });
});

describe('operations', () => {
  it('every operation is in exactly one bucket, and the buckets add up to the total counted by hand', () => {
    const buckets = ['create', 'drop', 'rename', 'change', 'unnamed'];
    for (const op of data.operations) expect(buckets).toContain(op.bucket);
    const keys = data.operations.map((o) => `${o.file}:${o.line}:${o.op}:${o.table}`);
    expect(new Set(keys).size).toBe(keys.length);
    const { total, create, drop, rename, change, unnamed } = data.counts.operations;
    expect(create + drop + rename + change + unnamed).toBe(total);
    expect(total).toBe(data.operations.length);
    expect(total).toBe(56);
  });

  it('the unnamed bucket is exactly the unnamed rows of the ledger', () => {
    const fromLedger = data.operations.filter((o) => o.bucket === 'unnamed').map((o) => `${o.file}:${o.line}:${o.op}`);
    const fromGaps = data.gaps.unnamedOperations.map((o) => `${o.file}:${o.line}:${o.op}`);
    expect(fromGaps).toEqual(fromLedger);
  });

  it('the number of operations is the number of recognized call sites and statements found by reading the up parts', () => {
    // Counted by hand from the fixture: one per call, one per SQL statement or name in a statement list.
    const handCount = { '001': 1, '002': 2, '003': 1, '004': 1, '005': 1, '006': 1, '007': 1, '008': 4, '009': 14, '010': 4, '011': 1, '014': 1, '015': 1, '016': 1, '017': 2, '018': 1, '019': 1, '020': 1, '021': 1, '022': 1, '023': 7, '024': 1, '025': 1, '026': 1, '027': 1, '028': 2, '029': 2 };
    const perFile = {};
    for (const op of data.operations) {
      const key = op.file.split('/').at(-1).slice(0, 3);
      perFile[key] = (perFile[key] ?? 0) + 1;
    }
    expect(perFile).toEqual(handCount);
  });
});

describe('model declarations', () => {
  const read = (rel) => readFileSync(join(FIXTURE, rel), 'utf-8');

  it('each declaration found by reading the fixture is in exactly one bucket', () => {
    const outside = allFiles.filter((file) => !file.includes('/migrations/'));
    let expected = 0;
    for (const file of outside) {
      const lines = read(file).split('\n');
      for (const line of lines) {
        if (/^\s*\/\//.test(line)) continue;
        if (file.endsWith('.go') && /\)\s*TableName\(\)\s*string/.test(line)) expected += 1;
        if (file.endsWith('.js') && /\btableName\s*:/.test(line)) expected += 1;
        if (file.endsWith('.sql') && /^\s*CREATE TABLE/i.test(line)) expected += 1;
      }
    }
    expect(expected).toBe(16);
    expect(data.declarations).toHaveLength(expected);
    const resolved = data.declarations.filter((d) => d.bucket === 'resolved');
    const unresolved = data.declarations.filter((d) => d.bucket === 'unresolved');
    expect(resolved.length + unresolved.length).toBe(expected);
    expect(resolved.every((d) => typeof d.table === 'string')).toBe(true);
    expect(unresolved.every((d) => d.table === null)).toBe(true);
    expect(unresolved.map((d) => `${d.file}:${d.line}`)).toEqual(data.gaps.unresolvedModelNames.map((g) => `${g.file}:${g.line}`));
    expect(data.counts.declarations).toEqual({ total: 16, model: 8, sql: 3, unresolved: 5 });
  });

  it('every resolved declaration is a source of its table', () => {
    for (const d of data.declarations.filter((x) => x.bucket === 'resolved')) {
      const entry = data.tables.find((t) => t.name === d.table);
      expect(entry.sources).toContainEqual({ kind: d.kind, file: d.file, line: d.line });
    }
  });
});

describe('the table lists', () => {
  it('each table name is in the list once, and each derived list names only listed tables', () => {
    const names = data.tables.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const list of [data.changedNeverCreated, data.declaredOnly, data.onlyInMigrations]) for (const name of list) expect(names).toContain(name);
  });
});
