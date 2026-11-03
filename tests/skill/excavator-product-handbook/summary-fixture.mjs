/**
 * The run the summary-table tests share (openspec change handbook-summary-
 * tables): the synthetic fixture project with a verified F1 that has one
 * notification, and a verified F3 (the feature of the fixture's one scheduled
 * job) whose automatic item cites the registration line.
 */
import { expect } from 'vitest';

import { clone, makeCheckedMapRun, verifyChecked } from './helpers.mjs';

export const FORM = 'src/forms/order-form.js';
export const JOB_FILE = 'src/jobs/reminders.js';
export const JOB_LINE = "return schedule.scheduleJob('0 9 * * *', () => send('daily reminder'));";
const ev = (file, passage) => ({ file, passage });

/** The entries of F1 (one notification) and F3 (one automatic item citing the registration line). */
export function entries(run) {
  const f1 = clone(run.entry);
  f1.notifications.push({ trigger: 'An order is sent', recipient: 'The approver', channel: 'Message', content: 'A new order waits for approval.', evidence: [ev(FORM, "const statuses = ['Draft', 'Submitted'];")] });
  const f3 = clone(run.entry);
  f3.id = 'F3';
  f3.automatic = [{ when: 'Every day at nine', effect: 'A reminder goes out.', evidence: [ev(JOB_FILE, JOB_LINE)] }];
  return { F1: f1, F3: f3 };
}

/** A run whose F1 (and F3 unless `withJob` is false) entry is verified; `cleanups` receives its cleanup. */
export function verifiedRun(cleanups, { withJob = true } = {}) {
  const run = makeCheckedMapRun();
  cleanups.push(run.cleanup);
  const written = entries(run);
  for (const id of withJob ? ['F1', 'F3'] : ['F1']) {
    run.writeEntry(id, written[id]);
    const checked = run.run('check-entry', id);
    expect(checked.status, checked.stdout).toBe(0);
    verifyChecked(run, id);
  }
  return run;
}
