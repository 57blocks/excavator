/**
 * The run the priority tests share (openspec change handbook-findings-priority):
 * the findings fixture with F1's three findings and F3's one verified, so the
 * run has four groups of findings (no two findings share a place), and helpers
 * to write the part files of the ranking lanes and the verdict files of the two
 * judges. Every statement and reason is about the fixture's own code.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { expect } from 'vitest';

import { runHandbook, verifyChecked } from './helpers.mjs';
import { findingsRun, unitId } from './findings-fixture.mjs';

export const ENV_PART_SIZE = 'EXCAVATOR_HANDBOOK_PRIORITY_PART_SIZE';

/** A reason that passes every check of reader text, by the category of the finding it is about. */
export const REASONS = {
  authorization: 'Any caller can delete an order, because the handler removes it and answers success to everyone.',
  'error-handling': 'A caller who creates an order is told it was created although nothing was stored.',
  'hard-coded': 'Every caller who opens the list of orders sees it empty.',
  time: 'The reminder goes out at one fixed time for every recipient.',
};
export const CONSEQUENCES_BY_CATEGORY = { authorization: 'othersRecords', 'error-handling': 'wrongResult', 'hard-coded': 'display', time: 'notification' };

/** A run whose findings units F1 (three findings) and F3 (one) are verified; its groups are F1's three and F3's one. */
export function verifiedFindingsRun(cleanups) {
  const run = findingsRun(cleanups);
  for (const featureId of ['F1', 'F3']) {
    run.writeFindings(featureId);
    expect(run.run('check-findings', unitId(featureId)).status).toBe(0);
    verifyChecked(run, unitId(featureId));
  }
  withPriorityHelpers(run);
  run.allKeys = run.keys();
  return run;
}

/** The lines `priority-items` prints for the run, each as its four tab-separated fields. */
export function itemRows(run, ...args) {
  const result = run.run('priority-items', ...args);
  expect(result.status, result.stdout + result.stderr).toBe(0);
  return result.lines.map((line) => line.split('\t'));
}

export function withPriorityHelpers(run) {
  run.readState = () => run.readJson('state.json');
  run.partPath = (n) => join(run.out, 'priority', `part-${n}.json`);
  run.keys = () => itemRows(run).map((row) => row[0]);
  /** The category of the finding that represents the group with this key (the unit id and the index are in the key). */
  run.categoryOfKey = (key) => {
    const found = /^(.+)#(\d+)@/.exec(key);
    return JSON.parse(readFileSync(join(run.out, 'entries', `${found[1]}.json`), 'utf-8')).findings[Number(found[2])].category;
  };
  /** The good item of a group: a consequence and a reason by the category of its finding. */
  run.goodItem = (key) => {
    const category = run.categoryOfKey(key);
    return { key, consequence: CONSEQUENCES_BY_CATEGORY[category], reason: REASONS[category] };
  };
  run.writePart = (n, items) => {
    mkdirSync(dirname(run.partPath(n)), { recursive: true });
    run.writeJson(run.partPath(n), { schema: 'excavator-product-handbook-priority/1', items });
  };
  /** Write every part file with the good item of every group, cutting parts as `size` says (the env value the commands run with). */
  run.writeGoodParts = (size = 40) => {
    const keys = run.keys();
    for (let from = 0, n = 1; from < keys.length; from += size, n += 1) run.writePart(n, keys.slice(from, from + size).map(run.goodItem));
  };
  /** The same as run.run with the part size set (a test shortens it to make several parts from a few groups). */
  run.runSized = (size, command, ...args) => runHandbook([command, run.out, ...args, '--project', run.root], { env: { ...process.env, [ENV_PART_SIZE]: String(size) } });
  return run;
}

/** Mark the unit dispatched, write the good parts and run check-priority: the unit ends `checked`. */
export function checkedPriorityRun(cleanups) {
  const run = verifiedFindingsRun(cleanups);
  expect(run.run('mark', 'priority', 'dispatched').status).toBe(0);
  run.writeGoodParts();
  const result = run.run('check-priority');
  expect(result.status, result.stdout + result.stderr).toBe(0);
  return run;
}

/** The judge files `priority-judge` wrote and the verdict file paths it printed: `[{ part, judge, a, b }]`. */
export function judgePlan(run) {
  const result = run.run('priority-judge');
  expect(result.status, result.stdout + result.stderr).toBe(0);
  return result.lines.filter((line) => line.startsWith('Part ')).map((line) => {
    const [head, judge, verdicts] = line.split(' | ');
    const [a, b] = verdicts.replace('Verdict files: ', '').split(' ');
    return { part: Number(/^Part (\d+)\//.exec(head)[1]), judge: judge.replace('Judge file: ', ''), a, b };
  });
}

/** Write the two verdict files of every part: `decide(group, letter)` gives a verdict word or `{ verdict, reason }`, default `follows`. */
export function writeVerdicts(plan, decide = () => 'follows') {
  for (const { judge, a, b } of plan) {
    const groups = JSON.parse(readFileSync(judge, 'utf-8')).groups;
    for (const [letter, path] of [['a', a], ['b', b]]) {
      const verdicts = groups.map((group) => {
        const given = decide(group, letter);
        const verdict = typeof given === 'string' ? { verdict: given } : given;
        return { id: group.id, verdict: verdict.verdict, reason: verdict.reason ?? `The statements say what the reason says for ${group.consequence}.` };
      });
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify({ verdicts }, null, 2)}\n`);
    }
  }
}

/** Judge a checked run: everything `follows` unless `decide` says otherwise; returns the priority-verdicts result. */
export function judgeAll(run, decide) {
  const plan = judgePlan(run);
  writeVerdicts(plan, decide);
  return run.run('priority-verdicts');
}
