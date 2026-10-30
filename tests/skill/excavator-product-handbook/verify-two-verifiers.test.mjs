// Design D14 of openspec change product-handbook-map: every part is judged by
// two verifiers that do not see each other, in part-<n>.a.json and
// part-<n>.b.json. Each file is checked on its own (conservation, the three
// words, the reason rules); an item is verified only when both say verified,
// contradicted when either says contradicted, unverified otherwise, and the
// reason kept is that of a verdict that is not verified. Every rejection is
// paired with a control that passes.
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { clone, judge, makeCheckedMapRun } from './helpers.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

function checkedRun() {
  const run = makeCheckedMapRun();
  cleanups.push(run.cleanup);
  run.writeEntry('F1', clone(run.entry));
  const checked = run.run('check-entry', 'F1');
  expect(checked.status, checked.stdout).toBe(0);
  return run;
}

const verdictPath = (run, round, letter, part = 1) => join(run.out, 'verdicts', `round-${round}`, 'F1', `part-${part}.${letter}.json`);
const stateOf = (run) => run.readJson('state.json').features.F1;
const rewriteOf = (run) => JSON.parse(readFileSync(join(run.out, 'rewrite', 'F1.json'), 'utf-8')).items;
const ALL_ITEMS = [
  'purpose', 'who[0]', 'where[0]', 'where[1]', 'screens[0]',
  'screens[0].fields[0]', 'screens[0].fields[0].rules[0]',
  'screens[0].fields[1]', 'screens[0].fields[1].rules[0]', 'screens[0].fields[1].rules[1]',
  'operations[0].sentences[0]', 'operations[0].sentences[1]', 'states[0]', 'states[1]',
];

/** The reason a verifier gives for a verdict: it names the verifier, so the one kept can be told. */
const reasonOf = (side, word) => `The ${side} pass found the code ${word} the claim.`;
const gives = (side, table) => (item) => {
  const word = table[item.id] ?? 'verified';
  return { verdict: word, reason: reasonOf(side, word === 'verified' ? 'backs' : word === 'unverified' ? 'silent on' : 'against') };
};
const pass = (side, word) => reasonOf(side, word === 'verified' ? 'backs' : word === 'unverified' ? 'silent on' : 'against');

describe('verdicts: combining the two verifiers of a part', () => {
  it('combines per item: both verified is verified, either contradicted is contradicted, else unverified, with the reason of the one that is not verified', () => {
    const run = checkedRun();
    const a = { 'who[0]': 'verified', 'where[0]': 'unverified', 'where[1]': 'contradicted', 'states[0]': 'unverified', 'states[1]': 'contradicted' };
    const b = { 'who[0]': 'unverified', 'where[0]': 'contradicted', 'where[1]': 'verified', 'states[0]': 'unverified', 'states[1]': 'contradicted' };
    const result = judge(run, 'F1', 1, gives('first', a), gives('second', b));
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines[0]).toBe('F1: 5 items to rewrite');
    // purpose and every other item both verifiers confirmed is not in the list.
    expect(rewriteOf(run).map((item) => [item.id, item.verdict, item.reason])).toEqual([
      ['who[0]', 'unverified', pass('second', 'unverified')],
      ['where[0]', 'contradicted', pass('second', 'contradicted')],
      ['where[1]', 'contradicted', pass('first', 'contradicted')],
      ['states[0]', 'unverified', pass('first', 'unverified')],
      ['states[1]', 'contradicted', pass('first', 'contradicted')],
    ]);
  });

  it('verifies the feature at once only when both verifiers verified every item', () => {
    const run = checkedRun();
    const one = judge(run, 'F1', 1, gives('first', {}), gives('second', { purpose: 'unverified' }));
    expect(one.status, one.stdout).toBe(0);
    expect(one.lines[0]).toBe('F1: 1 item to rewrite');
    expect(stateOf(run)).toEqual({ status: 'checked', attempts: 0, rewriting: true });
    // The control: the same two files, both verified, verify the feature.
    const run2 = checkedRun();
    const both = judge(run2, 'F1', 1, gives('first', {}), gives('second', {}));
    expect(both.lines[0]).toBe('F1: verified (14 items)');
    expect(stateOf(run2).status).toBe('verified');
  });

  it('combines the same way in round 2: what is not verified by both is removed, with the kept verdict and reason', () => {
    const run = checkedRun();
    const bad = ['who[0]', 'screens[0].fields[1].rules[0]', 'states[1]', 'operations[0].sentences[1]', 'where[1]'];
    expect(judge(run, 'F1', 1, (item) => (bad.includes(item.id) ? { verdict: 'unverified', reason: 'Round 1 found no line.' } : 'verified')).status).toBe(0);
    const a = { 'who[0]': 'verified', 'screens[0].fields[1].rules[0]': 'unverified', 'states[1]': 'contradicted', 'operations[0].sentences[1]': 'unverified', 'where[1]': 'verified' };
    const b = { 'who[0]': 'unverified', 'screens[0].fields[1].rules[0]': 'contradicted', 'states[1]': 'verified', 'operations[0].sentences[1]': 'unverified', 'where[1]': 'verified' };
    const result = judge(run, 'F1', 2, gives('first', a), gives('second', b));
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines[0]).toBe('F1: verified, 4 items removed');
    const removed = stateOf(run).removed.filter((record) => record.verdict !== 'withParent');
    expect(removed.map((record) => [record.path, record.verdict, record.reason])).toEqual([
      ['who[0]', 'unverified', pass('second', 'unverified')],
      ['screens[0].fields[1].rules[0]', 'contradicted', pass('second', 'contradicted')],
      ['operations[0].sentences[1]', 'unverified', pass('first', 'unverified')],
      ['states[1]', 'contradicted', pass('first', 'contradicted')],
    ]);
    // where[1] was confirmed by both and stays in the entry.
    const entry = JSON.parse(readFileSync(join(run.out, 'entries', 'F1.json'), 'utf-8'));
    expect(entry.where).toHaveLength(2);
    expect(entry.who).toEqual([]);
  });
});

describe('verdicts: each of the two files is checked on its own', () => {
  const setup = () => {
    const run = checkedRun();
    expect(run.run('slices', 'F1').status).toBe(0);
    return run;
  };
  const verdictsFor = (ids, extra = []) => ({ verdicts: [...ids, ...extra].map((id) => ({ id, verdict: 'verified', reason: 'The code shown decides it.' })) });
  const writeFile = (run, letter, content) => {
    mkdirSync(join(run.out, 'verdicts', 'round-1', 'F1'), { recursive: true });
    writeFileSync(verdictPath(run, 1, letter), `${JSON.stringify(content, null, 2)}\n`);
  };

  it('names the missing b file by part and letter, dispatches only it, and records nothing', () => {
    const run = setup();
    writeFile(run, 'a', verdictsFor(ALL_ITEMS));
    const bad = run.run('verdicts', 'F1', '--round', '1');
    expect(bad.status, bad.stdout).toBe(1);
    expect(bad.stdout).toContain('part 1b: verdicts/round-1/F1/part-1.b.json is missing');
    expect(bad.stdout).not.toMatch(/part 1a:/);
    expect(bad.lines.at(-1)).toMatch(/^Next: dispatch the verifier once more for F1 for exactly the missing part: 1b,/);
    expect(stateOf(run)).toEqual({ status: 'checked', attempts: 0 });
    expect(existsSync(join(run.out, 'rewrite', 'F1.json'))).toBe(false);
    writeFile(run, 'b', verdictsFor(ALL_ITEMS));
    expect(run.run('verdicts', 'F1', '--round', '1').status).toBe(0);
  });

  it('rejects an extra id in the b file with its letter, although the a file is whole, and records nothing', () => {
    const run = setup();
    writeFile(run, 'a', verdictsFor(ALL_ITEMS));
    writeFile(run, 'b', verdictsFor(ALL_ITEMS, ['states[7]']));
    const bad = run.run('verdicts', 'F1', '--round', '1');
    expect(bad.status, bad.stdout).toBe(1);
    expect(bad.stdout).toContain('part 1b: states[7]: is not an item of the verify file');
    expect(bad.stdout).not.toMatch(/part 1a:/);
    expect(bad.lines.at(-1)).toMatch(/^Next: delete the verdict file of part 1b and dispatch the verifier once more for part 1b with the lines above; nothing was recorded$/);
    expect(stateOf(run)).toEqual({ status: 'checked', attempts: 0 });
    writeFile(run, 'b', verdictsFor(ALL_ITEMS));
    expect(run.run('verdicts', 'F1', '--round', '1').status).toBe(0);
  });

  it('rejects an item the a file leaves out although the b file has it, and does not take the verdict from b alone', () => {
    const run = setup();
    writeFile(run, 'a', verdictsFor(ALL_ITEMS.filter((id) => id !== 'purpose')));
    writeFile(run, 'b', verdictsFor(ALL_ITEMS));
    const bad = run.run('verdicts', 'F1', '--round', '1');
    expect(bad.status, bad.stdout).toBe(1);
    expect(bad.stdout).toContain('part 1a: purpose: no verdict');
    expect(stateOf(run).status).toBe('checked');
  });

  it('applies the reason gate to the b file as to the a file', () => {
    const run = setup();
    writeFile(run, 'a', verdictsFor(ALL_ITEMS));
    writeFile(run, 'b', { verdicts: verdictsFor(ALL_ITEMS).verdicts.map((v) => (v.id === 'who[0]' ? { ...v, verdict: 'unverified', reason: 'The check in is_admin shows nothing.' } : v)) });
    const bad = run.run('verdicts', 'F1', '--round', '1');
    expect(bad.status, bad.stdout).toBe(1);
    expect(bad.stdout).toMatch(/part 1b: who\[0\]\.reason: "is_admin" is not allowed/);
    expect(stateOf(run).status).toBe('checked');
  });
});
