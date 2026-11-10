/**
 * The run the appendix tests share (openspec change handbook-history-appendix): F1 verified after losing a rule and the state
 * "Submitted" to the verifiers and the role "Approver" to the tracers; F3 verified with one state; F2 written and checked, not
 * verified, with the role "Approver" and an unknown of its own; the good domains file. Also a hand-written history file for the
 * output tests. Every sentence is about the fixture's own code.
 */
import { expect } from 'vitest';
import { join } from 'node:path';

import { clone, judgeBothRounds, makeCheckedMapRun, traceFeature, verifyChecked } from './helpers.mjs';
import { entries as summaryEntries } from './summary-fixture.mjs';

export const ev = (file, passage) => ({ file, passage });
export const ROLES = ev('src/roles.js', "const ROLES = ['Clerk', 'Approver'];");

/**
 * A run with the good domains: F1 verified after losing a rule and the state "Submitted" to the verifiers and the role
 * "Approver" to the tracers; F3 verified with one state; F2 written and checked, not verified, with the role "Approver".
 */
export function appendixRun(cleanups) {
  const run = makeCheckedMapRun();
  cleanups.push(run.cleanup);
  run.writeDomains();
  const { F1, F3 } = summaryEntries(run);
  F1.who.push({ role: 'Approver', can: 'Approve an order.', evidence: [ROLES] });
  F3.states = F3.states.slice(0, 1);
  const f2 = clone(run.entry);
  f2.id = 'F2';
  f2.who = [{ role: 'Approver', can: 'Approve an order.', evidence: [ROLES] }];
  f2.unknowns = [{ item: 'Where the archive is kept', searched: 'the archive routes' }];
  run.writeEntry('F1', F1);
  run.writeEntry('F3', F3);
  run.writeEntry('F2', f2);
  for (const id of ['F1', 'F2', 'F3']) expect(run.run('check-entry', id).status).toBe(0);
  const bad = {
    'screens[0].fields[1].rules[0]': { verdict: 'contradicted', reason: 'The condition shown caps the count at 50.' },
    'states[1]': { verdict: 'unverified', reason: 'No line shown names the state.' },
  };
  expect(judgeBothRounds(run, 'F1', (item) => bad[item.id] ?? 'verified').status).toBe(0);
  const traced = traceFeature(run, 'F1', (item) => (item.id === 'who[1]' ? { verdict: 'contradicted', reason: 'Another step lets every clerk approve.', at: [{ file: 'src/roles.js', line: 1 }] } : 'holds'));
  expect(traced.status, traced.stdout + traced.stderr).toBe(0);
  verifyChecked(run, 'F3');
  return run;
}

/** The number of nodes with a non-empty `evidence` list in an entry: the items the verifiers judge. */
export function countEvidenceItems(value) {
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + countEvidenceItems(item), 0);
  if (value === null || typeof value !== 'object') return 0;
  const own = Array.isArray(value.evidence) && value.evidence.length > 0 ? 1 : 0;
  return own + Object.entries(value).filter(([key]) => key !== 'evidence').reduce((sum, [, child]) => sum + countEvidenceItems(child), 0);
}

export const HISTORY_FORMAT = 'excavator-product-handbook-history/1';

/** A history file for the fixture project, whose one application root is `.`; `F1` and `F3` are the verified features. */
export function goodHistory() {
  return {
    format: HISTORY_FORMAT,
    noHistory: null,
    years: [{ year: 2022, commits: 3, byApp: { '.': 3 } }, { year: 2023, commits: 0, byApp: {} }, { year: 2024, commits: 5, byApp: { '.': 5 } }],
    apps: [{ dir: '.', first: '2022-03-01', last: '2024-09-09', commits: 8, authors: 2, authors80: 1, reason: null }],
    hotspots: [
      { path: 'src/routes/orders.js', app: '.', commits: 5, authors: 2, lines: 20, last: '2024-09-09', uncertain: 0, features: ['F1', 'F3', 'F2'] },
      { path: 'src/app.js', app: '.', commits: 2, authors: 1, lines: 9, last: '2023-01-01', uncertain: 0, features: [] },
    ],
    coChange: [{ a: 'src/app.js', b: 'src/routes/orders.js', commits: 4 }],
    tests: [{ dir: '.', sourceFiles: 9, testFiles: 2 }],
  };
}

/** Write a history file into the run's output directory (`entries/history.json`). */
export function writeHistory(run, doc = goodHistory()) {
  run.writeJson(join(run.out, 'entries', 'history.json'), doc);
}
