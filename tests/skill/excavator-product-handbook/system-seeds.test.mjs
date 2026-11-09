// O1 (seeds) of openspec change handbook-system-findings: `handbook.mjs system-seeds`
// prints the seed files of an application's system unit: the files under the
// application root that hold a main or a job candidate, or at least 5
// candidates of any kind; a file below the threshold and a file outside the
// root are not seeds; an application with no seed prints nothing.
import { afterEach, describe, expect, it } from 'vitest';

import { MAILER, NIGHTLY, ORDERS, REPORTS, SERVER, SMALL, START, STOCK, TOOL, systemRun } from './system-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const seeds = (run, id) => run.run('system-seeds', id);

describe('system-seeds: which files are seeds of an application', () => {
  it('lists the files with a main or a job candidate and the files with at least 5 candidates, sorted, one per line', () => {
    const run = systemRun(cleanups);
    const result = seeds(run, 'app1');
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.lines).toEqual([START, NIGHTLY, SERVER]);
    expect(result.lines).toEqual([...result.lines].sort());
  });

  it('a main or a job counts whatever else the file holds: each of them is alone in its file', () => {
    const run = systemRun(cleanups);
    const lines = seeds(run, 'app1').lines;
    const byFile = (file) => run.candidates.items.filter((item) => item.file === file);
    expect(byFile(START).map((item) => item.kind)).toEqual(['main']);
    expect(byFile(NIGHTLY).map((item) => item.kind)).toEqual(['job']);
    expect(lines).toContain(START);
    expect(lines).toContain(NIGHTLY);
  });

  it('the threshold is 5: a file with 5 route candidates is a seed, one with 4 or 2 is not', () => {
    const run = systemRun(cleanups);
    const count = (file) => run.candidates.items.filter((item) => item.file === file).length;
    expect([count(SERVER), count(REPORTS), count(ORDERS)]).toEqual([5, 4, 2]);
    const lines = seeds(run, 'app1').lines;
    expect(lines).toContain(SERVER);
    expect(lines).not.toContain(REPORTS);
    expect(lines).not.toContain(ORDERS);
    const beta = seeds(run, 'app2').lines;
    expect([count(STOCK), count(SMALL)]).toEqual([5, 4]);
    expect(beta).toEqual([STOCK]);
  });

  it('a file without any candidate is not a seed', () => {
    const run = systemRun(cleanups);
    expect(seeds(run, 'app1').lines).not.toContain(MAILER);
  });

  it('files outside the application root are not seeds of it: the other application\'s file and the tool outside every root', () => {
    const run = systemRun(cleanups);
    const alpha = seeds(run, 'app1').lines;
    const beta = seeds(run, 'app2').lines;
    expect(alpha.every((file) => file.startsWith('alpha/'))).toBe(true);
    expect(beta.every((file) => file.startsWith('beta/'))).toBe(true);
    // The tool holds a main candidate, so it would be a seed if it were under a root.
    expect(run.candidates.items.find((item) => item.file === TOOL).kind).toBe('main');
    for (const lines of [alpha, beta, seeds(run, 'app3').lines]) expect(lines).not.toContain(TOOL);
  });

  it('an application with no seed prints nothing and exits 0', () => {
    const run = systemRun(cleanups);
    const result = seeds(run, 'app3');
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('takes the unit id as well, and prints the same lines', () => {
    const run = systemRun(cleanups);
    expect(seeds(run, 'app1.system').lines).toEqual(seeds(run, 'app1').lines);
  });

  it('reads no state and changes no file of the run', () => {
    const run = systemRun(cleanups);
    const before = JSON.stringify(run.readState());
    seeds(run, 'app1');
    expect(JSON.stringify(run.readState())).toBe(before);
    expect(run.readState().systemFindings).toBeUndefined();
  });

  it('exits 2 for an application that does not exist and for an id that is not one', () => {
    const run = systemRun(cleanups);
    const missing = seeds(run, 'app4');
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain('3 application roots');
    for (const id of ['app0', 'F1', 'app1.findings', 'overview', 'app01']) expect(seeds(run, id).status, id).toBe(2);
  });
});
