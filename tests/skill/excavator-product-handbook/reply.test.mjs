// `handbook.mjs reply`: the closing lines of a run are printed by the script
// from the checked run, so the model adds nothing up.
import { afterEach, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { clone, makeCheckedMapRun, runHandbook, verifyChecked } from './helpers.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

function newRun() {
  const run = makeCheckedMapRun();
  cleanups.push(run.cleanup);
  return run;
}

/** A run whose F1 entry is checked and verified and whose handbook.md is assembled. */
function assembledRun() {
  const run = newRun();
  run.writeEntry('F1', clone(run.entry));
  expect(run.run('check-entry', 'F1').status).toBe(0);
  verifyChecked(run);
  expect(run.run('assemble').status).toBe(0);
  return run;
}

describe('reply', () => {
  it('prints the handbook path, the page line, the counts by status and the conservation line, in that order', () => {
    const run = assembledRun();
    const result = run.run('reply');
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.lines).toEqual([
      `Handbook: ${join(run.out, 'handbook.md')}`,
      'Page: not written',
      'Features: 5 (planned 4, dispatched 0, checked 0, verified 1, failed 0)',
      `Candidates: ${run.candidates.items.length} listed, ${run.candidates.items.length - 1} in features, 1 unassigned; none missing, none counted twice`,
    ]);
  });

  it('names the page when handbook.html exists', () => {
    const run = assembledRun();
    writeFileSync(join(run.out, 'handbook.html'), '<!doctype html>\n');
    expect(run.run('reply').lines[1]).toBe(`Page: ${join(run.out, 'handbook.html')}`);
  });

  it('counts a dispatched feature and lists the failed ones', () => {
    const run = assembledRun();
    expect(run.run('mark', 'F2', 'dispatched').status).toBe(0);
    expect(run.run('mark', 'F3', 'failed', 'lane', 'wrote-nothing').status).toBe(0);
    const result = run.run('reply');
    expect(result.status).toBe(0);
    expect(result.lines[2]).toBe('Features: 5 (planned 2, dispatched 1, checked 0, verified 1, failed 1)');
    expect(result.lines[3]).toBe('Failed: F3');
    expect(result.lines).toHaveLength(5);
  });

  it('is the same on two runs and changes no file', () => {
    const run = assembledRun();
    const names = () => readdirSync(run.out).sort();
    const before = { names: names(), state: readFileSync(join(run.out, 'state.json'), 'utf-8') };
    const first = run.run('reply');
    expect(run.run('reply').stdout).toBe(first.stdout);
    expect(names()).toEqual(before.names);
    expect(readFileSync(join(run.out, 'state.json'), 'utf-8')).toBe(before.state);
  });

  it('exits 1 with a Next line when handbook.md is missing', () => {
    const run = newRun();
    const result = run.run('reply');
    expect(result.status).toBe(1);
    expect(result.lines).toEqual(['handbook.md: missing', 'Next: run assemble, then this command again']);
  });

  it('exits 1 with the reasons when the map no longer passes', () => {
    const run = assembledRun();
    const map = clone(run.map);
    map.features[2].candidates = [];
    run.writeMap(map);
    const result = run.run('reply');
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/not in any feature and not in unassigned/);
  });

  it('needs --project, and a map.json that exists', () => {
    const run = newRun();
    expect(runHandbook(['reply', run.out]).status).toBe(2);
    rmSync(join(run.out, 'map.json'));
    expect(run.run('reply').status).toBe(2);
  });
});
