// O2 (output) of openspec change handbook-system-findings: assemble and page
// write the findings of the features and of the application roots as groups:
// one bullet for each group with the first statement and every owner, the other
// statements under it with their owners, the counts by group with the number of
// groups merged, the application's name (the verified overview's, else its
// directory), the file and lines only in the technical view, the coverage of the
// system units, and the refusal of a system unit that changed after it was verified.
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { categoryKey } from '../../../skills/excavator-product-handbook/lib/findings-shape.mjs';
import { featureFindingsLines, findingsChapter } from '../../../skills/excavator-product-handbook/lib/render-findings.mjs';
import { judge, runHandbook, traceFeature, verifyChecked } from './helpers.mjs';
import { JOB_LINE, MAILER, MAIL_LINE, NIGHTLY, ROUTE, SERVER, START, goodSystemFindings, goodSystemOverview, makeSystemRun, systemId } from './system-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const STUB = '<!doctype html><html lang="und"><head><meta charset="UTF-8"><!-- xv:csp --></head><body><div id="root"></div><!-- xv:data --></body></html>';
const stubDir = mkdtempSync(join(tmpdir(), 'xhb-stub-'));
const stubPath = join(stubDir, 'template.html');
writeFileSync(stubPath, STUB);
afterAll(() => rmSync(stubDir, { recursive: true, force: true }));

const ui = JSON.parse(readFileSync(new URL('../../../skills/excavator-product-handbook/ui-strings.json', import.meta.url), 'utf-8')).strings;
const ev = (file, passage) => ({ file, passage });

const F1_TEXT = 'The second route answers with a list whatever was stored.';
const F3_TEXT = 'The nightly job runs at one fixed hour whatever the time zone of the reader.';
const SYSTEM_SERVER_TEXT = 'The route table answers the second route with a list whatever was stored, before any check.';
const SYSTEM_MAIL_TEXT = 'The mail helper reports every message as sent without sending anything.';
const SYSTEM_TIME_TEXT = 'The nightly job starts at one fixed hour of the day, whatever the time zone of the reader.';
const SYSTEM_REMOVED_TEXT = 'The start command gives the same answer for every caller.';
const STOCK_TEXT = 'The stock list is always empty, whatever was stored.';
const REMOVED_REASON = 'The code shown does not give an answer.';

const assemble = (run, views) => run.run('assemble', '--views', views);
const text = (run, name) => readFileSync(join(run.out, name), 'utf-8');
const page = (run, views = 'product,technical') => runHandbook(['page', run.out, '--project', run.root, '--views', views], { env: { ...process.env, EXCAVATOR_PRODUCT_HANDBOOK_PAGE_TEMPLATE: stubPath } });
const dataOf = (run) => JSON.parse(/<script type="application\/json" id="xv-product-handbook-data">([\s\S]*?)<\/script>/.exec(text(run, 'handbook.html'))[1]);

/** The part of the handbook between a heading and the next heading of the same or a higher level. */
function section(body, heading) {
  const level = heading.match(/^#+/)[0].length;
  const start = body.indexOf(`\n${heading}\n`);
  expect(start, heading).toBeGreaterThanOrEqual(0);
  const rest = body.slice(start + heading.length + 2);
  const end = rest.search(new RegExp(`^#{1,${level}} `, 'm'));
  return end === -1 ? rest : rest.slice(0, end);
}

/**
 * F1 and F3 have verified findings that sit at the same place as findings of the
 * system unit of alpha (app1), which has one more (alone) and one that a verifier
 * removed; app2 (beta) has findings that passed their check and wait for the
 * verifiers; app3 (gamma) has no seed file and is verified with none.
 */
function outputRun(owner = cleanups, { overview = false } = {}) {
  const run = makeSystemRun();
  owner.push(run.cleanup);
  const feature = (id, category, text, evidence) => ({ format: 'excavator-product-handbook-findings/1', id: `${id}.findings`, findings: [{ category, text, evidence }], unknowns: [] });
  run.writeFindings('F1', feature('F1', 'other', F1_TEXT, [ev(SERVER, ROUTE(2))]));
  run.writeFindings('F3', feature('F3', 'time', F3_TEXT, [ev(NIGHTLY, JOB_LINE)]));
  for (const id of ['F1.findings', 'F3.findings']) {
    expect(run.run('check-findings', id).status).toBe(0);
    verifyChecked(run, id);
  }
  run.writeSystem(1, {
    ...goodSystemFindings(1),
    findings: [
      { category: 'other', text: SYSTEM_SERVER_TEXT, evidence: [ev(SERVER, ROUTE(2))] },
      { category: 'notification', text: SYSTEM_MAIL_TEXT, evidence: [ev(MAILER, MAIL_LINE)] },
      { category: 'time', text: SYSTEM_TIME_TEXT, evidence: [ev(NIGHTLY, JOB_LINE)] },
      { category: 'security', text: SYSTEM_REMOVED_TEXT, evidence: [ev(START, '#!/usr/bin/env node')] },
    ],
  });
  expect(run.run('check-system-findings', systemId(1)).status).toBe(0);
  const judged = judge(run, systemId(1), 1, (item) => (item.id === 'findings[3]' ? { verdict: 'contradicted', reason: REMOVED_REASON } : 'verified'));
  expect(judged.status, judged.stdout).toBe(0);
  expect(traceFeature(run, systemId(1)).status).toBe(0);
  run.writeSystem(2);
  expect(run.run('check-system-findings', systemId(2)).status).toBe(0);
  expect(run.run('check-system-findings', systemId(3)).lines).toEqual(['app3.system: verified (0 findings)']);
  if (overview) {
    run.writeOverview(goodSystemOverview());
    expect(run.run('check-overview').status).toBe(0);
    verifyChecked(run, 'overview');
  }
  return run;
}

const sharedCleanups = [];
let sharedRun = null;
const shared = () => {
  sharedRun ??= outputRun(sharedCleanups);
  return sharedRun;
};
afterAll(() => {
  while (sharedCleanups.length > 0) sharedCleanups.pop()();
});

describe('the Findings chapter writes groups', () => {
  it('a group is one bullet: the first statement with every owner, the other statements under it with their owners; a finding alone is a bullet of its own', () => {
    const run = shared();
    expect(assemble(run, 'product').status).toBe(0);
    const chapter = section(text(run, 'handbook.md'), `## ${ui['md.findings.heading']}`);
    expect(chapter).toContain(`- F1 Orders; alpha (application): ${F1_TEXT}\n  - alpha (application): ${SYSTEM_SERVER_TEXT}\n`);
    expect(chapter).toContain(`- F3 Nightly run; alpha (application): ${F3_TEXT}\n  - alpha (application): ${SYSTEM_TIME_TEXT}\n`);
    expect(chapter).toContain(`- alpha (application): ${SYSTEM_MAIL_TEXT}\n`);
    expect(chapter).not.toContain(SYSTEM_REMOVED_TEXT);
    expect(chapter).not.toContain(STOCK_TEXT);
    // Every statement is written once.
    for (const statement of [F1_TEXT, F3_TEXT, SYSTEM_SERVER_TEXT, SYSTEM_MAIL_TEXT, SYSTEM_TIME_TEXT]) expect(chapter.split(statement), statement).toHaveLength(2);
  });

  it('lists the groups under the categories of their findings in the order of the enum', () => {
    const run = shared();
    assemble(run, 'product');
    const chapter = section(text(run, 'handbook.md'), `## ${ui['md.findings.heading']}`);
    expect([...chapter.matchAll(/^### (.+)$/gm)].map((match) => match[1])).toEqual([ui[categoryKey('notification')], ui[categoryKey('time')], ui[categoryKey('other')]]);
  });

  it('the counts line gives the groups, the statements and the groups merged, and the category counts count groups', () => {
    const run = shared();
    assemble(run, 'product');
    const chapter = section(text(run, 'handbook.md'), `## ${ui['md.findings.heading']}`);
    const line = chapter.split('\n').find((candidate) => candidate.startsWith('Findings: '));
    const counted = ['notification', 'time', 'other'];
    const names = Object.keys(ui).filter((key) => key.startsWith('md.findings.category.')).map((key) => ui[key]);
    expect(line).toBe(`Findings: 3. Statements: 5. Groups merged: 2. Findings units verified: 2 of 6. System findings units verified: 2 of 3. By category: ${names.map((name) => `${name}: ${counted.some((key) => ui[categoryKey(key)] === name) ? 1 : 0}`).join('; ')}.`);
    const bullets = chapter.split('\n').filter((row) => row.startsWith('- ')).length;
    expect(bullets).toBe(3);
    expect(chapter.split('\n').filter((row) => row.startsWith('  - ')).length).toBe(2);
  });

  it('the technical view adds the file and lines of every statement, the other statements too; the product view has no path', () => {
    const run = shared();
    expect(assemble(run, 'product,technical').status).toBe(0);
    const technical = section(text(run, 'handbook-technical.md'), `## ${ui['md.findings.heading']}`);
    expect(technical).toContain(`- F1 Orders; alpha (application): ${F1_TEXT} (${SERVER}, line 5)\n  - alpha (application): ${SYSTEM_SERVER_TEXT} (${SERVER}, line 5)\n`);
    expect(technical).toContain(`- alpha (application): ${SYSTEM_MAIL_TEXT} (${MAILER}, line 2)`);
    const product = text(run, 'handbook.md');
    for (const file of [SERVER, MAILER, NIGHTLY, 'alpha/']) expect(product, file).not.toContain(file);
    expect(product).not.toMatch(/line \d+\)/);
  });

  it('names an application by the verified overview\'s name for its directory, else by the directory', () => {
    const named = outputRun(cleanups, { overview: true });
    expect(assemble(named, 'product').status).toBe(0);
    const chapter = section(text(named, 'handbook.md'), `## ${ui['md.findings.heading']}`);
    expect(chapter).toContain(`- F1 Orders; Shop service (application): ${F1_TEXT}\n  - Shop service (application): ${SYSTEM_SERVER_TEXT}`);
    expect(chapter).not.toContain('alpha (application)');
    expect(assemble(shared(), 'product').status).toBe(0);
    expect(text(shared(), 'handbook.md')).toContain('alpha (application)');
  });

  it('the same input gives the same bytes', () => {
    const run = shared();
    assemble(run, 'product,technical');
    const first = [text(run, 'handbook.md'), text(run, 'handbook-technical.md')];
    assemble(run, 'product,technical');
    expect([text(run, 'handbook.md'), text(run, 'handbook-technical.md')]).toEqual(first);
  });
});

describe('findingsChapter and featureFindingsLines on a model: merged groups', () => {
  const t = (key) => ui[key];
  const owner = (kind, id, name) => ({ kind, id, name });
  const f1 = owner('feature', 'F1', 'Orders');
  const f2 = owner('feature', 'F2', 'Reports');
  const app = owner('application', 'app1', 'alpha');
  const row = (id, who, category, body) => ({ id, owner: who, category, text: body });
  const rows = [row('F1.findings[0]', f1, 'display', 'one'), row('F2.findings[0]', f2, 'display', 'two'), row('app1.system[0]', app, 'display', 'three'), row('F2.findings[1]', f2, 'time', 'four')];
  const groups = [
    { category: 'display', owners: [f1, f2, app], items: rows.slice(0, 3) },
    { category: 'time', owners: [f2], items: [rows[3]] },
  ];
  const map = { features: [{ id: 'F1', name: 'Orders' }, { id: 'F2', name: 'Reports' }] };
  const state = { findings: { F1: { status: 'verified' }, F2: { status: 'verified' } }, systemFindings: { app1: { status: 'verified' } } };
  const findings = { list: rows, groups, locations: null, applications: [{ id: 'app1', name: 'alpha', status: 'verified', removed: [] }] };

  it('writes three owners once on the first line and two statements under it', () => {
    const lines = findingsChapter({ map, state, findings, view: 'product', t });
    expect(lines).toContain('- F1 Orders; F2 Reports; alpha (application): one');
    expect(lines).toContain('  - F2 Reports: two');
    expect(lines).toContain('  - alpha (application): three');
    expect(lines).toContain('- F2 Reports: four');
    expect(lines.find((line) => line.startsWith('Findings: '))).toContain('Findings: 2. Statements: 4. Groups merged: 1.');
  });

  it('a feature section still lists its own findings, also the ones in a merged group, and none of an application', () => {
    const own = featureFindingsLines('F2', { state, findings, t });
    expect(own.filter((line) => line.startsWith('- '))).toEqual([`- ${ui[categoryKey('display')]}: two`, `- ${ui[categoryKey('time')]}: four`]);
    expect(featureFindingsLines('F1', { state, findings, t }).filter((line) => line.startsWith('- '))).toEqual([`- ${ui[categoryKey('display')]}: one`]);
  });
});

describe('the coverage section lists the system units', () => {
  it('lists the application roots whose unit is not verified with where it stopped, and the removed system findings with their reasons', () => {
    const run = shared();
    assemble(run, 'product');
    const coverage = section(text(run, 'handbook.md'), `## ${ui['md.coverage.heading']}`);
    const unfinished = section(coverage, `### ${ui['md.coverage.findingsUnfinishedHeading']}`);
    expect(unfinished).toContain(`| beta (application) | ${ui['md.status.checked']} |`);
    expect(unfinished).not.toContain('alpha (application) |');
    expect(unfinished).not.toContain('gamma');
    const removed = section(coverage, `### ${ui['md.coverage.findingsRemovedHeading']}`);
    expect(removed).toContain('#### alpha (application): findings removed: 1');
    expect(removed).toContain(`| System finding > ${ui[categoryKey('security')]} > ${SYSTEM_REMOVED_TEXT} | ${ui['md.verdict.contradicted']} | ${REMOVED_REASON} |`);
  });

  it('system units never written are one count line, not one row each; all verified says so', () => {
    const run = makeSystemRun();
    cleanups.push(run.cleanup);
    expect(assemble(run, 'product').status).toBe(0);
    const part = section(section(text(run, 'handbook.md'), `## ${ui['md.coverage.heading']}`), `### ${ui['md.coverage.findingsUnfinishedHeading']}`);
    expect(part).toContain('The system findings of 3 application roots were not written.');
    expect(part).not.toContain('|');
    expect(page(run).status).toBe(0);
    expect(dataOf(run).coverage).toMatchObject({ systemFindingsTotal: 3, systemFindingsNotWritten: 3, systemFindingsUnfinished: [], systemFindingsRemoved: [] });

    for (const n of [1, 2]) {
      run.writeSystem(n, { ...run.systemDoc(n), findings: [], unknowns: [] });
      expect(run.run('check-system-findings', systemId(n)).status).toBe(0);
    }
    expect(run.run('check-system-findings', systemId(3)).status).toBe(0);
    assemble(run, 'product');
    const done = section(section(text(run, 'handbook.md'), `## ${ui['md.coverage.heading']}`), `### ${ui['md.coverage.findingsUnfinishedHeading']}`);
    expect(done).toContain(ui['md.coverage.systemFindingsAllVerified']);
    expect(done).not.toContain('The system findings of 3 application roots');
  });
});

describe('verified system findings are checked again like an entry', () => {
  it('refuses a system unit whose file changed after it was verified, one that no longer passes its check, and one the state records for another root', () => {
    const run = outputRun();
    const doc = JSON.parse(readFileSync(join(run.out, 'entries', 'app1.system.json'), 'utf-8'));
    doc.findings[1].text = 'The mail helper reports each message as sent without sending anything.';
    run.writeSystem(1, doc);
    const changed = assemble(run, 'product');
    expect(changed.status).toBe(1);
    expect(changed.lines).toContain('app1.system: entries/app1.system.json changed after it was verified; run check-system-findings for app1.system and verify it again');
    const spoiled = JSON.parse(JSON.stringify(doc));
    spoiled.findings[1].evidence[0].passage = 'return { to, sent: false };';
    run.writeSystem(1, spoiled);
    const broken = page(run);
    expect(broken.status).toBe(1);
    expect(broken.lines).toContain('app1.system: entries/app1.system.json no longer passes check-system-findings; run check-system-findings for app1.system');
    run.writeSystem(1, doc);
    expect(run.run('check-system-findings', systemId(1)).status).toBe(0);

    const moved = outputRun();
    const state = moved.readState();
    state.systemFindings.app1.root = 'elsewhere';
    moved.writeState(state);
    const refused = assemble(moved, 'product');
    expect(refused.status).toBe(1);
    expect(refused.lines.join('\n')).toContain('--fresh');
  });

  it('a unit of a system findings file that cites a file of one feature only is refused when it is checked again', () => {
    const run = outputRun();
    const doc = JSON.parse(readFileSync(join(run.out, 'entries', 'app1.system.json'), 'utf-8'));
    doc.findings[0].evidence = [ev('alpha/src/routes/orders.js', ROUTE(1))];
    run.writeSystem(1, doc);
    const result = assemble(run, 'product');
    expect(result.status).toBe(1);
    expect(result.lines.some((line) => line.includes('seed file of feature F1'))).toBe(true);
  });
});

describe('the page data', () => {
  it('has the format /10 and the findings as groups with their owners and items, in the order of the handbook, and no citation path outside the technical part', () => {
    const run = shared();
    const made = page(run);
    expect(made.status, made.stdout).toBe(0);
    const data = dataOf(run);
    expect(data.format).toBe('excavator-product-handbook-page/10');
    expect(data.findings.map((group) => [group.category, group.owners.map((one) => [one.kind, one.id, one.name]), group.items.map((one) => one.id)])).toEqual([
      ['other', [['feature', 'F1', 'Orders'], ['application', 'app1', 'alpha']], ['F1.findings[0]', 'app1.system[0]']],
      ['time', [['feature', 'F3', 'Nightly run'], ['application', 'app1', 'alpha']], ['F3.findings[0]', 'app1.system[2]']],
      ['notification', [['application', 'app1', 'alpha']], ['app1.system[1]']],
    ]);
    expect(Object.keys(data.findings[0])).toEqual(['category', 'owners', 'items']);
    expect(Object.keys(data.findings[0].items[0])).toEqual(['id', 'owner', 'text']);
    expect(data.findings[0].items.map((one) => one.text)).toEqual([F1_TEXT, SYSTEM_SERVER_TEXT]);
    expect(JSON.stringify({ ...data, technical: undefined })).not.toContain(SERVER);
    expect(data.technical.findingLocations.map((place) => place.id)).toEqual(['F1.findings[0]', 'app1.system[0]', 'F3.findings[0]', 'app1.system[2]', 'app1.system[1]']);
    expect(data.technical.findingLocations[1].citations).toEqual([{ file: SERVER, startLine: 5, endLine: 5 }]);
  });

  it('names an application by the verified overview\'s name in the owners', () => {
    const run = outputRun(cleanups, { overview: true });
    expect(page(run, 'product').status).toBe(0);
    const data = dataOf(run);
    expect(data.findings[0].owners[1]).toEqual({ kind: 'application', id: 'app1', name: 'Shop service' });
    expect(data.technical).toBeUndefined();
  });

  it('has the system units in the coverage part: the total, the unit not verified, the removed finding', () => {
    const run = shared();
    page(run, 'product');
    const { coverage } = dataOf(run);
    expect(coverage.systemFindingsTotal).toBe(3);
    expect(coverage.systemFindingsUnfinished).toEqual([{ id: 'app2', name: 'beta', status: 'checked' }]);
    expect(coverage.systemFindingsNotWritten).toBe(0);
    expect(coverage.systemFindingsRemoved).toEqual([{ id: 'app1', name: 'alpha', items: [{ claim: `System finding > ${ui[categoryKey('security')]} > ${SYSTEM_REMOVED_TEXT}`, verdict: 'contradicted', reason: REMOVED_REASON }] }]);
  });

  it('is the same bytes from the same input', () => {
    const run = shared();
    page(run);
    const first = text(run, 'handbook.html');
    page(run);
    expect(text(run, 'handbook.html')).toBe(first);
  });
});
