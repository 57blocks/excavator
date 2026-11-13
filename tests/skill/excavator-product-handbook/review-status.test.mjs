// openspec change handbook-design-review, task 4.1: the resume commands of the design-problems phase read the files
// and decide each batch's state (write, verify, prune, done); reset and skip clear a batch; titles and summary print
// what the cross writer and the user's report need; the cross batch reads only the pairs that span batches.
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { runHandbook } from './helpers.mjs';
import { FORM } from './md-run-fixture.mjs';
import { goodItem, reviewRun } from './review-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

function make() {
  const run = reviewRun(cleanups);
  run.facts();
  const cmd = (sub, ...args) => runHandbook(['review', sub, run.out, ...args, '--project', run.root]);
  run.status = () => cmd('status').lines;
  run.reset = (batch) => cmd('reset', batch);
  run.skip = (batch) => cmd('skip', batch);
  run.titles = () => cmd('titles').lines;
  run.summary = () => cmd('summary').lines;
  run.prune = (batch) => cmd('prune', batch);
  run.has = (name) => existsSync(join(run.out, name));
  return run;
}

describe('review status', () => {
  it('says write for batches without a file, verify for items to judge, prune for an empty batch, and the reasons of a refused file', () => {
    const run = make();
    expect(run.status()).toEqual(['b1\twrite\tOrder handling', 'b2\twrite\tAutomatic work', 'cross\twrite\tcross']);
    run.writeBatch('b1', [goodItem()]);
    run.writeBatch('b2', []);
    run.writeBatch('cross', [goodItem({ dimension: 'slow' })]);
    const lines = run.status();
    expect(lines.slice(0, 3)).toEqual(['b1\tverify\tOrder handling', 'b2\tprune\tAutomatic work', 'cross\twrite\tcross']);
    expect(lines[3]).toMatch(/^ {2}cross item 0: dimension "slow"/);
  });

  it('follows a batch from verify through prune to done, and an empty batch needs no verdicts', () => {
    const run = make();
    run.writeBatch('b1', [goodItem()]);
    run.writeBatch('b2', []);
    run.writeJson(join(run.out, 'entries', 'review', 'b1.verdicts.json'), { verdicts: [{ index: 0, verdict: 'supported', reason: 'ok' }] });
    expect(run.status().slice(0, 2)).toEqual(['b1\tprune\tOrder handling', 'b2\tprune\tAutomatic work']);
    expect(run.prune('b1').status).toBe(0);
    expect(run.prune('b2').lines[0]).toBe('b2: kept 0, removed 0');
    expect(run.status().slice(0, 2)).toEqual(['b1\tdone\tOrder handling', 'b2\tdone\tAutomatic work']);
  });

  it('refuses a run without facts', () => {
    const run = reviewRun(cleanups);
    const result = runHandbook(['review', 'status', run.out, '--project', run.root]);
    expect(result.status).toBe(1);
    expect(result.lines[0]).toMatch(/review-facts.json is missing; run review facts first/);
  });
});

describe('review reset and skip', () => {
  it('reset deletes the batch file, verdicts, unpruned copy and only that batch\'s removal records', () => {
    const run = make();
    run.writeBatch('b1', [goodItem()]);
    run.writeBatch('b2', [goodItem({ dimension: 'dead-end', impact: 'low', features: ['F3'], title: 'A reminder cannot be stopped', situation: 'Sending a reminder is one step', consequence: 'Nobody can cancel it', cites: [`${FORM}:11`] })]);
    for (const batch of ['b1', 'b2']) run.writeJson(join(run.out, 'entries', 'review', `${batch}.verdicts.json`), { verdicts: [{ index: 0, verdict: 'unsupported', reason: batch }] });
    run.prune('b1');
    run.prune('b2');
    expect(run.reset('b1').lines).toEqual(['b1: cleared']);
    for (const name of ['b1.json', 'b1.verdicts.json', 'b1.unpruned.json']) expect(run.has(`entries/review/${name}`)).toBe(false);
    expect(run.has('entries/review/b2.verdicts.json')).toBe(true);
    expect(JSON.parse(readFileSync(join(run.out, 'entries', 'review-removed.json'), 'utf-8')).removed.map((entry) => entry.batch)).toEqual(['b2']);
    expect(run.status()[0]).toBe('b1\twrite\tOrder handling');
  });

  it('skip leaves an empty batch that is ready to prune', () => {
    const run = make();
    run.writeBatch('b1', [goodItem()]);
    expect(run.skip('b1').lines).toEqual(['b1: emptied']);
    expect(JSON.parse(readFileSync(join(run.out, 'entries', 'review', 'b1.json'), 'utf-8'))).toEqual({ items: [] });
    expect(run.status()[0]).toBe('b1\tprune\tOrder handling');
    expect(run.reset('b9').status).toBe(1);
  });
});

describe('review titles, summary and the cross pairs', () => {
  it('titles lists the items of the non-cross batches that pass, one line each', () => {
    const run = make();
    run.writeBatch('b1', [goodItem()]);
    run.writeBatch('b2', [goodItem({ dimension: 'slow' })]);
    run.writeBatch('cross', [goodItem()]);
    expect(run.titles()).toEqual(['b1\titem 0\tduplication\tmedium\tF1,F2\tTwo places end an order']);
    const empty = make();
    expect(empty.titles()).toEqual(['(no item in any batch)']);
  });

  it('summary prints kept and removed for each pruned batch only', () => {
    const run = make();
    expect(run.summary()).toEqual(['(no batch has been pruned)']);
    run.writeBatch('b1', [goodItem(), goodItem({ title: 'Another' })]);
    run.writeJson(join(run.out, 'entries', 'review', 'b1.verdicts.json'), { verdicts: [{ index: 0, verdict: 'supported', reason: 'ok' }, { index: 1, verdict: 'unsupported', reason: 'no' }] });
    run.prune('b1');
    expect(run.summary()).toEqual(['b1\tOrder handling\tkept=1\tremoved=1']);
  });

  it('facts for the cross batch prints only the pairs that span batches', () => {
    const run = make();
    const lines = runHandbook(['review', 'facts', run.out, 'cross']).lines.filter((line) => line.startsWith('PAIR'));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((line) => line.startsWith('PAIR\tacross'))).toBe(true);
    const all = runHandbook(['review', 'facts', run.out]).lines.filter((line) => line.startsWith('PAIR'));
    expect(all.length).toBeGreaterThanOrEqual(lines.length);
  });
});

