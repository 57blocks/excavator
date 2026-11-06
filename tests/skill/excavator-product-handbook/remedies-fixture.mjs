/**
 * The run the remedies tests share (openspec change handbook-remedies): the
 * priority fixture's four groups of verified findings, all ranked (authorization
 * P0, error handling P1, time P1, hard-coded P2), helpers to write the remedies
 * file of the lane and the verdict files of the two judges, and a data.json
 * with shared tables. Every sentence is about the fixture's own code.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { expect } from 'vitest';

import { computeCounts, DATA_FORMAT } from '../../../skills/excavator-product-handbook/lib/data-shape.mjs';
import { checkedPriorityRun, judgeAll } from './priority-fixture.mjs';

export const REMEDIES_FORMAT = 'excavator-product-handbook-remedies/1';

/** A run whose findings are verified and ranked (priority verified): the facts hold four ranked groups. */
export function rankedRun(cleanups) {
  const run = checkedPriorityRun(cleanups);
  const verdicts = judgeAll(run);
  expect(verdicts.status, verdicts.stdout).toBe(0);
  return withRemediesHelpers(run, factRows(run));
}

/** The lines `remedy-facts` prints, each split into its tab-separated fields. */
export function factRows(run) {
  const result = run.run('remedy-facts');
  expect(result.status, result.stdout + result.stderr).toBe(0);
  return result.lines.map((line) => line.split('\t'));
}

/** `rows` are the fact lines of the run before any remedies work (after it, remedy-facts prints a note instead). */
export function withRemediesHelpers(run, rows) {
  /** The key of the group of a category (one group each in this fixture). */
  run.groupOf = (category) => rows.find((row) => row[2] === category)[0];
  run.remediesPath = () => join(run.out, 'entries', 'remedies.json');
  run.writeRemedies = (doc) => {
    mkdirSync(dirname(run.remediesPath()), { recursive: true });
    run.writeJson(run.remediesPath(), doc);
  };
  /** The good remedies of the lane: a paragraph for two categories and two recommendations; all of it passes check-remedies. */
  run.goodRemedies = () => ({
    schema: REMEDIES_FORMAT,
    categories: [
      { category: 'authorization', cause: 'Deleting an order asks nothing about who calls.', measure: 'Put one check of the caller in front of every operation on orders.', cites: [run.groupOf('authorization')] },
      { category: 'hard-coded', cause: 'The list of orders is a fixed empty answer.', measure: 'Read the orders from the store instead of answering a fixed list.', cites: [run.groupOf('hard-coded')] },
    ],
    recommendations: [
      { title: 'Check the caller first', text: 'Start with the 1 finding of the highest level, which lets any caller delete an order, and give it a check of the caller.', cites: [run.groupOf('authorization'), 'counts'] },
      { title: 'Replace the fixed list', text: 'The list of orders should answer from the store.', cites: [run.groupOf('hard-coded')] },
    ],
  });
  run.readState = () => run.readJson('state.json');
  return run;
}

/** Mark the unit dispatched, write the good remedies and run check-remedies: the unit ends `checked`. */
export function checkedRemediesRun(cleanups, edit = () => undefined) {
  const run = rankedRun(cleanups);
  expect(run.run('mark', 'remedies', 'dispatched').status).toBe(0);
  const doc = run.goodRemedies();
  run.writeRemedies(edit(doc) ?? doc);
  const result = run.run('check-remedies');
  expect(result.status, result.stdout + result.stderr).toBe(0);
  return run;
}

/** The judge file and the two verdict paths `remedy-judge` printed. */
export function remedyJudgePlan(run) {
  const result = run.run('remedy-judge');
  expect(result.status, result.stdout + result.stderr).toBe(0);
  const line = result.lines.find((one) => one.startsWith('Judge file: '));
  const [judge, verdicts] = line.split(' | ');
  const [a, b] = verdicts.replace('Verdict files: ', '').split(' ');
  return { judge: judge.replace('Judge file: ', ''), a, b };
}

/** Write the two verdict files: `decide(item, letter)` gives a verdict word or `{ verdict, reason }`, default `follows`. */
export function writeRemedyVerdicts(plan, decide = () => 'follows') {
  const items = JSON.parse(readFileSync(plan.judge, 'utf-8')).items;
  for (const [letter, path] of [['a', plan.a], ['b', plan.b]]) {
    const verdicts = items.map((item) => {
      const given = decide(item, letter);
      const verdict = typeof given === 'string' ? { verdict: given } : given;
      return { id: item.id, verdict: verdict.verdict, reason: verdict.reason ?? 'Everything the text says about how things are now is in what it cites.' };
    });
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify({ verdicts }, null, 2)}\n`);
  }
}

/** Judge a checked run: everything `follows` unless `decide` says otherwise; returns the remedy-verdicts result. */
export function judgeRemedies(run, decide) {
  const plan = remedyJudgePlan(run);
  writeRemedyVerdicts(plan, decide);
  return run.run('remedy-verdicts');
}

/** A data.json that passes the shape check, with the given tables: `{ name, mentions: { <application directory>: [lines] } }`. */
export function writeSharedTables(run, tables) {
  const data = {
    format: DATA_FORMAT,
    recognized: [],
    applications: [],
    migrations: [],
    operations: [],
    declarations: [],
    tables: tables.map((table) => ({
      name: table.name,
      sources: [],
      createdBy: null,
      lastChangedBy: null,
      directories: [],
      changes: [],
      mentions: Object.fromEntries(Object.entries(table.mentions).map(([dir, count]) => [dir, Array.from({ length: count }, (_, index) => ({ file: 'src/a.js', line: index + 1, rule: 'a' }))])),
    })),
    dropped: [],
    changedNeverCreated: [],
    declaredOnly: [],
    removedButDeclared: [],
    onlyInMigrations: [],
    gaps: { unsplitMigrations: [], unnamedOperations: [], unresolvedModelNames: [], otherMigrationFiles: [] },
    scanned: { filesSearched: 0, skippedBinary: 0, skippedTooLarge: 0, skippedUnreadable: 0, skippedSymlinks: 0 },
  };
  data.counts = computeCounts(data);
  run.writeJson(join(run.out, 'data.json'), data);
}

/** Give the project one commit by one author, with no user or system git configuration. */
export function commitProject(run) {
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Dev', GIT_AUTHOR_EMAIL: 'dev@example.org', GIT_COMMITTER_NAME: 'Dev', GIT_COMMITTER_EMAIL: 'dev@example.org' };
  for (const args of [['init', '-q'], ['add', '-A'], ['commit', '-q', '-m', 'first']]) {
    const result = spawnSync('git', ['-C', run.root, ...args], { env, encoding: 'utf-8' });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
}
