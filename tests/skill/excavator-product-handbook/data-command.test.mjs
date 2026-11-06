// O1 of openspec change handbook-data-tables: `handbook.mjs data <root> <out>`
// writes <out>/data.json and prints one count line; the shape check refuses a
// data.json that is not what the command writes; the extraction is one pass
// per file (a project of 300 tables and 500 files finishes quickly); an empty
// project and unreadable inputs end in visible buckets, not in silence.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { extractData } from '../../../skills/excavator-product-handbook/lib/data-extract.mjs';
import { checkDataShape } from '../../../skills/excavator-product-handbook/lib/data-shape.mjs';
import { FIXTURE_PROJECT, repoRoot, runHandbook } from './helpers.mjs';

const FIXTURE = join(repoRoot, 'tests/fixtures/product-handbook/data-project');
const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

function tempDir(prefix) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A throwaway project from `{ path: text }`; returns its real path. */
function project(files) {
  const root = tempDir('xhb-data-');
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const upFile = (body) => `module.exports = {\n  async up(qi) {\n${body}\n  },\n  async down() {},\n};\n`;

describe('handbook.mjs data', () => {
  it('writes data.json and prints exactly one count line', () => {
    const out = tempDir('xhb-out-');
    const result = runHandbook(['data', FIXTURE, out]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toBe('Data: 25 tables; 26 migrations (23 replayed, 2 not split, 1 down only); 6 dropped; 15 names only in migrations; 12 gaps (5 unnamed operations, 2 unsplit migrations, 5 unresolved model names).');
    const written = JSON.parse(readFileSync(join(out, 'data.json'), 'utf-8'));
    expect(written).toEqual(extractData(FIXTURE));
    expect(checkDataShape(written)).toEqual([]);
  });

  it('writes the same bytes from the same input, with no local path in it', () => {
    const a = tempDir('xhb-out-');
    const b = tempDir('xhb-out-');
    expect(runHandbook(['data', FIXTURE, a]).status).toBe(0);
    expect(runHandbook(['data', FIXTURE, b]).status).toBe(0);
    const text = readFileSync(join(a, 'data.json'), 'utf-8');
    expect(text).toBe(readFileSync(join(b, 'data.json'), 'utf-8'));
    expect(text).not.toContain(FIXTURE);
    expect(text).not.toContain(repoRoot);
    expect(text.endsWith('\n')).toBe(true);
  });

  it('creates the output directory and changes no file of the project', () => {
    const root = project({ 'package.json': '{}', 'migrations/001.js': upFile("    await qi.createTable('t1', {});") });
    const out = join(tempDir('xhb-out-'), 'nested/out');
    expect(runHandbook(['data', root, out]).status).toBe(0);
    expect(JSON.parse(readFileSync(join(out, 'data.json'), 'utf-8')).tables.map((t) => t.name)).toEqual(['t1']);
  });

  it('exits 2 for a missing argument, a project that is not a directory and an unknown option', () => {
    const out = tempDir('xhb-out-');
    expect(runHandbook(['data']).status).toBe(2);
    expect(runHandbook(['data', FIXTURE]).status).toBe(2);
    expect(runHandbook(['data', join(out, 'absent'), out]).status).toBe(2);
    expect(runHandbook(['data', FIXTURE, out, 'extra']).status).toBe(2);
  });

  it('is listed in the usage text', () => {
    const result = runHandbook(['--help']);
    expect(result.stdout).toContain('data <projectRoot> <out>');
  });
});

describe('the shape check', () => {
  const good = () => JSON.parse(JSON.stringify(extractData(FIXTURE)));

  it('accepts what the extraction writes', () => {
    expect(checkDataShape(good())).toEqual([]);
  });

  it('refuses a value that is not an object, another format and a missing field', () => {
    expect(checkDataShape(null).length).toBeGreaterThan(0);
    expect(checkDataShape([]).length).toBeGreaterThan(0);
    const other = good();
    other.format = 'excavator-product-handbook-data/2';
    expect(checkDataShape(other).join('\n')).toContain('format');
    const missing = good();
    delete missing.gaps;
    expect(checkDataShape(missing).join('\n')).toContain('gaps');
  });

  it('refuses a count that does not match its list', () => {
    const wrong = good();
    wrong.counts.tables += 1;
    expect(checkDataShape(wrong).join('\n')).toContain('counts.tables');
    const dropped = good();
    dropped.counts.operations.unnamed = 0;
    expect(checkDataShape(dropped).join('\n')).toContain('counts.operations');
  });

  it('refuses a table that is not well formed and a list that names an unlisted table', () => {
    const bad = good();
    bad.tables[0].mentions = [];
    expect(checkDataShape(bad).join('\n')).toContain('tables[0].mentions');
    const unlisted = good();
    unlisted.onlyInMigrations.push('no_such_table');
    expect(checkDataShape(unlisted).join('\n')).toContain('no_such_table');
    const dupe = good();
    dupe.tables.push(dupe.tables[0]);
    expect(checkDataShape(dupe).join('\n')).toContain('twice');
  });

  it('accepts the optional as on a source and a change, and refuses one that is not a string', () => {
    const find = (data) => data.tables.find((entry) => entry.name === 'invoices');
    const ok = good();
    expect(find(ok).sources[0].as).toBe('old_invoices');
    expect(find(ok).changes[0].as).toBe('old_invoices');
    expect(checkDataShape(ok)).toEqual([]);
    const source = good();
    find(source).sources[0].as = 5;
    expect(checkDataShape(source).join('\n')).toContain('tables[');
    const change = good();
    find(change).changes[0].as = '';
    expect(checkDataShape(change).join('\n')).toContain('tables[');
    const absent = good();
    delete find(absent).sources[0].as;
    expect(checkDataShape(absent)).toEqual([]);
  });

  it('refuses a droppedButDeclared that is missing, names an unlisted table, or disagrees with its count', () => {
    const missing = good();
    delete missing.droppedButDeclared;
    expect(checkDataShape(missing).join('\n')).toContain('droppedButDeclared');
    const unlisted = good();
    unlisted.droppedButDeclared.push('no_such_table');
    expect(checkDataShape(unlisted).join('\n')).toContain('no_such_table');
    const count = good();
    count.counts.droppedButDeclared = 0;
    expect(checkDataShape(count).join('\n')).toContain('counts.droppedButDeclared');
  });

  it('refuses a bucket that is not one of the named ones', () => {
    const bad = good();
    bad.operations[0].bucket = 'misc';
    expect(checkDataShape(bad).join('\n')).toContain('operations[0].bucket');
  });
});

describe('edge cases of the reading', () => {
  it('reads each migration directory on its own: a drop in one does not remove the table of the other', () => {
    const root = project({
      'a-app/package.json': '{}',
      'a-app/migrations/001.js': upFile("    await qi.createTable('shared', {});\n    await qi.dropTable('shared');"),
      'b-app/package.json': '{}',
      'b-app/db/migrate/001.js': upFile("    await qi.createTable('shared', {});\n    await qi.addColumn('shared', 'x', 1);"),
    });
    const data = extractData(root);
    expect(data.tables.map((t) => t.name)).toEqual(['shared']);
    const shared = data.tables[0];
    expect(shared.sources).toEqual([{ kind: 'migration', file: 'b-app/db/migrate/001.js', line: 3 }]);
    expect(shared.directories).toEqual(['b-app/db/migrate']);
    expect(data.dropped).toEqual([{ name: 'shared', file: 'a-app/migrations/001.js', line: 4, createdBy: 'a-app/migrations/001.js', directory: 'a-app/migrations' }]);
    expect(data.applications).toEqual([{ directory: 'a-app', migrations: 1 }, { directory: 'b-app', migrations: 1 }]);
  });

  it('is not confused by an apostrophe in a comment or a call and a statement inside a string or comment', () => {
    const root = project({
      'package.json': '{}',
      'migrations/001.js': upFile([
        "    // don't forget: qi.dropTable('victim');",
        "    /* qi.dropTable('victim2'); */",
        "    const note = \"qi.dropTable('victim3')\";",
        "    await qi.createTable('victim', {});",
        "    await qi.createTable('victim2', {});",
        "    await qi.createTable('victim3', {});",
      ].join('\n')),
    });
    const data = extractData(root);
    expect(data.tables.map((t) => t.name)).toEqual(['victim', 'victim2', 'victim3']);
    expect(data.dropped).toEqual([]);
    expect(data.counts.operations.total).toBe(3);
  });

  it('does not take the first part of a concatenation as the table name', () => {
    const root = project({
      'package.json': '{}',
      'migrations/001.js': upFile("    await qi.createTable('a' + b, {});\n    await qi.renameTable('x', y);"),
    });
    const data = extractData(root);
    expect(data.tables).toEqual([]);
    expect(data.gaps.unnamedOperations.map((o) => [o.line, o.op])).toEqual([[3, 'create-table'], [4, 'rename-table']]);
  });

  it('finds the migration directory by name in any case and replays the files in byte order of their names', () => {
    const root = project({
      'package.json': '{}',
      'db/Migration/Z.js': upFile("    await qi.dropTable('t');"),
      'db/Migration/a.js': upFile("    await qi.createTable('t', {});"),
    });
    const data = extractData(root);
    // byte order puts Z.js before a.js: the drop finds nothing, then t is created and stays
    expect(data.tables.map((t) => t.name)).toEqual(['t']);
    expect(data.tables[0].createdBy).toBe('db/Migration/a.js');
    expect(data.dropped).toEqual([]);
  });

  it('gives an empty project empty lists and zero counts, and every application its zero', () => {
    const root = project({ 'app/package.json': '{}', 'app/src/index.js': 'module.exports = 1;\n' });
    const data = extractData(root);
    expect(data.tables).toEqual([]);
    expect(data.applications).toEqual([{ directory: 'app', migrations: 0 }]);
    expect(data.counts.tables).toBe(0);
    expect(checkDataShape(data)).toEqual([]);
  });

  it('counts a binary file and a file over the size cap, and does not search them', () => {
    const root = project({
      'package.json': '{}',
      'migrations/001.js': upFile("    await qi.createTable('t1', {});"),
      'src/ok.js': "const a = 't1';\n",
    });
    writeFileSync(join(root, 'src/blob.bin'), Buffer.from([0x74, 0x31, 0, 0x27, 0x74, 0x31, 0x27]));
    writeFileSync(join(root, 'src/huge.js'), `'t1';\n${'x'.repeat(2 * 1024 * 1024 + 10)}`);
    const data = extractData(root);
    expect(data.scanned.skippedBinary).toBe(1);
    expect(data.scanned.skippedTooLarge).toBe(1);
    expect(data.tables[0].mentions['.'].map((x) => x.file)).toEqual(['src/ok.js']);
  });

  it('reads a fixture project that has no migration directory (the handbook fixture) without error', () => {
    const data = extractData(FIXTURE_PROJECT);
    expect(data.tables).toEqual([]);
    expect(data.migrations).toEqual([]);
    expect(checkDataShape(data)).toEqual([]);
  });
});

describe('one pass per file', () => {
  it('finds 300 tables in 500 files of ordinary size quickly, with the right mentions', () => {
    const files = { 'package.json': '{}' };
    const creates = [];
    for (let i = 0; i < 300; i += 1) creates.push(`    await qi.createTable('tbl_${i}', {});`);
    files['migrations/001.js'] = upFile(creates.join('\n'));
    const filler = Array.from({ length: 300 }, (_, i) => `const value_${i} = compute(${i}); // plain text without a table name`).join('\n');
    for (let f = 0; f < 500; f += 1) {
      const extra = f % 50 === 0 ? `\nconst sql = 'SELECT * FROM tbl_${f % 300} WHERE id = 1';\nconst k = 'tbl_${(f + 7) % 300}';\n` : '\n';
      files[`src/file_${f}.js`] = `${filler}${extra}`;
    }
    const root = project(files);
    const started = Date.now();
    const data = extractData(root);
    const elapsed = Date.now() - started;
    expect(data.tables).toHaveLength(300);
    expect(data.scanned.filesSearched).toBe(501);
    expect(data.counts.onlyInMigrations).toBe(300 - new Set([...Array.from({ length: 10 }, (_, j) => (j * 50) % 300), ...Array.from({ length: 10 }, (_, j) => (j * 50 + 7) % 300)]).size);
    expect(elapsed).toBeLessThan(5000);
  });
});
