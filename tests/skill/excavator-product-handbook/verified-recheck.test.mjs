// check-entry and check-overview on a unit that is already verified: an entry
// file that is still the file that was verified is checked with the rules of a
// settled entry (the ones assemble applies), so what verification trimmed does
// not send it back to failed; a changed file starts over as checked, and an
// unchanged file that no longer passes is failed.
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { clone, confirmChecked, makeCheckedMapRun, verifyChecked } from './helpers.mjs';
import { checkedOverviewRun } from './overview-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const form = 'src/forms/order-form.js';
const stateText = (run) => readFileSync(join(run.out, 'state.json'), 'utf-8');
const entryOf = (run, id) => run.readJson(`entries/${id}.json`);
const unitOf = (run, id) => (id === 'overview' ? run.readJson('state.json').overview : run.readJson('state.json').features[id]);

function verifiedFeature() {
  const run = makeCheckedMapRun();
  cleanups.push(run.cleanup);
  run.writeEntry();
  expect(run.run('check-entry', 'F1').status).toBe(0);
  verifyChecked(run, 'F1');
  expect(unitOf(run, 'F1').status).toBe('verified');
  return run;
}

function verifiedOverviewWithoutApplication() {
  const run = checkedOverviewRun(cleanups);
  verifyChecked(run, 'overview', [{ path: 'applications[0]', verdict: 'contradicted', reason: 'The code shown names another tool.', step: 'trace', reasons: ['The code shown names another tool.'], at: [{ file: 'package.json', line: 1 }] }]);
  return run;
}

describe('check-overview on a verified overview that verification trimmed', () => {
  it('keeps it verified and writes nothing', () => {
    const run = verifiedOverviewWithoutApplication();
    expect(entryOf(run, 'overview').applications).toEqual([]);
    const before = stateText(run);
    const result = run.run('check-overview');
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines).toEqual(['overview: verified, unchanged since it was verified']);
    expect(stateText(run)).toBe(before);
  });
});

describe('check-entry on a verified feature', () => {
  it('starts over as checked when the entry file changed after it was verified', () => {
    const run = verifiedFeature();
    const changed = clone(entryOf(run, 'F1'));
    changed.purpose.text = 'Staff place new orders.';
    run.writeEntry('F1', changed);
    const result = run.run('check-entry', 'F1');
    expect(result.lines).toEqual(['F1: checked']);
    expect(unitOf(run, 'F1')).toEqual({ status: 'checked', attempts: 0 });
  });

  it('fails when the file is unchanged but a passage it cites is gone from the source', () => {
    const run = verifiedFeature();
    const path = join(run.root, form);
    writeFileSync(path, readFileSync(path, 'utf-8').split('\n').filter((line) => !line.includes("title: 'New Order',")).join('\n'));
    const result = run.run('check-entry', 'F1');
    expect(result.status).toBe(1);
    expect(result.lines.at(-1)).toMatch(/^Next: /);
    expect(unitOf(run, 'F1').status).toBe('failed');
  });
});

describe('check-overview on a verified overview', () => {
  it('starts over as checked when the entry file changed after it was verified', () => {
    const run = checkedOverviewRun(cleanups);
    verifyChecked(run, 'overview');
    expect(unitOf(run, 'overview').status).toBe('verified');
    const changed = clone(entryOf(run, 'overview'));
    changed.summary[0].text = 'Staff place orders.';
    run.writeOverview(changed);
    const result = run.run('check-overview');
    expect(result.lines).toEqual(['overview: checked']);
    expect(unitOf(run, 'overview')).toEqual({ status: 'checked', attempts: 0 });
  });
});
