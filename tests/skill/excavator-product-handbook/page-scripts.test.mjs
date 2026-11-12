// The page data (format /19) carries the blocks the scripts write: the data section and the status dictionaries in the
// technical part only, the code health in both views with the paths of its files in the technical part only. A file
// that is missing or malformed gives a null section and the reason. The sections are the ones the data page, the
// dictionaries page and the code health page draw (openspec changes handbook-data-tables, handbook-status-dictionary,
// handbook-history-appendix), now carried by the page data of openspec change handbook-skill-first.
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { extractData } from '../../../skills/excavator-product-handbook/lib/data-extract.mjs';
import { extractDictionaries } from '../../../skills/excavator-product-handbook/lib/dict-extract.mjs';
import { goodHistory, writeHistory } from './appendix-fixture.mjs';
import { repoRoot } from './helpers.mjs';
import { STUB, dataOf, html, pageRun, runPage } from './page-md-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});
const stubDir = mkdtempSync(join(tmpdir(), 'xhb-stub-'));
const stubPath = join(stubDir, 'template.html');
writeFileSync(stubPath, STUB);
afterAll(() => rmSync(stubDir, { recursive: true, force: true }));

const data = extractData(join(repoRoot, 'tests/fixtures/product-handbook/data-project'));
const dictionaries = extractDictionaries(join(repoRoot, 'tests/fixtures/product-handbook/dict-project'));
const make = () => pageRun(cleanups, { withScripts: false });
const page = (run, views = 'product,technical') => runPage(run, { template: stubPath, views });
const put = (run, name, value) => writeFileSync(join(run.out, name), typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);

describe('the data section', () => {
  it('is in the technical part, with the lists the page shows and none of the ledgers', () => {
    const run = make();
    put(run, 'data.json', data);
    expect(page(run).status).toBe(0);
    const got = dataOf(html(run));
    expect(got.technical.dataState).toBe('ok');
    expect(Object.keys(got.technical.data)).toEqual(['recognized', 'applications', 'tables', 'dropped', 'changedNeverCreated', 'declaredOnly', 'removedButDeclared', 'onlyInMigrations', 'gaps', 'counts']);
    expect(got.technical.data.tables).toHaveLength(30);
    expect(got.technical.data.counts).toEqual(data.counts);
    const users = got.technical.data.tables.find((entry) => entry.name === 'users');
    expect(Object.keys(users)).toEqual(['name', 'sources', 'createdBy', 'lastChangedBy', 'mentions']);
    expect(users.mentions['node-app']).toHaveLength(3);
  });

  it('is not in a product-only page: no technical part and no table name anywhere', () => {
    const run = make();
    put(run, 'data.json', data);
    expect(page(run, 'product').status).toBe(0);
    const got = dataOf(html(run));
    expect(Object.hasOwn(got, 'technical')).toBe(false);
    expect(html(run)).not.toContain('ledger_entries');
  });

  it('missing and malformed data.json give a null section and the reason', () => {
    const missing = make();
    expect(page(missing, 'technical').status).toBe(0);
    expect(dataOf(html(missing)).technical).toMatchObject({ data: null, dataState: 'missing' });
    const malformed = make();
    put(malformed, 'data.json', '{ not json');
    expect(page(malformed, 'technical').status).toBe(0);
    expect(dataOf(html(malformed)).technical).toMatchObject({ data: null, dataState: 'malformed' });
  });
});

describe('the status dictionaries', () => {
  it('are in the technical part, with the lists the page shows and neither the candidates nor the scan counts', () => {
    const run = make();
    put(run, 'dictionaries.json', dictionaries);
    expect(page(run).status).toBe(0);
    const got = dataOf(html(run)).technical;
    expect(got.dictionariesState).toBe('ok');
    expect(Object.keys(got.dictionaries)).toEqual(['recognized', 'applications', 'dictionaries', 'mismatches', 'counts']);
    expect(got.dictionaries.dictionaries).toHaveLength(31);
    expect(got.dictionaries.mismatches).toHaveLength(3);
    expect(got.dictionaries.counts).toEqual(dictionaries.counts);
    expect(got.dictionaries.recognized).toEqual(['go-named-type', 'go-typed-var', 'ts-enum', 'ts-const-object', 'js-object', 'js-record-member']);
    const status = got.dictionaries.dictionaries.find((entry) => entry.id === 'go-app/status/types.go:Status');
    expect(status.members[0]).toEqual(dictionaries.dictionaries.find((entry) => entry.id === 'go-app/status/types.go:Status').members[0]);
  });

  it('are not in a product-only page', () => {
    const run = make();
    put(run, 'dictionaries.json', dictionaries);
    expect(page(run, 'product').status).toBe(0);
    expect(Object.hasOwn(dataOf(html(run)), 'technical')).toBe(false);
    expect(html(run)).not.toContain('TicketStatus');
  });

  it('missing and malformed dictionaries.json give a null section and the reason', () => {
    const missing = make();
    expect(page(missing, 'technical').status).toBe(0);
    expect(dataOf(html(missing)).technical).toMatchObject({ dictionaries: null, dictionariesState: 'missing' });
    const malformed = make();
    put(malformed, 'dictionaries.json', '{ not json');
    expect(page(malformed, 'technical').status).toBe(0);
    expect(dataOf(html(malformed)).technical).toMatchObject({ dictionaries: null, dictionariesState: 'malformed' });
  });
});

describe('the code health', () => {
  const withHistory = (doc = goodHistory()) => {
    const run = make();
    writeHistory(run, doc);
    return run;
  };

  it('holds the file names, the features that have a chapter and the conventions, in both views', () => {
    const run = withHistory();
    expect(page(run).status).toBe(0);
    const { history } = dataOf(html(run));
    expect(Object.keys(history)).toEqual(['state', 'noHistory', 'years', 'apps', 'hotspots', 'coChange', 'tests', 'conventions']);
    expect(history.state).toBe('ok');
    // F3 has no chapter in this run, so the hotspot lists F1 only.
    expect(history.hotspots[0]).toEqual({ name: 'orders.js', app: '.', commits: 5, authors: 2, lines: 20, last: '2024-09-09', uncertain: 0, features: ['F1'] });
    expect(history.coChange).toEqual([{ a: 'app.js', appA: '.', b: 'orders.js', appB: '.', commits: 4 }]);
    expect(history.years).toEqual(goodHistory().years);
    expect(history.conventions).toEqual(['goTest', 'dotTest', 'dotSpec', 'pyPrefix', 'pySuffix', 'javaTest', 'testsDir']);
  });

  it('holds the uncertain count of each hotspot file', () => {
    const doc = goodHistory();
    doc.hotspots[1].uncertain = 4;
    const run = withHistory(doc);
    page(run);
    expect(dataOf(html(run)).history.hotspots.map((row) => row.uncertain)).toEqual([0, 4]);
  });

  it('holds the paths in the technical part only, in the order of the rows', () => {
    const run = withHistory();
    page(run);
    const { technical, ...product } = dataOf(html(run));
    expect(technical.history).toEqual({ hotspots: ['src/routes/orders.js', 'src/app.js'], coChange: [{ a: 'src/app.js', b: 'src/routes/orders.js' }] });
    expect(JSON.stringify(product)).not.toContain('src/routes');
    expect(JSON.stringify(product)).not.toContain('src/app.js');
    const only = withHistory();
    page(only, 'product');
    expect(html(only)).not.toContain('src/routes');
    expect(dataOf(html(only)).history.state).toBe('ok');
  });

  it('is null without a history file, in the data and in the technical part', () => {
    const run = make();
    page(run);
    const got = dataOf(html(run));
    expect(got.history).toBeNull();
    expect(got.technical.history).toBeNull();
  });
});
