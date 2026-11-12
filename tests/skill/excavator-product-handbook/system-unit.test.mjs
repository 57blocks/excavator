// O1 (unit) of openspec change handbook-system-findings: the unit `app<n>.system`
// of an application root; its state under the optional key `systemFindings`
// (planned without the key, the root recorded, exit 1 when the root changed);
// its file with the shape of a findings file; mark runs on it; an application without a seed is verified at once.
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { runHandbook, verifyChecked } from './helpers.mjs';
import { checkedSystemRun, systemId, systemRun } from './system-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const ID = systemId(1);
const record = (run, key = 'app1') => run.readState().systemFindings[key];

describe('the state key systemFindings', () => {
  it('mark records the dispatch under the application key with the application root, and leaves the features alone', () => {
    const run = systemRun(cleanups);
    expect(run.run('mark', ID, 'dispatched').lines).toEqual(['app1.system: dispatched, attempts 1']);
    expect(record(run)).toEqual({ status: 'dispatched', attempts: 1, root: 'alpha' });
    expect(run.run('mark', systemId(2), 'dispatched').lines).toEqual(['app2.system: dispatched, attempts 1']);
    expect(record(run, 'app2')).toEqual({ status: 'dispatched', attempts: 1, root: 'beta' });
    expect(run.readState().features.F1).toEqual({ status: 'planned', attempts: 0 });
    expect(run.readState().findings).toBeUndefined();
  });

});

describe('an application with no seed file is verified at once', () => {
  it('check-system-findings records it verified with no finding and no lane, and writes its empty file', () => {
    const run = systemRun(cleanups);
    expect(run.run('system-seeds', 'app3').lines).toEqual([]);
    expect(existsSync(join(run.out, 'entries', 'app3.system.json'))).toBe(false);
    const result = run.run('check-system-findings', systemId(3));
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines).toEqual(['app3.system: verified (0 findings)']);
    expect(record(run, 'app3')).toMatchObject({ status: 'verified', attempts: 0, root: 'gamma' });
    expect(run.readSystem(3)).toEqual({ format: 'excavator-product-handbook-findings/1', id: 'app3.system', findings: [], unknowns: [] });
  });

  it('an application that has seeds is not verified without a lane: its missing file is a lane that wrote nothing', () => {
    const run = systemRun(cleanups);
    const result = run.run('check-system-findings', ID);
    expect(result.status).toBe(1);
    expect(result.lines[0]).toBe('app1.system: lane-wrote-nothing: entries/app1.system.json is missing');
    expect(existsSync(join(run.out, 'entries', 'app1.system.json'))).toBe(false);
  });
});

describe('a verified system unit', () => {
  it('a verified unit of an older run keeps its root', () => {
    const run = checkedSystemRun(cleanups);
    verifyChecked(run, ID);
    expect(record(run)).toMatchObject({ status: 'verified', attempts: 0, root: 'alpha' });
    expect(run.readState().features.F1.status).toBe('planned');
  });

  it('a verified unit is the file that was verified: a changed file starts over as checked', () => {
    const run = checkedSystemRun(cleanups);
    verifyChecked(run, ID);
    const doc = run.readSystem(1);
    doc.findings[0].text = 'The mail helper reports each message as sent without sending anything.';
    run.writeSystem(1, doc);
    expect(run.run('check-system-findings', ID).lines).toEqual(['app1.system: checked']);
    expect(record(run)).toEqual({ status: 'checked', attempts: 0, root: 'alpha' });
  });
});
