// O2 (output) of openspec change handbook-topics: the Cross-cutting topics chapter comes after the Findings and Recommendations
// chapters and before the coverage section, one table per topic with a basis column (the technical view adds the file and line of
// each cited item), the data between domains also as a diagram the script draws from the kept rows, an empty topic says which
// entries it read and never that the system has none, the coverage lists the lanes with their status and the rows the judges left
// out with the reasons, and the page data is /13 with `topics`.
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runHandbook, verifyChecked } from './helpers.mjs';
import { unitId } from './findings-fixture.mjs';
import { checkedLane, checkedTopicsRun, judgeTopics, topicsRun } from './topics-fixture.mjs';

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
const assemble = (run, views = 'product') => {
  const result = run.run('assemble', '--views', views);
  expect(result.status, result.stdout + result.stderr).toBe(0);
  return result;
};
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
const chapterOf = (body) => section(body, `## ${ui['md.topics.heading']}`);
const topicOf = (body, topic) => section(chapterOf(body), `### ${ui[`md.topics.${topic}.heading`]}`);
const coverageTopics = (body) => section(section(body, `## ${ui['md.coverage.heading']}`), `### ${ui['md.coverage.topicsHeading']}`);

// The tests that only read share one run in which every lane is judged; the ones that change it build their own.
const sharedCleanups = [];
let sharedRun = null;
function shared() {
  if (sharedRun === null) {
    sharedRun = checkedTopicsRun(sharedCleanups);
    expect(judgeTopics(sharedRun).status).toBe(0);
  }
  return sharedRun;
}
afterAll(() => {
  while (sharedCleanups.length > 0) sharedCleanups.pop()();
});

describe('the Cross-cutting topics chapter', () => {
  it('comes after the Findings and Recommendations chapters and before the coverage section, with its note and counts', () => {
    const run = shared();
    assemble(run);
    const body = text(run, 'handbook.md');
    const at = (heading) => body.indexOf(`\n## ${heading}\n`);
    expect(at(ui['md.findings.heading'])).toBeLessThan(at(ui['md.remedies.heading']));
    expect(at(ui['md.remedies.heading'])).toBeLessThan(at(ui['md.topics.heading']));
    expect(at(ui['md.topics.heading'])).toBeLessThan(at(ui['md.coverage.heading']));
    const chapter = chapterOf(body);
    expect(chapter).toContain(ui['md.topics.note']);
    expect(chapter).toContain('Lanes: 3. Verified entries read: 2. Verified groups of findings read: 4. Rows: 5.');
  });

  it('writes one section for each topic, in the order of the table, each with its heading', () => {
    const run = shared();
    assemble(run);
    const headings = [...chapterOf(text(run, 'handbook.md')).matchAll(/^### (.+)$/gm)].map((match) => match[1]);
    expect(headings).toEqual(['approval', 'time', 'handoffs', 'access', 'repeated'].map((topic) => ui[`md.topics.${topic}.heading`]));
  });

  it('writes the approval table with the columns of the topic and a basis column, an empty column as a dash', () => {
    const run = shared();
    assemble(run);
    const part = topicOf(text(run, 'handbook.md'), 'approval');
    expect(part).toContain('| Business | Route | Skips and special cases | Extra conditions | Who can act | Basis |');
    expect(part).toContain('| Place an order | The clerk fills in the customer name. | - | The item count is limited to 35000. | Clerk | Orders: Place an order: The clerk fills in the customer name.<br>Orders: Place an order: The item count is limited to 35000.<br>Orders: Clerk: Create an order. |');
  });

  it('writes the time, access and repeated tables with their basis', () => {
    const run = shared();
    assemble(run);
    const body = text(run, 'handbook.md');
    expect(topicOf(body, 'time')).toContain('| Rule | Calendar or time zone | Applies to | Basis |');
    expect(topicOf(body, 'time')).toContain('| A reminder goes out every day at nine. | - | Reminders | Reminders: Every day at nine: A reminder goes out. |');
    expect(topicOf(body, 'access')).toContain('| Feature | Who can use it | Check on the page | Check on the server | Basis |');
    expect(topicOf(body, 'access')).toContain('| Orders | Clerk | - | - | Orders: Clerk: Create an order. |');
    expect(topicOf(body, 'repeated')).toContain('| What repeats | Where | Basis |');
    expect(topicOf(body, 'repeated')).toMatch(/\| Operations on orders answer success without reading or storing anything\. \| Orders \| \[Unranked\] .*Deleting an order asks nothing about who calls.*<br>\[Unranked\] .*Creating an order answers/);
  });

  it('writes the data between domains with the domain names and a diagram the script draws from the kept rows', () => {
    const run = shared();
    assemble(run);
    const part = topicOf(text(run, 'handbook.md'), 'handoffs');
    expect(part).toContain('| Provided by | Used by | Content | Basis |');
    expect(part).toContain('| Customer orders | System upkeep | The order was sent. | Reminders: Submitted: The order was sent. |');
    expect(part).toContain('```mermaid\nflowchart LR\n  D1["Customer orders"]\n  D2["System upkeep"]\n  D1 -->|"The order was sent."| D2\n```');
  });

  it('writes no file or line in the product view and the file and line of each cited item in the technical view, and the group places of a finding', () => {
    const run = shared();
    assemble(run, 'product,technical');
    expect(chapterOf(text(run, 'handbook.md'))).not.toContain('src/');
    const technical = chapterOf(text(run, 'handbook-technical.md'));
    expect(technical).toMatch(/Orders: Place an order: The clerk fills in the customer name\. \(src\/forms\/order-form\.js, line \d+\)/);
    expect(technical).toMatch(/\[Unranked\] .*Deleting an order asks nothing about who calls.*\(src\/routes\/orders\.js, line 7\)/);
  });

  it('has the same bytes from the same input', () => {
    const run = shared();
    assemble(run, 'product,technical');
    const first = [text(run, 'handbook.md'), text(run, 'handbook-technical.md')];
    assemble(run, 'product,technical');
    expect([text(run, 'handbook.md'), text(run, 'handbook-technical.md')]).toEqual(first);
  });
});

describe('a topic without a kept row', () => {
  it('names the number of verified entries it read and says they state none of it, and never that the system has none', () => {
    const run = topicsRun(cleanups);
    checkedLane(run, 'D1', (rows) => rows.slice(0, 1));
    checkedLane(run, 'D2', () => []);
    checkedLane(run, 'repeated', () => []);
    expect(judgeTopics(run).status).toBe(0);
    assemble(run);
    const body = text(run, 'handbook.md');
    expect(topicOf(body, 'time').trim()).toBe('The 2 verified entries it read state none of this.');
    expect(topicOf(body, 'handoffs').trim()).toBe('The 2 verified entries it read state none of this.');
    expect(topicOf(body, 'repeated').trim()).toBe('The 4 verified groups of findings it read hold none of this.');
    expect(topicOf(body, 'approval')).toContain('| Place an order |');
    expect(chapterOf(body).replace(ui['md.topics.note'], '')).not.toMatch(/system has no|no approval|does not have/i);
    expect(chapterOf(body)).not.toContain('```mermaid');
  });

  it('is also what a topic says when every row of it was left out by the judges', () => {
    const run = checkedTopicsRun(cleanups);
    expect(judgeTopics(run, (row) => (row.topic === 'approval' ? { verdict: 'doesNotFollow', reason: 'The row names a step that is not cited.' } : 'follows')).status).toBe(0);
    assemble(run);
    expect(topicOf(text(run, 'handbook.md'), 'approval').trim()).toBe('The 2 verified entries it read state none of this.');
  });
});

describe('what the judges left out and what did not finish', () => {
  it('writes a row that one judge refused nowhere and lists it in the coverage section with the reason', () => {
    const run = checkedTopicsRun(cleanups);
    expect(judgeTopics(run, (row, letter) => (row.id === 'D1#1' && letter === 'a' ? { verdict: 'doesNotFollow', reason: 'The row names a condition that no cited sentence says.' } : 'follows')).status).toBe(0);
    assemble(run);
    const body = text(run, 'handbook.md');
    expect(body.slice(body.indexOf(`## ${ui['md.topics.heading']}`), body.indexOf(`## ${ui['md.coverage.heading']}`))).not.toContain('| Place an order |');
    const part = coverageTopics(body);
    expect(part).toContain('Left out because a judge found a fact in the row that the entries or findings it cites do not hold: 1.');
    expect(part).toContain('| Left out | Reason |');
    expect(part).toContain('| Approval routes: Place an order / The clerk fills in the customer name. / The item count is limited to 35000. / Clerk | The row names a condition that no cited sentence says. |');
  });

  it('lists each lane with its status and the number of rows kept and left out', () => {
    const run = checkedTopicsRun(cleanups);
    judgeTopics(run, (row, letter) => (row.id === 'D2#2' && letter === 'b' ? { verdict: 'doesNotFollow', reason: 'The providing domain is not in what the row cites.' } : 'follows'));
    assemble(run);
    const part = coverageTopics(text(run, 'handbook.md'));
    expect(part).toContain('| Lane | Status | Rows kept | Rows left out |');
    expect(part).toContain('| Customer orders | Written and judged | 2 | 0 |');
    expect(part).toContain('| System upkeep | Written and judged | 1 | 1 |');
    expect(part).toContain(`| ${ui['md.topics.repeated.heading']} | Written and judged | 1 | 0 |`);
  });

  it('says that every written row is in the handbook when the judges left none out', () => {
    const run = shared();
    assemble(run);
    expect(coverageTopics(text(run, 'handbook.md'))).toContain(ui['md.coverage.topicsAllKept']);
  });

  it('says the lane did not finish and writes none of its rows when it is only checked, or was never written', () => {
    const run = topicsRun(cleanups);
    checkedLane(run, 'D1');
    assemble(run);
    const body = text(run, 'handbook.md');
    expect(coverageTopics(body)).toContain('| Customer orders | Written, verification not finished | 0 | 0 |');
    expect(coverageTopics(body)).toContain('| System upkeep | Not written | 0 | 0 |');
    expect(coverageTopics(body)).toContain(ui['md.coverage.topicsNotFinished']);
    expect(chapterOf(body)).not.toContain('| Place an order |');
    expect(chapterOf(body)).toContain(ui['md.topics.notFinished']);
    expect(chapterOf(body)).not.toContain('state none of this');
  });

  it('ignores a lane whose facts are not the current ones, and says so', () => {
    const run = checkedTopicsRun(cleanups);
    judgeTopics(run);
    const doc = run.findingsDoc('F3');
    doc.findings[0].text = 'The reminder goes out at one fixed time of day, whatever the time zone of the recipient.';
    run.writeFindings('F3', doc);
    expect(run.run('check-findings', unitId('F3')).status).toBe(0);
    verifyChecked(run, unitId('F3'));
    assemble(run);
    const body = text(run, 'handbook.md');
    const part = coverageTopics(body);
    expect(part).toContain(`| ${ui['md.topics.repeated.heading']} | Written for other entries or findings than the ones in this handbook | 0 | 0 |`);
    expect(part).toContain(ui['md.coverage.topicsStale']);
    expect(topicOf(body, 'repeated')).not.toContain('Operations on orders');
    expect(topicOf(body, 'approval')).toContain('| Place an order |');
  });

  it('writes no chapter and says none in the coverage section when there is no verified entry and no verified finding', () => {
    const run = topicsRun(cleanups);
    const state = run.readState();
    for (const id of ['F1', 'F3']) state.features[id] = { status: 'planned', attempts: 0 };
    state.findings = {};
    run.writeJson(join(run.out, 'state.json'), state);
    assemble(run);
    const body = text(run, 'handbook.md');
    expect(body).not.toContain(`\n## ${ui['md.topics.heading']}\n`);
    expect(coverageTopics(body).trim()).toBe(ui['md.none']);
  });
});

describe('the page data', () => {
  it('has the format /13, topics with the rows and their basis, and the coverage of the topics', () => {
    const run = shared();
    const made = page(run);
    expect(made.status, made.stdout).toBe(0);
    const data = dataOf(run);
    expect(data.format).toBe('excavator-product-handbook-page/13');
    const keys = Object.keys(data);
    expect(keys.slice(keys.indexOf('findings'), keys.indexOf('findings') + 4)).toEqual(['findings', 'remedies', 'topics', 'coverage']);
    expect(Object.keys(data.topics)).toEqual(['approval', 'time', 'handoffs', 'access', 'repeated']);
    expect(data.topics.approval).toEqual([{
      fields: { business: 'Place an order', route: 'The clerk fills in the customer name.', skips: '', conditions: 'The item count is limited to 35000.', actors: 'Clerk' },
      basis: [
        { id: 'F1#operations[0].sentences[0]', kind: 'item', feature: 'Orders', text: 'Place an order: The clerk fills in the customer name.' },
        { id: 'F1#operations[0].sentences[1]', kind: 'item', feature: 'Orders', text: 'Place an order: The item count is limited to 35000.' },
        { id: 'F1#who[0]', kind: 'item', feature: 'Orders', text: 'Clerk: Create an order.' },
      ],
    }]);
    expect(data.topics.handoffs[0].fields).toEqual({ from: 'Customer orders', to: 'System upkeep', content: 'The order was sent.' });
    expect(data.topics.access[0].fields.feature).toBe('Orders');
    expect(data.topics.repeated[0].basis.map((entry) => [entry.kind, entry.id, entry.category, entry.level])).toEqual([
      ['group', 'F1.findings[0]', 'authorization', null],
      ['group', 'F1.findings[1]', 'error-handling', null],
    ]);
    expect(data.coverage.topics).toEqual({
      finished: true,
      stale: false,
      entriesRead: 2,
      groupsRead: 4,
      lanes: [
        { id: 'D1', name: 'Customer orders', status: 'verified', kept: 2, dropped: 0 },
        { id: 'D2', name: 'System upkeep', status: 'verified', kept: 2, dropped: 0 },
        { id: 'repeated', name: null, status: 'verified', kept: 1, dropped: 0 },
      ],
      dropped: [],
    });
    expect(JSON.stringify(data.topics)).not.toContain('src/');
  });

  it('puts the places of the cited items in the technical part only', () => {
    const run = shared();
    expect(page(run).status).toBe(0);
    const data = dataOf(run);
    const places = data.technical.topicLocations.find((entry) => entry.id === 'F1#operations[0].sentences[0]');
    expect(places.citations[0].file).toBe('src/forms/order-form.js');
    expect(places.citations[0].startLine).toBeGreaterThan(0);
    expect(JSON.stringify({ ...data, technical: undefined }).includes('order-form.js')).toBe(false);
  });

  it('lists the rows the judges left out in the coverage, and has no row of a lane that did not finish', () => {
    const run = checkedTopicsRun(cleanups);
    judgeTopics(run, (row, letter) => (row.id === 'D2#1' ? { verdict: 'doesNotFollow', reason: `Judge ${letter} did not find it in the cited item.` } : 'follows'));
    expect(page(run).status).toBe(0);
    const data = dataOf(run);
    expect(data.topics.time).toEqual([]);
    expect(data.coverage.topics.dropped).toEqual([{ id: 'D2#1', topic: 'time', text: 'A reminder goes out every day at nine. / Reminders', reasons: ['Judge a did not find it in the cited item.', 'Judge b did not find it in the cited item.'] }]);
    expect(data.coverage.topics.lanes[1]).toEqual({ id: 'D2', name: 'System upkeep', status: 'verified', kept: 1, dropped: 1 });
    const unfinished = checkedLane(topicsRun(cleanups), 'D1');
    expect(page(unfinished).status).toBe(0);
    const other = dataOf(unfinished);
    expect(other.topics.approval).toEqual([]);
    expect(other.coverage.topics.finished).toBe(false);
    expect(other.coverage.topics.lanes.map((lane) => lane.status)).toEqual(['checked', 'planned', 'planned']);
    const first = text(unfinished, 'handbook.html');
    page(unfinished);
    expect(text(unfinished, 'handbook.html')).toBe(first);
  });
});
