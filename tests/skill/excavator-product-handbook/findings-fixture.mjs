/**
 * The run the findings tests share (openspec change handbook-feature-findings):
 * the synthetic fixture project of the other handbook tests, whose route and job
 * files hold the passages the findings quote, plus findings files that pass
 * check-findings on it. Every finding below is about the fixture's own code.
 */
import { expect } from 'vitest';

import { clone, makeCheckedMapRun } from './helpers.mjs';

export const FINDINGS_FORMAT = 'excavator-product-handbook-findings/1';
export const ORDERS_FILE = 'src/routes/orders.js';
export const JOBS_FILE = 'src/jobs/reminders.js';
export const DELETE_LINE = "router.delete('/:id', (req, res) => res.status(204).end());";
export const POST_LINE = "router.post('/', (req, res) => res.status(201).end());";
export const LIST_LINE = "router.get('/', (req, res) => res.json([]));";
export const JOB_LINE = "return schedule.scheduleJob('0 9 * * *', () => send('daily reminder'));";
const ev = (file, passage) => ({ file, passage });

/** The id of the findings unit of a feature. */
export const unitId = (featureId) => `${featureId}.findings`;

/** The findings of F1 (three, in three categories) that pass check-findings on the fixture. */
export function goodFindings(featureId = 'F1') {
  if (featureId === 'F3') {
    return {
      format: FINDINGS_FORMAT,
      id: unitId('F3'),
      findings: [{ category: 'time', text: 'The reminder goes out at one fixed time of day for every recipient, whatever their time zone.', evidence: [ev(JOBS_FILE, JOB_LINE)] }],
      unknowns: [],
    };
  }
  return {
    format: FINDINGS_FORMAT,
    id: unitId(featureId),
    findings: [
      { category: 'authorization', text: 'Deleting an order asks nothing about who calls: the handler removes the order and answers success to every caller.', evidence: [ev(ORDERS_FILE, DELETE_LINE)] },
      { category: 'error-handling', text: 'Creating an order answers that it was created without reading or storing anything.', evidence: [ev(ORDERS_FILE, POST_LINE)] },
      { category: 'hard-coded', text: 'The list of orders is always empty, whatever was created.', evidence: [ev(ORDERS_FILE, LIST_LINE)] },
    ],
    unknowns: [{ item: 'Whether a gateway checks the caller before the router', searched: 'the application file and the routes' }],
  };
}

/** Add the findings helpers to a run: `writeFindings(featureId, doc)` writes a findings file. */
export function withFindingsHelpers(run) {
  run.writeFindings = (featureId = 'F1', doc = goodFindings(featureId)) => run.writeJson(`${run.out}/entries/${unitId(featureId)}.json`, doc);
  run.findingsDoc = (featureId = 'F1') => clone(goodFindings(featureId));
  run.readState = () => run.readJson('state.json');
  run.readFindings = (featureId = 'F1') => run.readJson(`entries/${unitId(featureId)}.json`);
  return run;
}

/** A run whose map passed check-map. */
export function findingsRun(cleanups) {
  const run = makeCheckedMapRun();
  cleanups.push(run.cleanup);
  return withFindingsHelpers(run);
}

/** A run whose F1 findings passed check-findings. */
export function checkedFindingsRun(cleanups, featureId = 'F1') {
  const run = findingsRun(cleanups);
  run.writeFindings(featureId);
  const result = run.run('check-findings', unitId(featureId));
  expect(result.status, result.stdout + result.stderr).toBe(0);
  return run;
}
