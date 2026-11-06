// O2 (output) of openspec change handbook-remedies: the common cause and the
// measure are under each category heading of the Findings chapter before its
// groups; the Recommendations chapter follows the Findings chapter, numbered in
// order, each recommendation with its text, the groups it rests on (level and
// statement; file and line in the technical view only) and the facts it rests
// on in words; the coverage section lists what the judges left out with their
// reasons and says when the remedies did not finish or were written for other
// findings; and the page data is /12 with `remedies`.
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { categoryKey } from '../../../skills/excavator-product-handbook/lib/findings-shape.mjs';
import { runHandbook, verifyChecked } from './helpers.mjs';
import { unitId } from './findings-fixture.mjs';
import { checkedRemediesRun, judgeRemedies, rankedRun, writeSharedTables } from './remedies-fixture.mjs';

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
const text = (run, name) => readFileSync(join(run.out, name), 'utf-8');
const assemble = (run, views = 'product') => run.run('assemble', '--views', views);
const page = (run, views = 'product,technical') => runHandbook(['page', run.out, '--project', run.root, '--views', views], { env: { ...process.env, EXCAVATOR_PRODUCT_HANDBOOK_PAGE_TEMPLATE: stubPath } });
const dataOf = (run) => JSON.parse(/<script type="application\/json" id="xv-product-handbook-data">([\s\S]*?)<\/script>/.exec(text(run, 'handbook.html'))[1]);

const DELETE = 'Deleting an order asks nothing about who calls: the handler removes the order and answers success to every caller.';
const LIST = 'The list of orders is always empty, whatever was created.';

/** The part of the handbook between a heading and the next heading of the same or a higher level. */
function section(body, heading) {
  const level = heading.match(/^#+/)[0].length;
  const start = body.indexOf(`\n${heading}\n`);
  expect(start, heading).toBeGreaterThanOrEqual(0);
  const rest = body.slice(start + heading.length + 2);
  const end = rest.search(new RegExp(`^#{1,${level}} `, 'm'));
  return end === -1 ? rest : rest.slice(0, end);
}
const findingsOf = (body) => section(body, `## ${ui['md.findings.heading']}`);
const recommendationsOf = (body) => section(body, `## ${ui['md.remedies.heading']}`);
const coverageRemedies = (body) => section(section(body, `## ${ui['md.coverage.heading']}`), `### ${ui['md.coverage.remediesHeading']}`);

// The tests that only read share one verified run (it takes seconds to build); the ones that change it build their own.
const sharedCleanups = [];
let sharedRun = null;
function shared() {
  if (sharedRun === null) {
    sharedRun = checkedRemediesRun(sharedCleanups, (doc) => {
      doc.recommendations[1].cites = [doc.recommendations[1].cites[0], 'tables-shared'];
      doc.recommendations[1].text = 'The list of orders should answer from the store, and no table is shared.';
      doc.recommendations[1].cites.push('app:.');
      return doc;
    });
    expect(judgeRemedies(sharedRun).status).toBe(0);
  }
  return sharedRun;
}
afterAll(() => {
  while (sharedCleanups.length > 0) sharedCleanups.pop()();
});

describe('the Findings chapter with remedies', () => {
  it('writes the common cause and the measure under the heading of a category, before its groups, and nothing under a category without them', () => {
    const run = shared();
    expect(assemble(run).status).toBe(0);
    const chapter = findingsOf(text(run, 'handbook.md'));
    const authorization = chapter.slice(chapter.indexOf(`### ${ui[categoryKey('authorization')]}`), chapter.indexOf(`### ${ui[categoryKey('error-handling')]}`));
    expect(authorization).toContain('Common cause: Deleting an order asks nothing about who calls.\n\nMeasure: Put one check of the caller in front of every operation on orders.\n\n- [P0]');
    expect(authorization.indexOf('Common cause:')).toBeLessThan(authorization.indexOf('- [P0]'));
    const errorHandling = chapter.slice(chapter.indexOf(`### ${ui[categoryKey('error-handling')]}`), chapter.indexOf(`### ${ui[categoryKey('hard-coded')]}`));
    expect(errorHandling).not.toContain('Common cause:');
    expect(chapter.match(/^Common cause: /gm)).toHaveLength(2);
    expect(chapter.match(/^Measure: /gm)).toHaveLength(2);
  });

  it('is the same in the technical view', () => {
    const run = shared();
    expect(assemble(run, 'product,technical').status).toBe(0);
    expect(findingsOf(text(run, 'handbook-technical.md'))).toContain('Common cause: The list of orders is a fixed empty answer.\n\nMeasure: Read the orders from the store instead of answering a fixed list.');
  });
});

describe('the Recommendations chapter', () => {
  it('comes after the Findings chapter and before the coverage section, with its note and counts', () => {
    const run = shared();
    assemble(run);
    const body = text(run, 'handbook.md');
    const at = (heading) => body.indexOf(`\n## ${heading}\n`);
    expect(at(ui['md.findings.heading'])).toBeLessThan(at(ui['md.remedies.heading']));
    expect(at(ui['md.remedies.heading'])).toBeLessThan(at(ui['md.coverage.heading']));
    const chapter = recommendationsOf(body);
    expect(chapter).toContain(ui['md.remedies.note']);
    expect(chapter).toContain('Recommendations: 2. Groups of findings they rest on: 2 of 4.');
  });

  it('numbers the recommendations in order, each with its title, its text, then the groups it rests on (level, category and statement) and the facts in words', () => {
    const run = shared();
    assemble(run);
    const chapter = recommendationsOf(text(run, 'handbook.md'));
    expect(chapter.indexOf('### 1. Check the caller first')).toBeGreaterThan(-1);
    expect(chapter.indexOf('### 2. Replace the fixed list')).toBeGreaterThan(chapter.indexOf('### 1. Check the caller first'));
    const first = chapter.slice(chapter.indexOf('### 1.'), chapter.indexOf('### 2.'));
    expect(first).toContain('Start with the 1 finding of the highest level, which lets any caller delete an order, and give it a check of the caller.');
    expect(first).toContain(`Findings it rests on:\n\n- [P0] ${ui[categoryKey('authorization')]}: ${DELETE}`);
    expect(first).toContain('Facts it rests on:\n\n- Groups of findings: 4. By priority: P0: 1; P1: 2; P2: 1; Unranked: 0. By category: ');
    const second = chapter.slice(chapter.indexOf('### 2.'));
    expect(second).toContain(`- [P2] ${ui[categoryKey('hard-coded')]}: ${LIST}`);
    expect(second).toMatch(/- Tables mentioned by two or more applications: not known, the data section was not written\./);
    expect(second).toMatch(/- Application \.: main language JavaScript, \d+ source files, \d+ lines, no version history\./);
  });

  it('writes no file or line in the product view and the file and line of each cited statement in the technical view', () => {
    const run = shared();
    assemble(run, 'product,technical');
    expect(recommendationsOf(text(run, 'handbook.md'))).not.toContain('src/routes');
    const technical = recommendationsOf(text(run, 'handbook-technical.md'));
    expect(technical).toContain(`- [P0] ${ui[categoryKey('authorization')]}: ${DELETE} (src/routes/orders.js, line 7)`);
  });

  it('writes the tables the data section shares, from the script facts, in words', () => {
    const run = rankedRun(cleanups);
    writeSharedTables(run, [{ name: 'orders', mentions: { '.': 1, billing: 1 } }, { name: 'carts', mentions: { '.': 1, web: 1 } }, { name: 'solo', mentions: { '.': 2 } }]);
    expect(run.run('mark', 'remedies', 'dispatched').status).toBe(0);
    const doc = run.goodRemedies();
    doc.recommendations[1] = { title: 'Split the tables', text: 'The 2 tables that several applications use should be split.', cites: ['tables-shared'] };
    run.writeRemedies(doc);
    expect(run.run('check-remedies').status).toBe(0);
    expect(judgeRemedies(run).status).toBe(0);
    assemble(run);
    expect(recommendationsOf(text(run, 'handbook.md'))).toContain('Facts it rests on:\n\n- Tables mentioned by two or more applications: 2 (carts in ., web; orders in ., billing).');
  });

  it('writes nothing of remedies that were written before the data section appeared: the facts are other facts, and the coverage says so', () => {
    const run = checkedRemediesRun(cleanups);
    judgeRemedies(run);
    writeSharedTables(run, [{ name: 'orders', mentions: { '.': 1, billing: 1 } }]);
    assemble(run);
    const body = text(run, 'handbook.md');
    expect(body).not.toContain('Common cause:');
    expect(coverageRemedies(body)).toContain(ui['md.coverage.remediesStale']);
  });

  it('has the same bytes from the same input', () => {
    const run = shared();
    assemble(run, 'product,technical');
    const first = [text(run, 'handbook.md'), text(run, 'handbook-technical.md')];
    assemble(run, 'product,technical');
    expect([text(run, 'handbook.md'), text(run, 'handbook-technical.md')]).toEqual(first);
  });
});

describe('what the judges left out and what did not finish', () => {
  it('writes a recommendation that one judge refused nowhere, numbers the others again from 1 and lists the refused one in the coverage section with the reason', () => {
    const run = checkedRemediesRun(cleanups);
    expect(judgeRemedies(run, (item, letter) => (item.id === 'recommendation:1' && letter === 'a' ? { verdict: 'doesNotFollow', reason: 'The text says one finding, which no cited fact says.' } : 'follows')).status).toBe(0);
    assemble(run);
    const body = text(run, 'handbook.md');
    const chapter = recommendationsOf(body);
    expect(chapter).not.toContain('Check the caller first');
    expect(chapter).toContain('### 1. Replace the fixed list');
    expect(chapter).toContain('Recommendations: 1. Groups of findings they rest on: 1 of 4.');
    const part = coverageRemedies(body);
    expect(part).toContain('Left out because a judge found a statement of how things are now that the cited findings and facts do not hold: 1.');
    expect(part).toContain('| Left out | Reason |');
    expect(part).toContain('| Check the caller first: Start with the 1 finding of the highest level, which lets any caller delete an order, and give it a check of the caller. | The text says one finding, which no cited fact says. |');
  });

  it('leaves out a paragraph of a category the same way: no cause or measure under the heading, a row in the coverage section', () => {
    const run = checkedRemediesRun(cleanups);
    judgeRemedies(run, (item, letter) => (item.id === 'category:authorization' && letter === 'b' ? { verdict: 'doesNotFollow', reason: 'The cause is wider than the statement.' } : 'follows'));
    assemble(run);
    const body = text(run, 'handbook.md');
    expect(findingsOf(body)).not.toContain('Deleting an order asks nothing about who calls.\n\nMeasure');
    expect(findingsOf(body)).toContain('Common cause: The list of orders is a fixed empty answer.');
    expect(coverageRemedies(body)).toContain(`| ${ui[categoryKey('authorization')]}: Deleting an order asks nothing about who calls. | The cause is wider than the statement. |`);
  });

  it('says that every written paragraph is in the handbook when the judges left none out', () => {
    const run = shared();
    assemble(run);
    expect(coverageRemedies(text(run, 'handbook.md')).trim()).toBe(ui['md.coverage.remediesAllKept']);
  });

  it('says the remedies did not finish, writes none and keeps the findings, when the unit is only checked, failed or never written', () => {
    const run = checkedRemediesRun(cleanups);
    assemble(run);
    let body = text(run, 'handbook.md');
    expect(coverageRemedies(body)).toContain(ui['md.coverage.remediesNotFinished']);
    expect(body).not.toContain('Common cause:');
    expect(recommendationsOf(body)).toContain(ui['md.remedies.none']);
    expect(findingsOf(body)).toContain('- [P0] ');
    const never = checkedRemediesRun(cleanups);
    const state = never.readState();
    delete state.remedies;
    never.writeJson(join(never.out, 'state.json'), state);
    assemble(never);
    body = text(never, 'handbook.md');
    expect(coverageRemedies(body)).toContain(ui['md.coverage.remediesNotFinished']);
  });

  it('ignores a remedies file whose facts are not the current ones, and says so', () => {
    const run = checkedRemediesRun(cleanups);
    judgeRemedies(run);
    const doc = run.findingsDoc('F3');
    doc.findings[0].text = 'The reminder goes out at one fixed time of day, whatever the time zone of the recipient.';
    run.writeFindings('F3', doc);
    expect(run.run('check-findings', unitId('F3')).status).toBe(0);
    verifyChecked(run, unitId('F3'));
    expect(assemble(run).status).toBe(0);
    const body = text(run, 'handbook.md');
    expect(body).not.toContain('Common cause:');
    expect(recommendationsOf(body)).toContain(ui['md.remedies.none']);
    expect(coverageRemedies(body)).toContain(ui['md.coverage.remediesStale']);
    expect(page(run).status).toBe(0);
    const data = dataOf(run);
    expect(data.remedies).toEqual({ categories: [], recommendations: [] });
    expect(data.coverage.remedies).toEqual({ finished: false, stale: true, dropped: [] });
  });

  it('writes no Recommendations chapter and says none in the coverage section when no finding is verified', () => {
    const run = shared();
    const state = run.readState();
    const kept = JSON.parse(JSON.stringify(state));
    state.findings = {};
    run.writeJson(join(run.out, 'state.json'), state);
    assemble(run);
    const body = text(run, 'handbook.md');
    expect(body).not.toContain(`\n## ${ui['md.remedies.heading']}\n`);
    expect(coverageRemedies(body).trim()).toBe(ui['md.none']);
    run.writeJson(join(run.out, 'state.json'), kept);
  });
});

describe('the page data', () => {
  it('has the format /12, remedies with the categories and the recommendations with their groups and facts, and the coverage of the remedies', () => {
    const run = shared();
    const made = page(run);
    expect(made.status, made.stdout).toBe(0);
    const data = dataOf(run);
    expect(data.format).toBe('excavator-product-handbook-page/12');
    expect(Object.keys(data).slice(data.findings === undefined ? 0 : Object.keys(data).indexOf('findings'), Object.keys(data).indexOf('findings') + 3)).toEqual(['findings', 'remedies', 'coverage']);
    expect(Object.keys(data.remedies)).toEqual(['categories', 'recommendations']);
    expect(data.remedies.categories).toEqual([
      { category: 'authorization', cause: 'Deleting an order asks nothing about who calls.', measure: 'Put one check of the caller in front of every operation on orders.' },
      { category: 'hard-coded', cause: 'The list of orders is a fixed empty answer.', measure: 'Read the orders from the store instead of answering a fixed list.' },
    ]);
    expect(data.remedies.recommendations).toHaveLength(2);
    const [first, second] = data.remedies.recommendations;
    expect(Object.keys(first)).toEqual(['title', 'text', 'groups', 'facts']);
    expect(first.groups).toEqual([{ id: 'F1.findings[0]', category: 'authorization', level: 'P0', text: DELETE }]);
    expect(first.facts).toEqual([{ kind: 'counts', groups: 4, levels: { P0: 1, P1: 2, P2: 1, unranked: 0 }, categories: [{ category: 'authorization', count: 1 }, { category: 'error-handling', count: 1 }, { category: 'hard-coded', count: 1 }, { category: 'time', count: 1 }] }]);
    expect(second.groups).toEqual([{ id: 'F1.findings[2]', category: 'hard-coded', level: 'P2', text: LIST }]);
    expect(second.facts.map((fact) => fact.kind)).toEqual(['tables', 'app']);
    expect(second.facts[0]).toEqual({ kind: 'tables', count: null, tables: [] });
    expect(second.facts[1]).toMatchObject({ kind: 'app', name: '.', commits: null, authors: null });
    expect(data.coverage.remedies).toEqual({ finished: true, stale: false, dropped: [] });
    expect(JSON.stringify(data.remedies)).not.toContain('src/');
  });

  it('lists what the judges left out in the coverage', () => {
    const run = checkedRemediesRun(cleanups);
    judgeRemedies(run, (item, letter) => (item.id === 'recommendation:2' ? { verdict: 'doesNotFollow', reason: `Judge ${letter} did not find it in the facts.` } : 'follows'));
    expect(page(run).status).toBe(0);
    const data = dataOf(run);
    expect(data.remedies.recommendations).toHaveLength(1);
    expect(data.coverage.remedies).toEqual({
      finished: true,
      stale: false,
      dropped: [{ id: 'recommendation:2', kind: 'recommendation', text: 'The list of orders should answer from the store.', title: 'Replace the fixed list', reasons: ['Judge a did not find it in the facts.', 'Judge b did not find it in the facts.'] }],
    });
  });

  it('has no remedies and an unfinished coverage when the unit is not verified, and is the same bytes from the same input', () => {
    const run = checkedRemediesRun(cleanups);
    expect(page(run).status).toBe(0);
    const data = dataOf(run);
    expect(data.remedies).toEqual({ categories: [], recommendations: [] });
    expect(data.coverage.remedies).toEqual({ finished: false, stale: false, dropped: [] });
    const first = text(run, 'handbook.html');
    page(run);
    expect(text(run, 'handbook.html')).toBe(first);
  });
});
