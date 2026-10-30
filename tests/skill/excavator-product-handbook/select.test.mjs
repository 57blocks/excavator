// `handbook.mjs select` (design D9, --features): a list of feature ids or
// names is resolved against the checked map. Each item must match exactly one
// feature; anything else stops the run with every id and name printed.
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { clone, makeCheckedMapRun, runHandbook } from './helpers.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

function newRun() {
  const run = makeCheckedMapRun();
  cleanups.push(run.cleanup);
  return run;
}

const select = (run, list, ...rest) => run.run('select', ...(list === undefined ? [] : ['--features', list]), ...rest);
const NEXT = 'Next: stop the run; report the lines above to the user and dispatch no lane';

// The fixture map holds F1 Orders, F2 Archive, F3 Reminders, F4 Admin tool, F5 Orders (same name as F1, another area).
const ALL_FEATURE_LINES = ['F1  Orders', 'F2  Archive', 'F3  Reminders', 'F4  Admin tool', 'F5  Orders'];

describe('select: a list that resolves', () => {
  it('prints the id of an exact id match', () => {
    const run = newRun();
    const result = select(run, 'F3');
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.lines).toEqual(['F3']);
  });

  it('matches a name ignoring case and surrounding white space, and prints ids in map order', () => {
    const run = newRun();
    const result = select(run, '  REMINDERS , F1 ,admin TOOL');
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.lines).toEqual(['F1', 'F3', 'F4']);
  });

  it('prints an id once when two items name the same feature', () => {
    const run = newRun();
    const result = select(run, 'F3,reminders,F3');
    expect(result.status).toBe(0);
    expect(result.lines).toEqual(['F3']);
  });

  it('changes no file of the run', () => {
    const run = newRun();
    const before = readFileSync(join(run.out, 'state.json'), 'utf-8');
    expect(select(run, 'F2').status).toBe(0);
    expect(readFileSync(join(run.out, 'state.json'), 'utf-8')).toBe(before);
  });
});

describe('select: a list that does not resolve exits 1 and lists every feature', () => {
  it('names an item that matches no feature', () => {
    const run = newRun();
    const result = select(run, 'F3,Nowhere');
    expect(result.status).toBe(1);
    expect(result.lines[0]).toBe('"Nowhere": matches no feature id or name');
    expect(result.lines.slice(1, -1)).toEqual(ALL_FEATURE_LINES);
    expect(result.lines.at(-1)).toBe(NEXT);
    // Nothing of the good item F3 is printed as a selection.
    expect(result.lines).not.toContain('F3');
  });

  it('names an item that matches several features (two features share a name)', () => {
    const run = newRun();
    const result = select(run, 'Orders');
    expect(result.status).toBe(1);
    expect(result.lines[0]).toBe('"Orders": matches 2 features (F1, F5); use an id');
    expect(result.lines.slice(1, -1)).toEqual(ALL_FEATURE_LINES);
    expect(result.lines.at(-1)).toBe(NEXT);
  });

  it('names an item that is the id of one feature and the name of another', () => {
    const run = newRun();
    const map = clone(run.map);
    map.features[2].id = 'Archive';
    run.writeMap(map);
    const result = select(run, 'Archive');
    expect(result.status).toBe(1);
    expect(result.lines[0]).toBe('"Archive": matches 2 features (F2, Archive); use an id');
  });

  it('does no fuzzy matching: a prefix, a lower-case id and a word of a name all fail', () => {
    const run = newRun();
    for (const item of ['Remind', 'f3', 'Admin', 'F']) {
      const result = select(run, item);
      expect(result.status, item).toBe(1);
      expect(result.lines[0], item).toBe(`"${item}": matches no feature id or name`);
    }
  });

  it('names every failing item, one line each, before the features', () => {
    const run = newRun();
    const result = select(run, 'Zzz,Orders,F9');
    expect(result.status).toBe(1);
    expect(result.lines.slice(0, 3)).toEqual([
      '"Zzz": matches no feature id or name',
      '"Orders": matches 2 features (F1, F5); use an id',
      '"F9": matches no feature id or name',
    ]);
    expect(result.lines.slice(3, -1)).toEqual(ALL_FEATURE_LINES);
  });
});

describe('select: the map is checked again', () => {
  it('refuses a map that no longer passes, with the map lines and no selection', () => {
    const run = newRun();
    const map = clone(run.map);
    map.features[2].candidates = [];
    run.writeMap(map);
    const result = select(run, 'F3');
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/not in any feature and not in unassigned/);
    expect(result.lines).not.toContain('F3');
  });

  it('treats a run with no map.json as a usage error, like check-map', () => {
    const run = newRun();
    rmSync(join(run.out, 'map.json'));
    const result = select(run, 'F3');
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/map\.json/);
  });
});

describe('select: usage errors exit 2', () => {
  it('needs --features', () => {
    const run = newRun();
    const result = select(run, undefined);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/--features/);
  });

  it('refuses an empty list and an empty item', () => {
    const run = newRun();
    for (const list of ['', ' ', 'F1,,F2', ',']) {
      const result = select(run, list);
      expect(result.status, JSON.stringify(list)).toBe(2);
      expect(result.stderr, JSON.stringify(list)).toMatch(/empty/);
    }
  });

  it('needs --project and an out directory that exists', () => {
    const run = newRun();
    expect(runHandbook(['select', run.out, '--features', 'F1']).status).toBe(2);
    expect(runHandbook(['select', join(run.base, 'nope'), '--features', 'F1', '--project', run.root]).status).toBe(2);
  });
});
