// O2 of openspec change handbook-status-dictionary: the technical view shows
// the status dictionary as a part of the data chapter, the product view never
// does; a missing and a malformed dictionaries.json each give one visible
// line; the numbers of the count line equal the lengths of the lists; the
// page data carries the dictionary (format /7) in its technical part only.
// The expectations are written by hand from the purpose-built fixture project.
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { extractDictionaries } from '../../../skills/excavator-product-handbook/lib/dict-extract.mjs';
import { computeDictionaryCounts } from '../../../skills/excavator-product-handbook/lib/dict-shape.mjs';
import { JS_NAME_WORDS } from '../../../skills/excavator-product-handbook/lib/dict-js.mjs';
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

const FIXTURE = join(repoRoot, 'tests/fixtures/product-handbook/dict-project');
const ui = JSON.parse(readFileSync(SHIPPED_UI, 'utf-8')).strings;
const dictionaries = extractDictionaries(FIXTURE);

const assemble = (run, views) => run.run('assemble', '--views', views);
const page = (run, views) => runHandbook(['page', run.out, '--project', run.root, '--views', views], { env: { ...process.env, EXCAVATOR_PRODUCT_HANDBOOK_PAGE_TEMPLATE: stubPath } });
const text = (run, name) => readFileSync(join(run.out, name), 'utf-8');
const pageData = (run) => JSON.parse(/<script type="application\/json" id="xv-product-handbook-data">([\s\S]*?)<\/script>/.exec(text(run, 'handbook.html'))[1]);

/** A run with a verified overview; `dict` is written to dictionaries.json unless null (a string is written as it is). */
function run(dict) {
  const made = checkedOverviewRun(cleanups);
  verifyChecked(made, 'overview');
  if (dict !== null) writeFileSync(join(made.out, 'dictionaries.json'), typeof dict === 'string' ? dict : `${JSON.stringify(dict, null, 2)}\n`);
  return made;
}

/** The text of the dictionary part of the technical handbook: from its heading to the next level-2 or level-3 heading, or the end. */
function dictionaryPart(body) {
  const start = body.indexOf(`\n### ${ui['md.dict.heading']}\n`);
  expect(start, 'the status dictionary part').toBeGreaterThanOrEqual(0);
  const next = body.slice(start + 5).search(/\n##? |\n### /);
  return body.slice(start + 1, next === -1 ? undefined : start + 5 + next);
}
/** The text of a `####` part of the dictionary part, up to the next `####` that is not one of the per-application headings. */
function subpart(part, headingKey) {
  const start = part.indexOf(`#### ${ui[headingKey]}\n`);
  expect(start, headingKey).toBeGreaterThanOrEqual(0);
  const next = part.indexOf('\n#### ', start + 5);
  return part.slice(start, next === -1 ? undefined : next);
}

describe('the shipped fixed text', () => {
  it('has every key the part and the page use', () => {
    for (const key of ['md.dict.heading', 'md.dict.note.nameFilter', 'md.dict.note.meaning', 'md.dict.countLine', 'md.dict.notWritten', 'md.dict.malformed', 'md.dict.mismatchHeading', 'md.dict.table.member', 'page.dict.filter.search']) expect(typeof ui[key], key).toBe('string');
  });

  it('names every word of the JavaScript name filter in the note, and the forms in the recognized list', () => {
    for (const word of JS_NAME_WORDS) expect(ui['md.dict.note.nameFilter'].toLowerCase(), word).toContain(word);
    expect(ui['md.dict.note.nameFilter']).toContain('as const');
    expect(ui['md.dict.note.meaning']).toContain('comment');
    expect(ui['md.dict.note.meaning']).toContain('blank');
    expect(ui['md.dict.form.tsConstObject']).toContain('as const');
    expect(Object.keys(ui).filter((key) => key.startsWith('md.dict.form.')).sort()).toEqual(['md.dict.form.goNamedType', 'md.dict.form.jsObject', 'md.dict.form.tsConstObject', 'md.dict.form.tsEnum']);
  });

  it('has no apostrophe in a text the page shows, since the page escapes it', () => {
    for (const [key, value] of Object.entries(ui)) if (key.startsWith('md.dict.') || key.startsWith('page.dict.')) expect(value, key).not.toContain("'");
  });
});

describe('the technical handbook has the status dictionary inside the data chapter', () => {
  it('comes after the tables and gaps of the data chapter and before the grouping of the features', () => {
    const made = run(dictionaries);
    expect(assemble(made, 'technical').status).toBe(0);
    const body = text(made, 'handbook-technical.md');
    const at = (needle) => body.indexOf(needle);
    expect(at(`## ${ui['md.data.heading']}`)).toBeGreaterThan(0);
    expect(at(`### ${ui['md.dict.heading']}`)).toBeGreaterThan(at(`### ${ui['md.data.gapsHeading']}`));
    const grouping = body.search(/^## (Domains|Areas) and features$/m);
    expect(at(`### ${ui['md.dict.heading']}`)).toBeLessThan(grouping);
  });

  it('writes the fixed notes, the recognized forms and the two count lines', () => {
    const made = run(dictionaries);
    assemble(made, 'technical');
    const part = dictionaryPart(text(made, 'handbook-technical.md'));
    for (const key of ['md.dict.note.nameFilter', 'md.dict.note.meaning', 'md.dict.note.values']) expect(part, key).toContain(ui[key]);
    expect(part).toContain(ui['md.dict.recognized'].replace('{forms}', ['goNamedType', 'tsEnum', 'tsConstObject', 'jsObject'].map((form) => ui[`md.dict.form.${form}`]).join('; ')));
    expect(part).toContain('Value sets: 21 (8 Go types, 5 TS enums, 2 TS const objects, 6 JS objects). Members: 66 (62 computed, 4 not computed). Comments: 11. Display names: 20. Same names with different values: 3. Skipped members: 5.');
    expect(part).toContain('Candidates that are not value sets: 2 Go types without constants, 0 Go types declared again, 2 untyped iota constants, 2 constants of another type, 3 plain constants, 1 TS const objects without literal members, 1 JS objects without literal members. Mapping table entries that name no member: 7. Mapping table entries that name more than one member: 0.');
  });

  it('every number of the count line equals the length of the list it counts', () => {
    const made = run(dictionaries);
    assemble(made, 'technical');
    const part = dictionaryPart(text(made, 'handbook-technical.md'));
    const sets = part.split('\n').filter((line) => line.startsWith('###### '));
    expect(sets).toHaveLength(21);
    const rows = part.split('\n').filter((line) => line.startsWith('| ') && !line.startsWith('| ---') && !line.startsWith(`| ${ui['md.dict.table.member']} |`));
    expect(rows).toHaveLength(66);
    const mismatch = subpart(part, 'md.dict.mismatchHeading');
    expect(mismatch.split('\n').filter((line) => line.startsWith('- '))).toHaveLength(3);
    // the numbers of the count line, read back from the text, equal the list lengths
    const line = /Value sets: (\d+) \((\d+) Go types, (\d+) TS enums, (\d+) TS const objects, (\d+) JS objects\)\. Members: (\d+) \((\d+) computed, (\d+) not computed\)\. Comments: (\d+)\. Display names: (\d+)\. Same names with different values: (\d+)\./.exec(part).slice(1).map(Number);
    expect(line[0]).toBe(sets.length);
    expect(line[5]).toBe(rows.length);
    expect(line[6] + line[7]).toBe(rows.length);
    expect(line[10]).toBe(3);
    const cells = rows.map((row) => row.split(/(?<!\\)\|/).map((cell) => cell.trim()));
    expect(cells.filter((cell) => cell[2].includes('(not computed)') || cell[2] === ui['md.dict.notComputed'])).toHaveLength(line[7]);
    expect(cells.reduce((sum, cell) => sum + (cell[3] === '' ? 0 : cell[3].split('<br>').length), 0)).toBe(line[9]);
    expect(cells.reduce((sum, cell) => sum + (cell[4] === '' ? 0 : cell[4].split('<br>').length), 0)).toBe(line[8]);
  });

  it('lists the same names with different values, with the value that only one side has and the member names of both', () => {
    const made = run(dictionaries);
    assemble(made, 'technical');
    const mismatch = subpart(dictionaryPart(text(made, 'handbook-technical.md')), 'md.dict.mismatchHeading');
    expect(mismatch).toContain(ui['md.dict.mismatchNote']);
    const lines = mismatch.split('\n').filter((line) => line.trim().startsWith('- '));
    expect(lines).toEqual([
      '- go-app/billing/invoice.go:InvoiceState (go-app) and web-app/src/enums.ts:InvoiceState (web-app)',
      '  - Only in web-app/src/enums.ts:InvoiceState (web-app): "refunded" (Refunded)',
      '  - In both: "open" (InvoiceOpen / Open), "paid" (InvoicePaid / Paid), "void" (InvoiceVoid / Void)',
      '- node-app/src/constants.js:INVOICE_STATE (node-app) and web-app/src/enums.ts:InvoiceState (web-app)',
      '  - Only in web-app/src/enums.ts:InvoiceState (web-app): "refunded" (Refunded)',
      '  - In both: "open" (open / Open), "paid" (paid / Paid), "void" (void / Void)',
      '- go-app/status/types.go:Status (go-app) and web-app/src/enums.ts:Status (web-app)',
      '  - Only in web-app/src/enums.ts:Status (web-app): 5 (Archived)',
      '  - In both: 1 (StatusDraft / Draft), 2 (StatusSubmitted / Submitted), 3 (StatusApproved / Approved), 4 (StatusRejected / Rejected)',
      '  - Not compared, value not computed in go-app/status/types.go:Status (go-app): StatusLegacy',
    ]);
  });

  it('groups the value sets by application and then by file, each set a table with its members', () => {
    const made = run(dictionaries);
    assemble(made, 'technical');
    const part = dictionaryPart(text(made, 'handbook-technical.md'));
    const at = (needle) => part.indexOf(needle);
    const apps = ['go-app', 'node-app', 'web-app'].map((name) => at(`#### Application ${name}\n`));
    expect(apps.every((index) => index > 0)).toBe(true);
    expect([...apps].sort((a, b) => a - b)).toEqual(apps);
    expect(at('##### web-app/src/consts.ts\n')).toBeGreaterThan(apps[2]);
    expect(at('##### web-app/src/enums.ts\n')).toBeGreaterThan(at('##### web-app/src/consts.ts\n'));
    expect(at('###### TicketStatus\n')).toBeGreaterThan(at('##### web-app/src/consts.ts\n'));
    expect(part.indexOf('###### Status\n', at('##### web-app/src/enums.ts\n'))).toBeGreaterThan(0);
    expect(part).toContain('TypeScript object ending in as const, declared at web-app/src/consts.ts, line 1.');
    expect(part).toContain('Go named type (uint8), declared at go-app/status/aliases.go, line 3.');
  });

  it('writes a row per member: name, value (a string quoted, not computed marked), display names with places, comments, location', () => {
    const made = run(dictionaries);
    assemble(made, 'technical');
    const part = dictionaryPart(text(made, 'handbook-technical.md'));
    const row = (name, place) => part.split('\n').find((line) => line.startsWith(`| ${name} |`) && line.endsWith(`| ${place} |`));
    expect(row('StatusDraft', 'go-app/status/consts.go, line 5')).toBe('| StatusDraft | 1 | Draft (api) (go-app/api/labels.go, line 6)<br>Draft (go-app/status/labels.go, line 4) | StatusDraft is the initial state.<br>created by the user | go-app/status/consts.go, line 5 |');
    expect(row('StatusLegacy', 'go-app/status/consts.go, line 12')).toBe('| StatusLegacy | legacyBase + 1 (not computed) |  |  | go-app/status/consts.go, line 12 |');
    expect(row('KindInternal', 'go-app/status/consts.go, line 16')).toBe('| KindInternal | "internal" |  |  | go-app/status/consts.go, line 16 |');
    expect(row('B', 'web-app/src/enums.ts, line 18')).toBe('| B | not computed |  |  | web-app/src/enums.ts, line 18 |');
    expect(row('Open', 'web-app/src/consts.ts, line 2')).toBe('| Open | "open" | Open (web-app/src/consts.ts, line 6)<br>Open ticket (web-app/src/ticket-labels.ts, line 4) |  | web-app/src/consts.ts, line 2 |');
    expect(row('StatusApproved', 'go-app/status/consts.go, line 10')).toBe('| StatusApproved | 3 | Approved (api) (go-app/api/labels.go, line 7)<br>Approved (go-app/status/labels.go, line 8) |  | go-app/status/consts.go, line 10 |');
  });

  it('writes the same bytes on a second run', () => {
    const made = run(dictionaries);
    assemble(made, 'technical');
    const first = text(made, 'handbook-technical.md');
    assemble(made, 'technical');
    expect(text(made, 'handbook-technical.md')).toBe(first);
  });
});

describe('the product view never shows the status dictionary', () => {
  it('has no part and no value set name in handbook.md, whatever dictionaries.json holds', () => {
    const made = run(dictionaries);
    expect(assemble(made, 'product').status).toBe(0);
    const body = text(made, 'handbook.md');
    expect(body).not.toContain(ui['md.dict.heading']);
    expect(body).not.toContain(ui['md.dict.note.meaning']);
    expect(body).not.toContain('TicketStatus');
    expect(existsSync(join(made.out, 'handbook-technical.md'))).toBe(false);
  });

  it('with both views, handbook.md has none and the technical file has the part', () => {
    const made = run(dictionaries);
    expect(assemble(made, 'product,technical').status).toBe(0);
    expect(text(made, 'handbook.md')).not.toContain(ui['md.dict.heading']);
    expect(text(made, 'handbook.md')).not.toContain(ui['md.dict.notWritten']);
    expect(text(made, 'handbook-technical.md')).toContain(`### ${ui['md.dict.heading']}`);
  });

  it('with no dictionaries.json the product handbook has no line about it either', () => {
    const made = run(null);
    assemble(made, 'product');
    expect(text(made, 'handbook.md')).not.toContain(ui['md.dict.notWritten']);
  });
});

describe('a missing or malformed dictionaries.json is one visible line in the technical view', () => {
  it('missing: the heading and the one line that says the status dictionary was not written', () => {
    const made = run(null);
    expect(assemble(made, 'technical').status).toBe(0);
    const lines = dictionaryPart(text(made, 'handbook-technical.md')).split('\n').filter((line) => line.trim() !== '');
    expect(lines).toEqual([`### ${ui['md.dict.heading']}`, ui['md.dict.notWritten']]);
  });

  it('malformed (a JSON that fails the shape check, or text that is not JSON): the heading and the one line that says so', () => {
    const broken = clone(dictionaries);
    broken.counts.members.total += 1;
    for (const value of [broken, '{ not json', { format: 'excavator-product-handbook-dictionaries/1' }]) {
      const made = run(value);
      expect(assemble(made, 'technical').status).toBe(0);
      const lines = dictionaryPart(text(made, 'handbook-technical.md')).split('\n').filter((line) => line.trim() !== '');
      expect(lines).toEqual([`### ${ui['md.dict.heading']}`, ui['md.dict.malformed']]);
      cleanups.pop()();
    }
  });

  it('a project with no value set: the notes and the zero count line, and no list', () => {
    const empty = clone(dictionaries);
    empty.dictionaries = [];
    empty.candidates = [];
    empty.mismatches = [];
    empty.applications = empty.applications.map((row) => ({ ...row, dictionaries: 0 }));
    empty.counts = computeDictionaryCounts(empty);
    const made = run(empty);
    expect(assemble(made, 'technical').status).toBe(0);
    const part = dictionaryPart(text(made, 'handbook-technical.md'));
    expect(part).toContain('Value sets: 0 (0 Go types, 0 TS enums, 0 TS const objects, 0 JS objects).');
    expect(part).not.toContain('######');
  });
});

describe('the page data carries the dictionary in its technical part only', () => {
  it('uses format /7; the technical part holds the lists the page shows and neither the candidates nor the scan counts', () => {
    const made = run(dictionaries);
    expect(page(made, 'product,technical').status).toBe(0);
    const got = pageData(made);
    expect(got.format).toBe('excavator-product-handbook-page/7');
    expect(Object.keys(got.technical).slice(-2)).toEqual(['dictionaries', 'dictionariesState']);
    expect(got.technical.dictionariesState).toBe('ok');
    expect(Object.keys(got.technical.dictionaries)).toEqual(['recognized', 'applications', 'dictionaries', 'mismatches', 'counts']);
    expect(got.technical.dictionaries.dictionaries).toHaveLength(21);
    expect(got.technical.dictionaries.mismatches).toHaveLength(3);
    expect(got.technical.dictionaries.counts).toEqual(dictionaries.counts);
    expect(got.technical.dictionaries.recognized).toEqual(['go-named-type', 'ts-enum', 'ts-const-object', 'js-object']);
    const status = got.technical.dictionaries.dictionaries.find((entry) => entry.id === 'go-app/status/types.go:Status');
    expect(status.members[0]).toEqual(dictionaries.dictionaries.find((entry) => entry.id === 'go-app/status/types.go:Status').members[0]);
  });

  it('a product-only page has no technical part and so no value set', () => {
    const made = run(dictionaries);
    expect(page(made, 'product').status).toBe(0);
    const got = pageData(made);
    expect(got.format).toBe('excavator-product-handbook-page/7');
    expect(Object.hasOwn(got, 'technical')).toBe(false);
    expect(text(made, 'handbook.html')).not.toContain('TicketStatus');
  });

  it('missing and malformed dictionaries.json give a null section and the reason', () => {
    const missing = run(null);
    expect(page(missing, 'technical').status).toBe(0);
    expect(pageData(missing).technical.dictionaries).toBeNull();
    expect(pageData(missing).technical.dictionariesState).toBe('missing');
    const malformed = run('{ not json');
    expect(page(malformed, 'technical').status).toBe(0);
    expect(pageData(malformed).technical.dictionaries).toBeNull();
    expect(pageData(malformed).technical.dictionariesState).toBe('malformed');
  });
});
