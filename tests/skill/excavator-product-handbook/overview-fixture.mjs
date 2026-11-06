/**
 * The run the system-overview tests share (openspec change
 * handbook-system-overview): the synthetic fixture project plus one extra
 * source file that names an external system, and an overview that passes
 * check-overview on it (its name is the fixture's package name, the one name candidate the project has). The fixture project root holds a package.json, so it
 * is the one application root and its directory is ".".
 */
import { expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { clone, makeCheckedMapRun } from './helpers.mjs';

export const OVERVIEW_FORMAT = 'excavator-product-handbook-overview/1';
export const NOTIFY_FILE = 'src/notify.js';
export const NOTIFY_LINE = "const CHANNEL = 'Slack';";
const ev = (file, passage) => ({ file, passage });

/** The overview that passes check-overview on the fixture. */
export function goodOverview() {
  return {
    format: OVERVIEW_FORMAT,
    id: 'overview',
    name: { text: 'handbook-fixture', evidence: [ev('package.json', '"name": "handbook-fixture",')] },
    summary: [{ text: 'Staff place and review orders for customers.', evidence: [ev('src/forms/order-form.js', "title: 'New Order',")] }],
    audiences: [{ who: 'Clerk', does: 'Creates orders.', evidence: [ev('src/roles.js', "const ROLES = ['Clerk', 'Approver'];")] }],
    applications: [{ dir: '.', name: 'Order tool', does: 'Serves the order pages and sends reminders.', evidence: [ev('package.json', '"express": "^4.18.0",')] }],
    integrations: [{ system: 'Slack', use: 'Reminders go to a team channel.', callers: ['.'], evidence: [ev(NOTIFY_FILE, NOTIFY_LINE)] }],
    unknowns: [{ item: 'Whether other tools call it', searched: 'the routes and the jobs' }],
  };
}

/** A run whose map passed check-map and whose project holds the file the good overview cites for its external system. */
export function overviewRun(cleanups, adjust) {
  const run = makeCheckedMapRun();
  cleanups.push(run.cleanup);
  writeFileSync(join(run.root, NOTIFY_FILE), `// Where the reminders are sent.\n${NOTIFY_LINE}\nmodule.exports = { CHANNEL };\n`);
  const doc = clone(goodOverview());
  adjust?.(doc, run);
  run.writeOverview = (value = doc) => run.writeJson(join(run.out, 'entries', 'overview.json'), value);
  run.overview = doc;
  run.writeOverview();
  return run;
}

/** A run whose overview passed check-overview. */
export function checkedOverviewRun(cleanups, adjust) {
  const run = overviewRun(cleanups, adjust);
  const result = run.run('check-overview');
  expect(result.status, result.stdout + result.stderr).toBe(0);
  return run;
}
