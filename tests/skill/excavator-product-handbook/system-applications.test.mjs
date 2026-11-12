// O1 (--applications) of openspec change handbook-system-findings: the list of
// application root directories of a run is resolved the way select resolves
// --features: each item must name exactly one application root, the unit ids
// come out in root order, an unknown directory exits 1 and lists every root.
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { systemRun } from './system-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const NEXT = 'Next: stop the run; report the lines above to the user and dispatch no lane';
const ALL_ROOTS = ['app1  alpha', 'app2  beta', 'app3  gamma'];
const select = (run, list, ...rest) => run.run('select', '--applications', list, ...rest);

describe('select --applications: a list that resolves', () => {
  it('prints the unit id of an application root', () => {
    const run = systemRun(cleanups);
    const result = select(run, 'beta');
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.lines).toEqual(['app2.system']);
  });

  it('prints the unit ids in the order of the roots, once each, whatever order and repeats the list has', () => {
    const run = systemRun(cleanups);
    const result = select(run, ' gamma , alpha,gamma ');
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.lines).toEqual(['app1.system', 'app3.system']);
  });

  it('changes no file of the run', () => {
    const run = systemRun(cleanups);
    const before = readFileSync(join(run.out, 'state.json'), 'utf-8');
    expect(select(run, 'alpha').status).toBe(0);
    expect(readFileSync(join(run.out, 'state.json'), 'utf-8')).toBe(before);
  });
});

describe('select --applications: an unknown directory exits 1 and lists every root', () => {
  it('names the item that is not an application root and lists every root with its unit number, then the stop line', () => {
    const run = systemRun(cleanups);
    const result = select(run, 'alpha,nowhere');
    expect(result.status).toBe(1);
    expect(result.lines[0]).toBe('"nowhere": is not an application root');
    expect(result.lines.slice(1)).toEqual([...ALL_ROOTS, NEXT]);
    // The unit ids are not printed when any item fails: nothing to dispatch.
    expect(result.lines.some((line) => line.endsWith('.system'))).toBe(false);
  });

  it('a directory that exists but holds no build manifest of its own is not a root', () => {
    const run = systemRun(cleanups);
    for (const item of ['tools', 'alpha/src', 'alpha/', 'ALPHA', '.']) {
      const result = select(run, item);
      expect(result.status, item).toBe(1);
      expect(result.lines[0], item).toBe(`${JSON.stringify(item)}: is not an application root`);
      expect(result.lines.slice(1), item).toEqual([...ALL_ROOTS, NEXT]);
    }
  });

  it('every failing item is named, in the order of the list', () => {
    const run = systemRun(cleanups);
    const result = select(run, 'one,alpha,two');
    expect(result.lines.slice(0, 2)).toEqual(['"one": is not an application root', '"two": is not an application root']);
  });

  it('a feature id or name is not an application root', () => {
    const run = systemRun(cleanups);
    expect(select(run, 'F1').status).toBe(1);
    expect(select(run, 'app1').status).toBe(1);
  });
});

describe('select: the two options', () => {
  it('an empty item is a usage error, as it is for --features', () => {
    const run = systemRun(cleanups);
    expect(select(run, 'alpha,').status).toBe(2);
    expect(select(run, '').status).toBe(2);
  });

  it('takes one of --features and --applications, not both and not neither', () => {
    const run = systemRun(cleanups);
    expect(run.run('select', '--features', 'F1', '--applications', 'alpha').status).toBe(2);
    expect(run.run('select').status).toBe(2);
    expect(run.run('select', '--features', 'F1').lines).toEqual(['F1']);
  });
});
