// openspec change handbook-design-review, task 3.1: `review claims` prints each item with the chapter lines that hold its
// citations, `review prune` removes the items judged unsupported, records them, refuses incomplete verdicts, gives the same
// result when run twice, and regenerates a chapter that still passes check.
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { runHandbook } from './helpers.mjs';
import { FORM } from './md-run-fixture.mjs';
import { goodItem, reviewRun } from './review-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const second = () => goodItem({ dimension: 'complexity', impact: 'high', features: ['F1'], title: 'Sending takes many steps', situation: 'Creating an order takes 4 steps', consequence: 'A clerk needs several screens', cites: [`${FORM}:6`] });
const third = () => goodItem({ dimension: 'complexity', impact: 'low', features: ['F2'], title: 'Archiving is slow', situation: 'Orders are archived after 30 days', consequence: 'Old orders stay in the way', cites: [`${FORM}:9`] });

function ready() {
  const run = reviewRun(cleanups);
  run.facts();
  run.writeBatch('b1', [goodItem(), second(), third()]);
  run.writeBatch('b2', []);
  run.writeBatch('cross', []);
  run.claims = (batch) => runHandbook(['review', 'claims', run.out, batch]);
  run.prune = (batch) => runHandbook(['review', 'prune', run.out, batch, '--project', run.root]);
  run.writeVerdicts = (batch, verdicts) => run.writeJson(join(run.out, 'entries', 'review', `${batch}.verdicts.json`), { verdicts });
  run.items = (batch) => JSON.parse(readFileSync(join(run.out, 'entries', 'review', `${batch}.json`), 'utf-8')).items;
  return run;
}

const verdict = (index, value, reason = 'The lines say it.') => ({ index, verdict: value, reason });

describe('review claims', () => {
  it('prints each item with its fields and the chapter lines that hold each citation', () => {
    const run = ready();
    const result = run.claims('b1');
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines.slice(0, 11)).toEqual([
      'Batch b1: 3 items',
      'ITEM 0',
      'dimension: duplication',
      'impact: medium',
      'features: Orders (F1), Archive (F2)',
      'title: Two places end an order',
      'situation: Both features let the clerk close an order',
      'consequence: A clerk has to know which screen to use',
      'cite: src/forms/order-form.js:7',
      '  F1, chapter line 23: 1. The clerk cancels the order (`src/forms/order-form.js:7`).',
      'cite: src/forms/order-form.js:8',
    ]);
    expect(result.lines).toContain('  F2, chapter line 7: 1. A step of the work (`src/forms/order-form.js:8`).');
    expect(result.lines).toContain('ITEM 2');
    expect(result.stdout).not.toContain(run.out);
  });

  it('says so when a citation is on no line of the listed features, and a cite found in several lines lists all', () => {
    const run = ready();
    run.writeBatch('b1', [goodItem({ cites: [`${FORM}:5`, `${FORM}:99`] })]);
    const result = run.claims('b1');
    expect(result.lines.filter((line) => line.startsWith('  F1, chapter line')).length).toBe(2);
    expect(result.lines).toContain('  (no chapter line of the listed features holds this citation)');
  });

  it('refuses a batch that does not exist or has no file', () => {
    const run = ready();
    expect(run.claims('b9').lines[0]).toBe('b9 is not a batch; the batches are b1, b2, cross');
    rmSync(join(run.out, 'entries', 'review', 'cross.json'));
    expect(run.claims('cross').lines[0]).toMatch(/^cross: entries\/review\/cross.json is missing/);
  });
});

describe('review prune: the verdicts', () => {
  it('refuses a verdicts file that does not cover every item exactly once, one line per problem', () => {
    const run = ready();
    run.writeVerdicts('b1', [verdict(0, 'supported'), verdict(0, 'supported'), verdict(5, 'supported')]);
    const result = run.prune('b1');
    expect(result.status).toBe(1);
    expect(result.lines).toEqual([
      'b1: verdicts[2]: index 5 is not an item of the batch (0 to 2)',
      'b1: item 0 has 2 verdicts',
      'b1: item 1 has no verdict',
      'b1: item 2 has no verdict',
      'Next: write the verdicts again, one for every item of the batch',
    ]);
    expect(run.items('b1').length).toBe(3);
  });

  it('refuses a verdict other than supported or unsupported, an empty reason and a malformed entry', () => {
    const run = ready();
    run.writeVerdicts('b1', [verdict(0, 'maybe'), verdict(1, 'supported', '  '), { index: 2 }]);
    const lines = run.prune('b1').lines;
    expect(lines).toContain('b1: verdicts[0]: verdict "maybe" is not supported or unsupported');
    expect(lines).toContain('b1: verdicts[1]: reason must be a non-empty text');
    expect(lines).toContain('b1: verdicts[2]: must be an object with exactly index, verdict and reason');
    expect(existsSync(join(run.out, 'entries', 'review-removed.json'))).toBe(false);
  });

  it('refuses a missing or malformed verdicts file', () => {
    const run = ready();
    expect(run.prune('b1').lines[0]).toMatch(/^b1: entries\/review\/b1.verdicts.json is missing/);
    writeFileSync(join(run.out, 'entries', 'review', 'b1.verdicts.json'), '{"verdicts": 4}');
    expect(run.prune('b1').lines[0]).toBe('b1: verdicts: the file must be an object with exactly the key "verdicts", a list');
  });
});

describe('review prune: the result', () => {
  it('removes the unsupported items, records them, and writes the chapter when every batch is ready; the chapter passes check', () => {
    const run = ready();
    run.writeVerdicts('b1', [verdict(0, 'supported'), verdict(1, 'unsupported', 'The line does not say it takes 4 steps.'), verdict(2, 'supported')]);
    const result = run.prune('b1');
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines[0]).toBe('b1: kept 2, removed 1');
    expect(result.lines[1]).toMatch(/^Chapter: .*review\.md \(2 items\)$/);
    expect(run.items('b1').map((item) => item.title)).toEqual(['Two places end an order', 'Archiving is slow']);
    expect(run.readJson('entries/review-removed.json')).toEqual({ removed: [{ batch: 'b1', title: 'Sending takes many steps', dimension: 'complexity', features: ['F1'], reason: 'The line does not say it takes 4 steps.' }] });
    const text = readFileSync(join(run.out, 'chapters', 'review.md'), 'utf-8');
    expect(text).not.toContain('Sending takes many steps');
    expect(text).toContain('### Archiving is slow');
    const checked = run.check('review');
    expect(checked.status, checked.stdout).toBe(0);
  });

  it('waits for the other batches: no chapter while a batch file is missing or does not pass', () => {
    const run = ready();
    rmSync(join(run.out, 'entries', 'review', 'b2.json'));
    run.writeVerdicts('b1', [verdict(0, 'unsupported'), verdict(1, 'supported'), verdict(2, 'supported')]);
    const result = run.prune('b1');
    expect(result.status).toBe(0);
    expect(result.lines).toEqual(['b1: kept 2, removed 1', 'chapters/review.md waits for the batches without a file: b2']);
    expect(existsSync(join(run.out, 'chapters', 'review.md'))).toBe(false);
    run.writeBatch('b2', [goodItem({ dimension: 'slow' })]);
    const bad = run.prune('b1');
    expect(bad.lines[1]).toBe('chapters/review.md waits for the batches that do not pass yet:');
    expect(bad.lines.some((line) => line.startsWith('b2 item 0:'))).toBe(true);
    expect(existsSync(join(run.out, 'chapters', 'review.md'))).toBe(false);
  });

  it('pruning twice with the same verdicts changes nothing: same batch file, same record, same chapter', () => {
    const run = ready();
    run.writeVerdicts('b1', [verdict(0, 'supported'), verdict(1, 'unsupported', 'No.'), verdict(2, 'unsupported', 'Not either.')]);
    expect(run.prune('b1').status).toBe(0);
    const files = () => ['entries/review/b1.json', 'entries/review-removed.json', 'chapters/review.md', 'entries/review/b1.unpruned.json'].map((name) => readFileSync(join(run.out, name), 'utf-8'));
    const once = files();
    expect(run.items('b1').length).toBe(1);
    const again = run.prune('b1');
    expect(again.status, again.stdout).toBe(0);
    expect(again.lines[0]).toBe('b1: kept 1, removed 2');
    expect(files()).toEqual(once);
    expect(JSON.parse(once[3]).items.length).toBe(3);
  });

  it('refuses when the batch file was changed after pruning', () => {
    const run = ready();
    run.writeVerdicts('b1', [verdict(0, 'supported'), verdict(1, 'unsupported', 'No.'), verdict(2, 'supported')]);
    run.prune('b1');
    run.writeBatch('b1', [goodItem()]);
    const result = run.prune('b1');
    expect(result.status).toBe(1);
    expect(result.lines[0]).toBe('b1: entries/review/b1.json changed after it was pruned; delete entries/review/b1.unpruned.json and entries/review/b1.verdicts.json and verify the batch again');
  });

  it('records the removals of each batch in one file, replacing only that batch', () => {
    const run = ready();
    run.writeBatch('b2', [goodItem({ dimension: 'dead-end', impact: 'low', features: ['F3'], title: 'A reminder cannot be stopped', situation: 'Sending a reminder is one step', consequence: 'Nobody can cancel it', cites: [`${FORM}:11`] })]);
    run.writeVerdicts('b1', [verdict(0, 'unsupported', 'One.'), verdict(1, 'supported'), verdict(2, 'supported')]);
    run.writeVerdicts('b2', [verdict(0, 'unsupported', 'Two.')]);
    run.prune('b1');
    run.prune('b2');
    run.prune('b1');
    expect(run.readJson('entries/review-removed.json').removed.map((entry) => [entry.batch, entry.reason])).toEqual([['b2', 'Two.'], ['b1', 'One.']]);
  });

  it('a prune that removes nothing leaves the items and records no removal', () => {
    const run = ready();
    run.writeVerdicts('b1', [verdict(0, 'supported'), verdict(1, 'supported'), verdict(2, 'supported')]);
    const result = run.prune('b1');
    expect(result.lines[0]).toBe('b1: kept 3, removed 0');
    expect(run.readJson('entries/review-removed.json')).toEqual({ removed: [] });
    expect(run.items('b1').length).toBe(3);
  });
});
