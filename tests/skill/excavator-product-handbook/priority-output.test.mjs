// O2 (output) of openspec change handbook-findings-priority: the level and the
// reason are in the line of each group of the Findings chapter (both views),
// the groups of a category are in the order P0, P1, P2, unranked with the
// original order kept inside a level, the counts line and each category
// heading say how many groups have which level, the coverage section lists the
// unranked groups with the reasons of the judges and says when the ranking did
// not finish, an old ranking is not used for a group whose statement changed,
// and the page data is /11 with a priority for each group.
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { categoryKey } from '../../../skills/excavator-product-handbook/lib/findings-shape.mjs';
import { runHandbook, verifyChecked } from './helpers.mjs';
import { findingsRun, unitId } from './findings-fixture.mjs';
import { judgeAll, withPriorityHelpers } from './priority-fixture.mjs';

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
const AUTH = ui[categoryKey('authorization')];
const text = (run, name) => readFileSync(join(run.out, name), 'utf-8');
const assemble = (run, views = 'product') => run.run('assemble', '--views', views);
const page = (run, views = 'product,technical') => runHandbook(['page', run.out, '--project', run.root, '--views', views], { env: { ...process.env, EXCAVATOR_PRODUCT_HANDBOOK_PAGE_TEMPLATE: stubPath } });
const dataOf = (run) => JSON.parse(/<script type="application\/json" id="xv-product-handbook-data">([\s\S]*?)<\/script>/.exec(text(run, 'handbook.html'))[1]);

const STATEMENTS = [
  'Deleting an order asks nothing about who calls: the handler removes the order and answers success to every caller.',
  'Creating an order answers that it was created without reading or storing anything.',
  'The list of orders is always empty, whatever was created.',
  'Reminders go out to every recipient without asking who owns the order.',
];
const REASONS = [
  'Any caller can remove an order that is not theirs.',
  'A caller who creates an order is told it worked although nothing was stored.',
  'A caller who opens the list always sees it empty.',
  'The reminder reaches people who do not own the order.',
];

/** The part of the handbook between a heading and the next heading of the same or a higher level. */
function section(body, heading) {
  const level = heading.match(/^#+/)[0].length;
  const start = body.indexOf(`\n${heading}\n`);
  expect(start, heading).toBeGreaterThanOrEqual(0);
  const rest = body.slice(start + heading.length + 2);
  const end = rest.search(new RegExp(`^#{1,${level}} `, 'm'));
  return end === -1 ? rest : rest.slice(0, end);
}

/** The findings chapter of the product handbook. */
const chapterOf = (body) => section(body, `## ${ui['md.findings.heading']}`);

/**
 * Four groups of one category (the three findings of F1 and the one of F3), in this order in the handbook:
 * delete, create, list, reminder; all verified. Nothing is ranked yet.
 */
function sameCategoryRun(owner = cleanups) {
  const run = findingsRun(owner);
  const f1 = run.findingsDoc('F1');
  f1.findings.forEach((finding, index) => Object.assign(finding, { category: 'authorization', text: STATEMENTS[index] }));
  const f3 = run.findingsDoc('F3');
  Object.assign(f3.findings[0], { category: 'authorization', text: STATEMENTS[3] });
  for (const [featureId, doc] of [['F1', f1], ['F3', f3]]) {
    run.writeFindings(featureId, doc);
    expect(run.run('check-findings', unitId(featureId)).status).toBe(0);
    verifyChecked(run, unitId(featureId));
  }
  withPriorityHelpers(run);
  run.allKeys = run.keys();
  return run;
}

/** Rank the groups in order with `consequences` (one per group), then judge them with `decide`; the unit ends verified. */
function rank(run, consequences, decide) {
  expect(run.run('mark', 'priority', 'dispatched').status).toBe(0);
  run.writePart(1, run.allKeys.map((key, index) => ({ key, consequence: consequences[index], reason: REASONS[index] })));
  expect(run.run('check-priority').status).toBe(0);
  const result = judgeAll(run, decide);
  expect(result.status, result.stdout).toBe(0);
}

const sharedCleanups = [];
let sharedRun = null;
/** P1, P0, P1 and one the judges left unranked: delete, create, list, reminder. */
const shared = () => {
  if (sharedRun === null) {
    sharedRun = sameCategoryRun(sharedCleanups);
    rank(sharedRun, ['wrongResult', 'othersRecords', 'wrongResult', 'inert'], (group, letter) => (group.consequence === 'inert' && letter === 'b' ? { verdict: 'doesNotFollow', reason: 'The reason names people who are not in the statement.' } : 'follows'));
  }
  return sharedRun;
};
afterAll(() => {
  while (sharedCleanups.length > 0) sharedCleanups.pop()();
});

describe('the Findings chapter with a priority', () => {
  it('starts each group with its level and ends its line with the reason; a group no judge confirmed starts with the word for none and has no reason', () => {
    const run = shared();
    expect(assemble(run).status).toBe(0);
    const chapter = chapterOf(text(run, 'handbook.md'));
    expect(chapter).toContain(`- [P0] F1 Orders: ${STATEMENTS[1]} Reason: ${REASONS[1]}\n`);
    expect(chapter).toContain(`- [P1] F1 Orders: ${STATEMENTS[0]} Reason: ${REASONS[0]}\n`);
    expect(chapter).toContain(`- [P1] F1 Orders: ${STATEMENTS[2]} Reason: ${REASONS[2]}\n`);
    expect(chapter).toContain(`- [Unranked] F3 Reminders: ${STATEMENTS[3]}\n`);
    expect(chapter).not.toContain(REASONS[3]);
  });

  it('puts the groups of a category in the order P0, P1, P2, unranked, and keeps the order the handbook had inside a level', () => {
    const run = shared();
    assemble(run);
    const lines = chapterOf(text(run, 'handbook.md')).split('\n').filter((line) => line.startsWith('- ['));
    expect(lines.map((line) => /^- \[([^\]]+)\] \S+ \S+: (.{20})/.exec(line).slice(1, 3))).toEqual([
      ['P0', STATEMENTS[1].slice(0, 20)],
      ['P1', STATEMENTS[0].slice(0, 20)],
      ['P1', STATEMENTS[2].slice(0, 20)],
      ['Unranked', STATEMENTS[3].slice(0, 20)],
    ]);
  });

  it('has a P2 group between P1 and the unranked ones', () => {
    const run = sameCategoryRun();
    rank(run, ['display', 'inert', 'blocked', 'money'], (group, letter) => (group.consequence === 'money' && letter === 'a' ? { verdict: 'doesNotFollow', reason: 'The statement does not say anything about an amount.' } : 'follows'));
    assemble(run);
    const levels = chapterOf(text(run, 'handbook.md')).split('\n').filter((line) => line.startsWith('- [')).map((line) => /^- \[([^\]]+)\]/.exec(line)[1]);
    expect(levels).toEqual(['P1', 'P2', 'P2', 'Unranked']);
  });

  it('writes the counts of each level and of the unranked ones on the counts line, and after each category heading the number of groups and of P0', () => {
    const run = shared();
    assemble(run);
    const chapter = chapterOf(text(run, 'handbook.md'));
    const line = chapter.split('\n').find((candidate) => candidate.startsWith('Findings: '));
    expect(line).toContain('By priority: P0: 1; P1: 2; P2: 0; Unranked: 1.');
    expect(chapter).toContain(`### ${AUTH} (4 findings; P0: 1)`);
    expect(chapter.split('\n').filter((row) => row.startsWith('### '))).toHaveLength(1);
  });

  it('is the same in the technical view, which adds the file and line after the statement and before the reason', () => {
    const run = shared();
    expect(assemble(run, 'product,technical').status).toBe(0);
    const technical = chapterOf(text(run, 'handbook-technical.md'));
    expect(technical).toContain(`- [P0] F1 Orders: ${STATEMENTS[1]} (src/routes/orders.js, line 6) Reason: ${REASONS[1]}`);
    expect(technical).toContain(`- [Unranked] F3 Reminders: ${STATEMENTS[3]} (src/jobs/reminders.js, line 4)`);
    expect(technical).toContain('By priority: P0: 1; P1: 2; P2: 0; Unranked: 1.');
    expect(text(run, 'handbook.md')).not.toContain('src/routes');
  });

  it('gives the same bytes for the same input', () => {
    const run = shared();
    assemble(run, 'product,technical');
    const first = [text(run, 'handbook.md'), text(run, 'handbook-technical.md')];
    assemble(run, 'product,technical');
    expect([text(run, 'handbook.md'), text(run, 'handbook-technical.md')]).toEqual(first);
  });
});

describe('the coverage section about the ranking', () => {
  it('lists the unranked groups with the reasons of the judges and their number', () => {
    const run = shared();
    assemble(run);
    const part = section(section(text(run, 'handbook.md'), `## ${ui['md.coverage.heading']}`), `### ${ui['md.coverage.priorityHeading']}`);
    expect(part).toContain('Groups of findings without a priority: 1.');
    expect(part).toContain(`| ${ui['md.findings.claimLabel']} | ${ui['md.table.reason']} |`);
    expect(part).toContain(`| ${AUTH}: ${STATEMENTS[3]} | The reason names people who are not in the statement. |`);
    expect(part).not.toContain('did not finish');
  });

  it('says that every group has a priority when none is unranked', () => {
    const run = sameCategoryRun();
    rank(run, ['money', 'dataLoss', 'secret', 'blocked'], () => 'follows');
    assemble(run);
    const part = section(section(text(run, 'handbook.md'), `## ${ui['md.coverage.heading']}`), `### ${ui['md.coverage.priorityHeading']}`);
    expect(part).toContain(ui['md.coverage.priorityAllRanked']);
    expect(chapterOf(text(run, 'handbook.md'))).toContain('By priority: P0: 3; P1: 1; P2: 0; Unranked: 0.');
  });

  it('says that the ranking did not finish, and writes every group as unranked, when the unit is not verified', () => {
    const run = sameCategoryRun();
    assemble(run);
    const body = text(run, 'handbook.md');
    const part = section(section(body, `## ${ui['md.coverage.heading']}`), `### ${ui['md.coverage.priorityHeading']}`);
    expect(part).toContain('The ranking did not finish: 4 groups of findings have no priority.');
    const lines = chapterOf(body).split('\n').filter((line) => line.startsWith('- ['));
    expect(lines).toHaveLength(4);
    for (const line of lines) expect(line.startsWith('- [Unranked] ')).toBe(true);
    expect(chapterOf(body)).toContain('By priority: P0: 0; P1: 0; P2: 0; Unranked: 4.');
  });

  it('says the same for a unit that failed its check, and for one that was checked but not judged', () => {
    const run = sameCategoryRun();
    run.run('mark', 'priority', 'dispatched');
    run.writePart(1, []);
    expect(run.run('check-priority').status).toBe(1);
    assemble(run);
    expect(text(run, 'handbook.md')).toContain('The ranking did not finish: 4 groups');
    run.writePart(1, run.allKeys.map((key, index) => ({ key, consequence: 'display', reason: REASONS[index] })));
    expect(run.run('check-priority').status).toBe(0);
    assemble(run);
    expect(text(run, 'handbook.md')).toContain('The ranking did not finish: 4 groups');
  });

  it('writes none when there is no verified finding', () => {
    const run = findingsRun(cleanups);
    run.writeEntry('F1');
    expect(run.run('check-entry', 'F1').status).toBe(0);
    verifyChecked(run, 'F1');
    assemble(run);
    const part = section(section(text(run, 'handbook.md'), `## ${ui['md.coverage.heading']}`), `### ${ui['md.coverage.priorityHeading']}`);
    expect(part.trim()).toBe(ui['md.none']);
  });
});

describe('an old ranking is not used for a group that changed', () => {
  it('does not write the rank of a group whose statement was rewritten after the ranking, lists it with the fixed reason, and keeps the others', () => {
    const run = sameCategoryRun();
    rank(run, ['wrongResult', 'othersRecords', 'display', 'money'], () => 'follows');
    // The statement of the reminder is rewritten and verified again; the ranking is as it was.
    const doc = run.findingsDoc('F3');
    Object.assign(doc.findings[0], { category: 'authorization', text: 'Reminders go out to every recipient and say nothing about who owns the order.' });
    run.writeFindings('F3', doc);
    expect(run.run('check-findings', unitId('F3')).status).toBe(0);
    verifyChecked(run, unitId('F3'));
    expect(assemble(run).status).toBe(0);
    const body = text(run, 'handbook.md');
    const chapter = chapterOf(body);
    expect(chapter).toContain(`- [P0] F1 Orders: ${STATEMENTS[1]} Reason: ${REASONS[1]}`);
    expect(chapter).toContain('- [Unranked] F3 Reminders: Reminders go out to every recipient and say nothing about who owns the order.');
    expect(chapter).not.toContain(REASONS[3]);
    expect(chapter).toContain('By priority: P0: 1; P1: 1; P2: 1; Unranked: 1.');
    const part = section(section(body, `## ${ui['md.coverage.heading']}`), `### ${ui['md.coverage.priorityHeading']}`);
    expect(part).toContain(ui['md.priority.notJudged']);
    // The next priority-items lists every group again, the changed one with its new key.
    expect(run.run('priority-items').lines).toHaveLength(4);
  });

  it('writes no rank at all when the priority file is not the one the judges saw', () => {
    const run = sameCategoryRun();
    rank(run, ['wrongResult', 'othersRecords', 'display', 'money'], () => 'follows');
    const file = run.readJson('entries/priority.json');
    file.items[1].consequence = 'display';
    run.writeJson(join(run.out, 'entries', 'priority.json'), file);
    expect(assemble(run).status).toBe(0);
    expect(chapterOf(text(run, 'handbook.md'))).toContain('By priority: P0: 0; P1: 0; P2: 0; Unranked: 4.');
    expect(text(run, 'handbook.md')).toContain('The ranking did not finish: 4 groups');
  });
});

describe('the page data', () => {
  it('has the format /11 and a priority { level, consequence, reason } or null for each group, in the order of the handbook', () => {
    const run = shared();
    const made = page(run);
    expect(made.status, made.stdout).toBe(0);
    const data = dataOf(run);
    expect(data.format).toBe('excavator-product-handbook-page/16');
    expect(data.findings.map((group) => group.priority)).toEqual([
      { level: 'P0', consequence: 'othersRecords', reason: REASONS[1] },
      { level: 'P1', consequence: 'wrongResult', reason: REASONS[0] },
      { level: 'P1', consequence: 'wrongResult', reason: REASONS[2] },
      null,
    ]);
    expect(Object.keys(data.findings[0])).toEqual(['category', 'owners', 'items', 'priority']);
    expect(Object.keys(data.findings[0].priority)).toEqual(['level', 'consequence', 'reason']);
    expect(data.coverage.priority).toEqual({
      finished: true,
      unranked: [{ id: 'F3.findings[0]', category: 'authorization', text: STATEMENTS[3], reasons: ['The reason names people who are not in the statement.'] }],
    });
  });

  it('has no priority and an unfinished ranking when the unit is not verified', () => {
    const run = sameCategoryRun();
    expect(page(run).status).toBe(0);
    const data = dataOf(run);
    expect(data.findings.map((group) => group.priority)).toEqual([null, null, null, null]);
    expect(data.coverage.priority.finished).toBe(false);
    expect(data.coverage.priority.unranked).toHaveLength(4);
  });

  it('is the same bytes from the same input', () => {
    const run = shared();
    page(run);
    const first = text(run, 'handbook.html');
    page(run);
    expect(text(run, 'handbook.html')).toBe(first);
  });
});
