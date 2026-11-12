/**
 * The run the light-scheme tests share (openspec change handbook-light-scheme):
 * the system fixture's project (three application roots) with every model-written
 * part `checked` and nothing `verified`: the overview, the findings of every one
 * of the six features, the system findings of app1 and app2, the ranking, the remedies and the topics
 * lane of the repeated findings. Every sentence is about the fixture's own code.
 * app3 holds no seed file, so its system unit is verified with none by the
 * check itself; the tests do not look at it.
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { expect } from 'vitest';

import { JOB_LINE, MAILER, MAIL_LINE, NIGHTLY, ORDERS, REPORTS, ROUTE, SMALL, START, STOCK, goodSystemFindings, goodSystemOverview, systemId, systemRun } from './system-fixture.mjs';

const ev = (file, passage) => ({ file, passage });
const findingsDoc = (id, findings) => ({ format: 'excavator-product-handbook-findings/1', id: `${id}.findings`, findings, unknowns: [] });

export const ORDERS_TEXT = 'The first list route of the orders answers a fixed list, whatever was stored.';
export const NIGHTLY_TEXT = 'The nightly job runs at one fixed hour whatever the time zone of the reader.';
export const MAIL_TEXT = 'The mail helper reports every message as sent without sending anything.';
export const STOCK_TEXT = 'The stock list is always empty, whatever was stored.';

export const REPORTS_TEXT = 'The reports route answers a fixed list whatever was stored.';
export const START_TEXT = 'The start command prints one word and starts nothing else.';
export const STOCK_ROUTE_TEXT = 'The second stock route answers a list whatever was stored.';
export const SMALL_TEXT = 'The small list answers an empty list whatever was stored.';

const REASON = {
  'hard-coded': 'Every caller who opens the list sees a fixed answer.',
  notification: 'A caller is told the message was sent although nothing was sent.',
  time: 'The nightly job runs at one fixed hour for every reader.',
  display: 'A caller sees a list that does not hold what was stored.',
  other: 'A caller who starts the tool sees one word and nothing else happens.',
  consistency: 'A caller reads a list that does not match what was stored.',
};
const CONSEQUENCE = { 'hard-coded': 'display', notification: 'notification', time: 'notification', display: 'display', other: 'inert', consistency: 'dataLoss' };

/** The groups `priority-items` prints: `[{ key, category }]`; the category is the one of the finding the key names. */
const groups = (run) => {
  const result = run.run('priority-items');
  expect(result.status, result.stdout + result.stderr).toBe(0);
  return result.lines.map((line) => {
    const [key] = line.split('\t');
    const found = /^(.+)#(\d+)@/.exec(key);
    return { key, category: run.readJson(`entries/${found[1]}.json`).findings[Number(found[2])].category };
  });
};

/** A run whose every model-written part is checked and none verified. */
export function lightRun(cleanups) {
  const run = systemRun(cleanups);
  run.writeOverview(goodSystemOverview());
  expect(run.run('check-overview').status).toBe(0);
  run.writeFindings('F1', findingsDoc('F1', [{ category: 'hard-coded', text: ORDERS_TEXT, evidence: [ev(ORDERS, ROUTE(1))] }]));
  run.writeFindings('F3', findingsDoc('F3', [{ category: 'time', text: NIGHTLY_TEXT, evidence: [ev(NIGHTLY, JOB_LINE)] }]));
  run.writeFindings('F2', findingsDoc('F2', [{ category: 'display', text: REPORTS_TEXT, evidence: [ev(REPORTS, ROUTE(1))] }]));
  run.writeFindings('F4', findingsDoc('F4', [{ category: 'other', text: START_TEXT, evidence: [ev(START, 'console.log("start");')] }]));
  run.writeFindings('F5', findingsDoc('F5', [{ category: 'consistency', text: STOCK_ROUTE_TEXT, evidence: [ev(STOCK, ROUTE(2))] }]));
  run.writeFindings('F6', findingsDoc('F6', [{ category: 'hard-coded', text: SMALL_TEXT, evidence: [ev(SMALL, ROUTE(1))] }]));
  for (const n of [1, 2, 3, 4, 5, 6]) {
    const checked = run.run('check-findings', `F${n}.findings`);
    expect(checked.status, checked.stdout + checked.stderr).toBe(0);
  }
  run.writeSystem(1, { ...goodSystemFindings(1), findings: [{ category: 'notification', text: MAIL_TEXT, evidence: [ev(MAILER, MAIL_LINE)] }] });
  run.writeSystem(2, { ...goodSystemFindings(2), findings: [{ category: 'hard-coded', text: STOCK_TEXT, evidence: [ev(STOCK, ROUTE(1))] }] });
  for (const n of [1, 2]) expect(run.run('check-system-findings', systemId(n)).status).toBe(0);
  // The third root has no seed file: its empty unit is verified by the check itself, which is no model-written part.
  expect(run.run('check-system-findings', systemId(3)).lines).toEqual(['app3.system: verified (0 findings)']);

  expect(run.run('mark', 'priority', 'dispatched').status).toBe(0);
  const ranked = groups(run);
  const part = join(run.out, 'priority', 'part-1.json');
  mkdirSync(dirname(part), { recursive: true });
  run.writeJson(part, { schema: 'excavator-product-handbook-priority/1', items: ranked.map(({ key, category }) => ({ key, consequence: CONSEQUENCE[category], reason: REASON[category] })) });
  expect(run.run('check-priority').status).toBe(0);

  expect(run.run('mark', 'remedies', 'dispatched').status).toBe(0);
  const facts = run.run('remedy-facts').lines.map((line) => line.split('\t'));
  const keyOf = (category) => facts.find((row) => row[2] === category)[0];
  const remedies = join(run.out, 'entries', 'remedies.json');
  mkdirSync(dirname(remedies), { recursive: true });
  run.writeJson(remedies, {
    schema: 'excavator-product-handbook-remedies/1',
    categories: [{ category: 'notification', cause: 'The mail helper reports success before anything is sent.', measure: 'Report success only after a message left the helper.', cites: [keyOf('notification')] }],
    recommendations: [{ title: 'Make the mail helper honest', text: 'The helper should say a message was sent only when it left the helper.', cites: [keyOf('notification')] }],
  });
  const checkedRemedies = run.run('check-remedies');
  expect(checkedRemedies.status, checkedRemedies.stdout + checkedRemedies.stderr).toBe(0);

  expect(run.run('mark', 'topics:repeated', 'dispatched').status).toBe(0);
  const repeated = run.run('topic-facts', '--lane', 'repeated').lines.map((line) => line.split('\t')).filter((row) => row[2] === 'hard-coded');
  const lane = join(run.out, 'topics', 'part-repeated.json');
  mkdirSync(dirname(lane), { recursive: true });
  run.writeJson(lane, {
    schema: 'excavator-product-handbook-topics-part/1',
    lane: 'repeated',
    rows: [{ topic: 'repeated', fields: { mechanism: 'Lists answer a fixed result without reading anything.', places: 'Orders and stock' }, cites: repeated.map((row) => row[0]) }],
  });
  const checkedLane = run.run('check-topics', '--lane', 'repeated');
  expect(checkedLane.status, checkedLane.stdout + checkedLane.stderr).toBe(0);
  return run;
}
