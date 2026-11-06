// O1 (unit) of openspec change handbook-system-findings: the unit `app<n>.system`
// of an application root; its state under the optional key `systemFindings`
// (planned without the key, the root recorded, exit 1 when the root changed);
// its file with the shape of a findings file; mark, slices, verdicts, trace and
// trace-verdicts run on it; an application without a seed is verified at once.
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { judge, runHandbook, traceFeature, verifyChecked } from './helpers.mjs';
import { checkedSystemRun, systemId, systemRun } from './system-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const ID = systemId(1);
const readJsonAt = (path) => JSON.parse(readFileSync(path, 'utf-8'));
const record = (run, key = 'app1') => run.readState().systemFindings[key];

describe('the state key systemFindings', () => {
  it('reads a state without the key as planned with no attempt, so an old output directory needs no migration', () => {
    const run = systemRun(cleanups);
    expect(run.readState().systemFindings).toBeUndefined();
    const slices = run.run('slices', ID);
    expect(slices.status).toBe(1);
    expect(slices.lines[0]).toBe('app1.system: is planned; only a checked feature is verified');
    expect(run.readState().systemFindings).toBeUndefined();
  });

  it('mark records the dispatch under the application key with the application root, and leaves the features alone', () => {
    const run = systemRun(cleanups);
    expect(run.run('mark', ID, 'dispatched').lines).toEqual(['app1.system: dispatched, attempts 1']);
    expect(record(run)).toEqual({ status: 'dispatched', attempts: 1, root: 'alpha' });
    expect(run.run('mark', systemId(2), 'dispatched').lines).toEqual(['app2.system: dispatched, attempts 1']);
    expect(record(run, 'app2')).toEqual({ status: 'dispatched', attempts: 1, root: 'beta' });
    expect(run.readState().features.F1).toEqual({ status: 'planned', attempts: 0 });
    expect(run.readState().findings).toBeUndefined();
  });

  it('keeps the root through every later change of the record', () => {
    const run = systemRun(cleanups);
    run.run('mark', ID, 'dispatched');
    run.writeSystem(1);
    expect(run.run('check-system-findings', ID).lines).toEqual(['app1.system: checked']);
    expect(record(run)).toEqual({ status: 'checked', attempts: 1, root: 'alpha' });
    expect(judge(run, ID).status).toBe(0);
    expect(record(run)).toMatchObject({ status: 'confirmed', root: 'alpha' });
    expect(traceFeature(run, ID).status).toBe(0);
    expect(record(run)).toMatchObject({ status: 'verified', root: 'alpha' });
  });

  it('a lane that wrote nothing is failed at lane and the record still holds the root', () => {
    const run = systemRun(cleanups);
    run.run('mark', ID, 'dispatched');
    const result = run.run('check-system-findings', ID);
    expect(result.status).toBe(1);
    expect(result.lines[0]).toBe('app1.system: lane-wrote-nothing: entries/app1.system.json is missing');
    expect(result.lines.at(-1)).toMatch(/^Next: delete app1\.system's entry, mark it dispatched and re-dispatch it once/);
    expect(record(run)).toMatchObject({ status: 'failed', attempts: 1, root: 'alpha', failure: { step: 'lane' } });
  });

  it('refuses a third dispatch and a dispatch of a unit that is already checked', () => {
    const run = checkedSystemRun(cleanups);
    expect(run.run('mark', ID, 'dispatched').lines).toEqual(['app1.system: already checked; it is not written again']);
    const other = systemRun(cleanups);
    for (let i = 0; i < 2; i += 1) expect(other.run('mark', ID, 'dispatched').status).toBe(0);
    expect(other.run('mark', ID, 'dispatched').lines).toEqual(['app1.system: attempts is already 2, the most a lane gets']);
  });

  it('a state whose systemFindings is not an object of entries is refused with a line that names the key', () => {
    const run = systemRun(cleanups);
    const state = run.readState();
    state.systemFindings = [];
    run.writeState(state);
    const result = run.run('mark', ID, 'dispatched');
    expect(result.status).toBe(1);
    expect(result.lines[0]).toContain('systemFindings');
    state.systemFindings = { app1: { status: 'nonsense', attempts: 0 } };
    run.writeState(state);
    expect(run.run('mark', ID, 'dispatched').lines[0]).toContain('systemFindings app1');
  });
});

describe('the application root recorded in the state', () => {
  const tampered = (run, root) => {
    const state = run.readState();
    state.systemFindings.app1.root = root;
    run.writeState(state);
  };

  it('a root that differs from the one at that index today exits 1 and suggests --fresh, in every command that reads the unit', () => {
    const run = systemRun(cleanups);
    run.run('mark', ID, 'dispatched');
    run.writeSystem(1);
    expect(run.run('check-system-findings', ID).status).toBe(0);
    tampered(run, 'elsewhere');
    const before = readFileSync(join(run.out, 'state.json'), 'utf-8');
    for (const args of [['mark', ID, 'failed', 'lane', 'gone'], ['check-system-findings', ID], ['try-system-findings', ID], ['slices', ID]]) {
      const result = run.run(...args);
      expect(result.status, args.join(' ')).toBe(1);
      expect(result.lines.join('\n'), args.join(' ')).toContain('--fresh');
      expect(result.lines.join('\n'), args.join(' ')).toContain('"elsewhere"');
      expect(result.lines.join('\n'), args.join(' ')).toContain('"alpha"');
    }
    expect(readFileSync(join(run.out, 'state.json'), 'utf-8')).toBe(before);
  });

  it('also stops verdicts, trace and trace-verdicts', () => {
    const run = checkedSystemRun(cleanups);
    expect(run.run('slices', ID).status).toBe(0);
    tampered(run, 'elsewhere');
    expect(run.run('verdicts', ID, '--round', '1').status).toBe(1);
    const other = checkedSystemRun(cleanups);
    expect(judge(other, ID).status).toBe(0);
    tampered(other, 'elsewhere');
    for (const command of ['trace', 'trace-verdicts']) {
      const result = other.run(command, ID);
      expect(result.status, command).toBe(1);
      expect(result.lines.join('\n'), command).toContain('--fresh');
    }
  });

  it('the same root is no problem, and the record of the other application is not looked at', () => {
    const run = systemRun(cleanups);
    run.run('mark', ID, 'dispatched');
    run.run('mark', systemId(2), 'dispatched');
    const state = run.readState();
    state.systemFindings.app2.root = 'elsewhere';
    run.writeState(state);
    run.writeSystem(1);
    expect(run.run('check-system-findings', ID).status).toBe(0);
  });

  it('a record without a root (an unit marked by hand) is given the root of today by the next command that writes it', () => {
    const run = systemRun(cleanups);
    const state = run.readState();
    state.systemFindings = { app1: { status: 'dispatched', attempts: 1 } };
    run.writeState(state);
    run.writeSystem(1);
    expect(run.run('check-system-findings', ID).status).toBe(0);
    expect(record(run)).toEqual({ status: 'checked', attempts: 1, root: 'alpha' });
  });
});

describe('the unit id', () => {
  it('is app<n>.system with n from 1 in the order applications prints the roots; an id outside that exits 2', () => {
    const run = systemRun(cleanups);
    run.writeSystem(1);
    expect(runHandbook(['applications', run.root]).lines).toEqual(['Application roots: 3', 'alpha\tpackage.json', 'beta\tpackage.json', 'gamma\tpackage.json']);
    for (const id of ['app0.system', 'app4.system', 'app01.system', 'app1.systems', 'app1']) expect(run.run('mark', id, 'dispatched').status, id).toBe(2);
    expect(run.readState().systemFindings).toBeUndefined();
    expect(run.run('check-system-findings', 'app4.system').status).toBe(2);
  });

  it('is a unit of its own: the findings commands refuse it and the system commands refuse a feature id', () => {
    const run = systemRun(cleanups);
    run.writeSystem(1);
    expect(run.run('check-findings', ID).status).toBe(2);
    expect(run.run('try-findings', ID).status).toBe(2);
    for (const id of ['F1', 'F1.findings', 'overview']) {
      expect(run.run('check-system-findings', id).status, id).toBe(2);
      expect(run.run('try-system-findings', id).status, id).toBe(2);
    }
  });

  it('takes app<n> as well as the unit id and prints the unit id', () => {
    const run = systemRun(cleanups);
    run.writeSystem(1);
    expect(run.run('try-system-findings', 'app1').lines).toEqual(['app1.system: ok']);
    expect(run.run('check-system-findings', 'app1').lines).toEqual(['app1.system: checked']);
  });

  it('refuses a file whose id is not the unit it is checked as', () => {
    const run = systemRun(cleanups);
    run.writeSystem(1, { ...run.systemDoc(1), id: 'app2.system' });
    const result = run.run('check-system-findings', ID);
    expect(result.status).toBe(1);
    expect(result.lines[0]).toBe('id: "app2.system" is not "app1.system", the feature this entry is checked as');
  });
});

describe('check-system-findings and try-system-findings', () => {
  it('records checked under systemFindings and leaves features and findings alone; try records nothing', () => {
    const run = systemRun(cleanups);
    run.writeSystem(1);
    const before = readFileSync(join(run.out, 'state.json'), 'utf-8');
    expect(run.run('try-system-findings', ID).lines).toEqual(['app1.system: ok']);
    expect(readFileSync(join(run.out, 'state.json'), 'utf-8')).toBe(before);
    const result = run.run('check-system-findings', ID);
    expect(result.lines).toEqual(['app1.system: checked']);
    expect(result.status).toBe(0);
    const state = run.readState();
    expect(state.systemFindings).toEqual({ app1: { status: 'checked', attempts: 0, root: 'alpha' } });
    expect(state.findings).toBeUndefined();
    expect(state.features.F1).toEqual({ status: 'planned', attempts: 0 });
  });

  it('an empty list is verified at once, with its digest, and nothing is left to verify', () => {
    const run = systemRun(cleanups);
    run.writeSystem(1, { ...run.systemDoc(1), findings: [], unknowns: [] });
    const result = run.run('check-system-findings', ID);
    expect(result.lines).toEqual(['app1.system: verified (0 findings)']);
    expect(record(run)).toMatchObject({ status: 'verified', attempts: 0, root: 'alpha' });
    expect(typeof record(run).entryDigest).toBe('string');
    expect(run.run('slices', ID).lines[0]).toBe('app1.system: is verified; only a checked feature is verified');
  });

  it('a file that fails a check is failed with the Next line of an entry, and is never verified by being short', () => {
    const run = systemRun(cleanups);
    run.writeSystem(1, { ...run.systemDoc(1), findings: [], unknowns: [{ item: 'a_b', searched: 'x' }] });
    const result = run.run('check-system-findings', ID);
    expect(result.status).toBe(1);
    expect(record(run).status).toBe('failed');
    expect(result.lines.at(-1)).toMatch(/^Next: delete app1\.system's entry/);
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

describe('slices, verdicts, trace and trace-verdicts on a system unit', () => {
  it('cuts one item per finding and writes the claim from the fixed texts: System finding, the category name, the statement', () => {
    const run = checkedSystemRun(cleanups);
    const result = run.run('slices', ID);
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines[0]).toBe('app1.system: round 1, 2 items in 1 part');
    const { items } = readJsonAt(join(run.out, 'verify', 'round-1', ID, 'part-1.json'));
    expect(items.map((item) => item.id)).toEqual(['findings[0]', 'findings[1]']);
    expect(items[0].claim).toBe('System finding > Notifications not sent, sent to the wrong people or wrong in content > The mail helper reports every message as sent without sending anything.');
    expect(items[1].claim.startsWith('System finding > Date, time zone and calendar defects > ')).toBe(true);
  });

  it('removes a contradicted finding at once and records it under systemFindings', () => {
    const run = checkedSystemRun(cleanups);
    const result = judge(run, ID, 1, (item) => (item.id === 'findings[0]' ? { verdict: 'contradicted', reason: 'The code shown does send the message.' } : 'verified'));
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines[0]).toBe('app1.system: confirmed, 1 item removed');
    expect(record(run).removed.map((entry) => [entry.path, entry.verdict])).toEqual([['findings[0]', 'contradicted']]);
    expect(record(run).removed[0].claim.startsWith('System finding > ')).toBe(true);
    expect(run.readSystem(1).findings).toHaveLength(1);
  });

  it('the trace items of a statement with scope words carry them, exactly as findings units do, and a holds verdict needs a case for each', () => {
    const run = checkedSystemRun(cleanups);
    expect(judge(run, ID).status).toBe(0);
    expect(run.run('trace', ID).status).toBe(0);
    const { items } = readJsonAt(join(run.out, 'trace', ID, 'part-1.json'));
    expect(items.map((item) => item.scopeWords)).toEqual([['every'], ['whatever']]);
    const bare = traceFeature(run, ID, () => ({ verdict: 'holds', scope: [] }));
    expect(bare.status).toBe(1);
    expect(bare.stdout).toContain('scope');
    expect(record(run).status).toBe('confirmed');
  });

  it('a negative or contrasting word in a statement is a scope word: the trace item carries "does not" and "rather than"', () => {
    const run = systemRun(cleanups);
    const doc = run.systemDoc(1);
    doc.findings[0].text = 'The mail helper does not send the message and answers sent rather than failed.';
    run.writeSystem(1, doc);
    expect(run.run('check-system-findings', ID).status).toBe(0);
    expect(judge(run, ID).status).toBe(0);
    expect(run.run('trace', ID).status).toBe(0);
    expect(readJsonAt(join(run.out, 'trace', ID, 'part-1.json')).items[0].scopeWords).toEqual(['does not', 'rather than']);
  });

  it('a tracer that contradicts a finding removes it, with the reasons kept; the unit is verified with the rest', () => {
    const run = checkedSystemRun(cleanups);
    expect(judge(run, ID).status).toBe(0);
    const traced = traceFeature(run, ID, (item) => (item.id === 'findings[1]' ? { verdict: 'contradicted', reason: 'The hour is read from the settings of each reader.', at: [{ file: 'alpha/src/lib/mailer.js', line: 2 }] } : 'holds'));
    expect(traced.status, traced.stdout).toBe(0);
    expect(traced.lines).toEqual(['app1.system: verified, 1 item removed']);
    expect(record(run)).toMatchObject({ status: 'verified', root: 'alpha' });
    expect(record(run).removed[0]).toMatchObject({ path: 'findings[1]', step: 'trace' });
    expect(run.readSystem(1).findings).toHaveLength(1);
  });

  it('every finding removed leaves a verified unit with none, not a failed one', () => {
    const run = checkedSystemRun(cleanups);
    const result = judge(run, ID, 1, () => ({ verdict: 'contradicted', reason: 'The code shown does not say so.' }));
    expect(result.lines[0]).toBe('app1.system: confirmed, 2 items removed');
    expect(run.run('trace', ID).lines[0]).toBe('app1.system: 0 items in 0 parts');
    expect(run.run('trace-verdicts', ID).lines).toEqual(['app1.system: verified (0 findings)']);
    expect(record(run).status).toBe('verified');
  });

  it('a unit goes end to end to verified', () => {
    const run = checkedSystemRun(cleanups);
    verifyChecked(run, ID);
    expect(record(run)).toMatchObject({ status: 'verified', attempts: 0, root: 'alpha' });
    expect(run.readState().features.F1.status).toBe('planned');
  });

  it('a verified unit is the file the tracers saw: a changed file starts over as checked', () => {
    const run = checkedSystemRun(cleanups);
    verifyChecked(run, ID);
    const doc = run.readSystem(1);
    doc.findings[0].text = 'The mail helper reports each message as sent without sending anything.';
    run.writeSystem(1, doc);
    expect(run.run('check-system-findings', ID).lines).toEqual(['app1.system: checked']);
    expect(record(run)).toEqual({ status: 'checked', attempts: 0, root: 'alpha' });
  });
});
