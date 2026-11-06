// O3 of openspec change handbook-data-tables: the technical view shows the
// data section, the product view never does; a missing and a malformed
// data.json each give one visible line; the count line equals the lists; the
// page data carries the section (format /7) in its technical part only.
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { extractData } from '../../../skills/excavator-product-handbook/lib/data-extract.mjs';
import { SHIPPED_UI, clone, repoRoot, runHandbook, verifyChecked } from './helpers.mjs';
import { checkedOverviewRun } from './overview-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const STUB = '<!doctype html><html lang="und"><head><meta charset="UTF-8"><!-- xv:csp --></head><body><div id="root"></div><!-- xv:data --></body></html>';
const stubDir = mkdtempSync(join(tmpdir(), 'xhb-stub-'));
const stubPath = join(stubDir, 'template.html');
writeFileSync(stubPath, STUB);
afterAll(() => rmSync(stubDir, { recursive: true, force: true }));

const FIXTURE = join(repoRoot, 'tests/fixtures/product-handbook/data-project');
const ui = JSON.parse(readFileSync(SHIPPED_UI, 'utf-8')).strings;
const data = extractData(FIXTURE);

const assemble = (run, views) => run.run('assemble', '--views', views);
const page = (run, views) => runHandbook(['page', run.out, '--project', run.root, '--views', views], { env: { ...process.env, EXCAVATOR_PRODUCT_HANDBOOK_PAGE_TEMPLATE: stubPath } });
const text = (run, name) => readFileSync(join(run.out, name), 'utf-8');
const pageData = (run) => JSON.parse(/<script type="application\/json" id="xv-product-handbook-data">([\s\S]*?)<\/script>/.exec(text(run, 'handbook.html'))[1]);

/** A run with a verified overview, which is all assemble and page need; `dataJson` is written to data.json unless null. */
function run(dataJson) {
  const made = checkedOverviewRun(cleanups);
  verifyChecked(made, 'overview');
  if (dataJson !== null) writeFileSync(join(made.out, 'data.json'), typeof dataJson === 'string' ? dataJson : `${JSON.stringify(dataJson, null, 2)}\n`);
  return made;
}

/** The lines of the chapter's data part: from its heading to the next level-2 heading, or to the status dictionary part (dict-output.test.mjs), which is its own part of the chapter. */
function chapter(body) {
  const start = body.indexOf(`\n## ${ui['md.data.heading']}\n`);
  expect(start, 'the data chapter').toBeGreaterThanOrEqual(0);
  const ends = [body.indexOf('\n## ', start + 4), body.indexOf(`\n### ${ui['md.dict.heading']}\n`, start + 4)].filter((at) => at !== -1);
  return body.slice(start + 1, ends.length === 0 ? undefined : Math.min(...ends));
}
/** The text of a `###` part of the chapter, up to the next `###` or the end. */
function part(text_, headingKey) {
  const start = text_.indexOf(`### ${ui[headingKey]}\n`);
  expect(start, headingKey).toBeGreaterThanOrEqual(0);
  const next = text_.indexOf('\n### ', start + 4);
  return text_.slice(start, next === -1 ? undefined : next);
}
const bullets = (section) => section.split('\n').filter((line) => line.startsWith('- '));
const tableRows = (section) => section.split('\n').filter((line) => line.startsWith('|')).slice(2);

describe('the shipped fixed text', () => {
  it('has every key the chapter and the page use, so a check that a text is absent cannot pass on an undefined key', () => {
    for (const key of ['md.data.heading', 'md.data.note.nameRules', 'md.data.notWritten', 'md.data.malformed', 'md.data.noApplication', 'md.data.onlyInMigrationsCell', 'page.data.sort.name']) expect(typeof ui[key], key).toBe('string');
  });
});

describe('the technical handbook has a data chapter after the system overview', () => {
  it('states three rules and the library-default caveat in the fixed notes', () => {
    expect(ui['md.data.note.nameRules']).toContain('exactly the table name');
    expect(ui['md.data.note.nameRules']).toContain('FROM, JOIN, INTO, UPDATE or TABLE');
    expect(ui['md.data.note.nameRules']).toContain('many2many:');
    expect(ui['md.data.note.ormDefaults']).toContain('library default');
    expect(ui['md.data.rule.c']).toContain('many2many:');
    expect(Object.keys(ui)).not.toContain('md.data.note.rules');
    expect(Object.keys(ui)).not.toContain('md.data.note.orm');
  });

  it('puts the chapter between the system overview and the domains, with the fixed note, the recognized forms and the count line', () => {
    const made = run(data);
    expect(assemble(made, 'technical').status).toBe(0);
    const body = text(made, 'handbook-technical.md');
    const at = (needle) => body.indexOf(needle);
    expect(at('## System overview')).toBeGreaterThan(0);
    expect(at(`## ${ui['md.data.heading']}`)).toBeGreaterThan(at('## System overview'));
    const grouping = body.search(/^## (Domains|Areas) and features$/m);
    expect(grouping).toBeGreaterThan(0);
    expect(at(`## ${ui['md.data.heading']}`)).toBeLessThan(grouping);
    const text_ = chapter(body);
    for (const key of ['md.data.note.nameRules', 'md.data.note.comments', 'md.data.note.ormDefaults', 'md.data.note.onlyInMigrationsAnyRule']) expect(text_, key).toContain(ui[key]);
    expect(text_).toContain(ui['md.data.recognized'].replace('{forms}', ['migration-calls', 'migration-sql', 'go-table-name', 'js-table-name', 'sql-file-create-table'].map((form) => ui[`md.data.form.${form.replace(/-([a-z])/g, (_, c) => c.toUpperCase())}`]).join('; ')));
    expect(text_).toContain('Tables: 30. Migrations: 30 (27 replayed, 2 not split, 1 down only). Tables whose name appears in two or more applications: 3. Tables whose name appears only in migrations: 17. Tables dropped by a migration: 6. Tables declared by a model or a .sql file and created by no migration: 6. Tables removed by a migration and still declared: 3. Tables changed by a migration and created by none: 1. Gaps: 12.');
  });

  it('every number of the count line equals the length of the list it counts', () => {
    const made = run(data);
    assemble(made, 'technical');
    const text_ = chapter(text(made, 'handbook-technical.md'));
    expect(tableRows(part(text_, 'md.data.tablesHeading'))).toHaveLength(30);
    expect(tableRows(part(text_, 'md.data.droppedHeading'))).toHaveLength(6);
    expect(bullets(part(text_, 'md.data.onlyInMigrationsHeading'))).toHaveLength(17);
    expect(bullets(part(text_, 'md.data.declaredOnlyHeading'))).toHaveLength(6);
    expect(bullets(part(text_, 'md.data.removedButDeclaredHeading'))).toEqual(['- legacy_notes', '- old_gadgets', '- old_gizmos']);
    const line = /Tables: \d+\. .*Gaps: \d+\./.exec(text_)[0];
    const number = (pattern) => Number(new RegExp(pattern).exec(line)[1]);
    expect(number('declared by a model or a \\.sql file and created by no migration: (\\d+)')).toBe(bullets(part(text_, 'md.data.declaredOnlyHeading')).length);
    expect(number('removed by a migration and still declared: (\\d+)')).toBe(bullets(part(text_, 'md.data.removedButDeclaredHeading')).length);
    expect(number('changed by a migration and created by none: (\\d+)')).toBe(bullets(part(text_, 'md.data.changedNeverCreatedHeading')).length);
    expect(bullets(part(text_, 'md.data.changedNeverCreatedHeading'))).toHaveLength(1);
    expect(tableRows(part(text_, 'md.data.migrationsHeading'))).toHaveLength(2);
    const gaps = part(text_, 'md.data.gapsHeading');
    const subpart = (key) => {
      const from = gaps.indexOf(`#### ${ui[key]}\n`);
      expect(from, key).toBeGreaterThanOrEqual(0);
      const to = gaps.indexOf('\n#### ', from + 5);
      return bullets(gaps.slice(from, to === -1 ? undefined : to));
    };
    expect(subpart('md.data.gap.unnamedHeading')).toHaveLength(5);
    expect(subpart('md.data.gap.unsplitHeading')).toHaveLength(2);
    expect(subpart('md.data.gap.unresolvedHeading')).toHaveLength(5);
    expect(subpart('md.data.gap.otherHeading')).toHaveLength(2);
  });

  it('writes one row per table: name, every source, the applications where the name appears with counts, created by, last changed by', () => {
    const made = run(data);
    assemble(made, 'technical');
    const rows = tableRows(part(chapter(text(made, 'handbook-technical.md')), 'md.data.tablesHeading'));
    const row = (name) => rows.find((line) => line.startsWith(`| ${name} |`));
    const users = row('users').split('|').map((cell) => cell.trim());
    expect(users[2]).toContain('migration: node-app/migrations/001-create-users.js, line 5');
    expect(users[2]).toContain('model: node-app/models/user.js, line 5');
    expect(users[3]).toContain('node-app: 3');
    expect(users[3]).toContain(`${ui['md.data.noApplication']}: 1`);
    expect(users[4]).toBe('node-app/migrations/001-create-users.js');
    expect(users[5]).toBe('node-app/migrations/009-raw-sql.js');
    const invoices = row('invoices').split('|').map((cell) => cell.trim());
    expect(invoices[2]).toBe('migration: node-app/migrations/006-old-invoices.js, line 5 (as old_invoices)');
    const ghost = row('ghost_table').split('|').map((cell) => cell.trim());
    expect(ghost[2]).toBe('-');
    expect(ghost[3]).toBe(ui['md.data.onlyInMigrationsCell']);
    expect(ghost[4]).toBe('-');
    expect(ghost[5]).toBe('node-app/migrations/011-ghost.js');
    const accounts = row('accounts').split('|').map((cell) => cell.trim());
    expect(accounts[2]).toBe('model: go-app/models/account.go, line 7');
    expect(accounts[4]).toBe('-');
  });

  it('lists the dropped tables, the declared-only tables and the gaps with their positions', () => {
    const made = run(data);
    assemble(made, 'technical');
    const text_ = chapter(text(made, 'handbook-technical.md'));
    expect(part(text_, 'md.data.droppedHeading')).toContain('| temp_logs | node-app/migrations/004-temp-logs.js | node-app/migrations/005-drop-temp-logs.js, line 5 |');
    expect(bullets(part(text_, 'md.data.declaredOnlyHeading'))).toEqual(['- accounts', '- go_orders', '- ledger_entries', '- model_only_events', '- split_schema', '- tags']);
    expect(part(text_, 'md.data.gapsHeading')).toContain('- node-app/migrations/008-computed-names.js, line 7: create-table');
    expect(part(text_, 'md.data.gapsHeading')).toContain('- go-app/models/dup.go, line 7: tableDup (2 declarations found)');
    expect(part(text_, 'md.data.gapsHeading')).toContain('- node-app/migrations/012-no-up.js');
    expect(part(text_, 'md.data.gapsHeading')).toContain('- node-app/migrations/README.md (not a migration file type)');
  });

  it('writes the same bytes on a second run', () => {
    const made = run(data);
    assemble(made, 'technical');
    const first = text(made, 'handbook-technical.md');
    assemble(made, 'technical');
    expect(text(made, 'handbook-technical.md')).toBe(first);
  });
});

describe('the product view never shows the data section', () => {
  it('has no data chapter and no table name in handbook.md, whatever data.json holds', () => {
    const made = run(data);
    expect(assemble(made, 'product').status).toBe(0);
    const body = text(made, 'handbook.md');
    expect(body).not.toContain(ui['md.data.heading']);
    expect(body).not.toContain(ui['md.data.note.nameRules']);
    expect(body).not.toContain('ledger_entries');
    expect(existsSync(join(made.out, 'handbook-technical.md'))).toBe(false);
  });

  it('with both views, handbook.md has none and the technical file has the chapter', () => {
    const made = run(data);
    expect(assemble(made, 'product,technical').status).toBe(0);
    expect(text(made, 'handbook.md')).not.toContain(ui['md.data.heading']);
    expect(text(made, 'handbook.md')).not.toContain(ui['md.data.notWritten']);
    expect(text(made, 'handbook-technical.md')).toContain(`## ${ui['md.data.heading']}`);
  });

  it('with no data.json the product handbook has no line about it either', () => {
    const made = run(null);
    assemble(made, 'product');
    expect(text(made, 'handbook.md')).not.toContain(ui['md.data.notWritten']);
  });
});

describe('a missing or malformed data.json is one visible line in the technical view', () => {
  it('missing: the heading and the one line that says the data section was not written', () => {
    const made = run(null);
    expect(assemble(made, 'technical').status).toBe(0);
    const lines = chapter(text(made, 'handbook-technical.md')).split('\n').filter((line) => line.trim() !== '');
    expect(lines).toEqual([`## ${ui['md.data.heading']}`, ui['md.data.notWritten']]);
  });

  it('malformed (a JSON that fails the shape check, or text that is not JSON): the heading and the one line that says so', () => {
    const broken = clone(data);
    broken.counts.tables += 1;
    for (const value of [broken, '{ not json', { format: 'excavator-product-handbook-data/1' }]) {
      const made = run(value);
      expect(assemble(made, 'technical').status).toBe(0);
      const lines = chapter(text(made, 'handbook-technical.md')).split('\n').filter((line) => line.trim() !== '');
      expect(lines).toEqual([`## ${ui['md.data.heading']}`, ui['md.data.malformed']]);
      cleanups.pop()();
    }
  });
});

describe('the page data carries the data section in its technical part only', () => {
  it('uses format /7; the technical part holds the lists the page shows and none of the ledgers', () => {
    const made = run(data);
    expect(page(made, 'product,technical').status).toBe(0);
    const got = pageData(made);
    expect(got.format).toBe('excavator-product-handbook-page/11');
    expect(Object.keys(got.technical).slice(-4)).toEqual(['data', 'dataState', 'dictionaries', 'dictionariesState']);
    expect(got.technical.dataState).toBe('ok');
    expect(Object.keys(got.technical.data)).toEqual(['recognized', 'applications', 'tables', 'dropped', 'changedNeverCreated', 'declaredOnly', 'removedButDeclared', 'onlyInMigrations', 'gaps', 'counts']);
    expect(got.technical.data.tables).toHaveLength(30);
    expect(got.technical.data.counts).toEqual(data.counts);
    const users = got.technical.data.tables.find((entry) => entry.name === 'users');
    expect(Object.keys(users)).toEqual(['name', 'sources', 'createdBy', 'lastChangedBy', 'mentions']);
    expect(users.mentions['node-app']).toHaveLength(3);
  });

  it('a product-only page has no technical part and so no data and no table name', () => {
    const made = run(data);
    expect(page(made, 'product').status).toBe(0);
    const got = pageData(made);
    expect(got.format).toBe('excavator-product-handbook-page/11');
    expect(Object.hasOwn(got, 'technical')).toBe(false);
    expect(text(made, 'handbook.html')).not.toContain('ledger_entries');
  });

  it('missing and malformed data.json give a null section and the reason', () => {
    const missing = run(null);
    expect(page(missing, 'technical').status).toBe(0);
    expect(pageData(missing).technical.data).toBeNull();
    expect(pageData(missing).technical.dataState).toBe('missing');
    const malformed = run('{ not json');
    expect(page(malformed, 'technical').status).toBe(0);
    expect(pageData(malformed).technical.data).toBeNull();
    expect(pageData(malformed).technical.dataState).toBe('malformed');
  });
});
