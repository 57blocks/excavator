// openspec change handbook-process-review, task 3.1: every candidate of a batch has one conclusion.
import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';

import { runHandbook } from './helpers.mjs';
import { FORM } from './md-run-fixture.mjs';
import { goodItem, reviewRun, writeCompare } from './review-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const candidate = (id, source, features, batch) => ({ id, source, features, batch, facts: {} });

/** b1 holds X1 (dual, F1 and F2); X2 belongs to b2 and X3 to a batch that does not exist as a file. */
function ready({ withFile = true } = {}) {
  const run = reviewRun(cleanups);
  run.facts();
  if (withFile) {
    run.writeJson(join(run.out, 'entries', 'review-compare.json'), {
      format: 'x',
      sources: [{ source: 'dual', computed: true, count: 2 }, { source: 'dict', computed: true, count: 1 }, { source: 'table', computed: false, reason: 'x' }, { source: 'topic', computed: false, reason: 'x' }, { source: 'code', computed: false, reason: 'x' }],
      candidates: [candidate('X1', 'dual', ['F1', 'F2'], 'b1'), candidate('X2', 'dual', ['F3', 'F4'], 'b2'), candidate('X3', 'dict', ['F3'], 'c-data')],
    });
  }
  run.write = (batch, value) => run.writeJson(join(run.out, 'entries', 'review', `${batch}.json`), value);
  run.status = () => runHandbook(['review', 'status', run.out, '--project', run.root]);
  return run;
}

const dismissX2 = { candidate: 'X2', reason: 'same' };

describe('candidate conclusions', () => {
  it('refuses a batch that leaves a candidate without a conclusion and names it, its source and its features', () => {
    const run = ready();
    run.write('b1', { items: [goodItem()] });
    const result = run.render('b1');
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('b1: candidate X1 (dual, F1,F2) has no conclusion: list it in the candidates of an item or in dismissed');
  });

  it('passes a batch whose item handles it, and a batch that dismisses it', () => {
    const run = ready();
    run.write('b1', { items: [goodItem({ candidates: ['X1'] })] });
    expect(run.render('b1').status).toBe(0);
    run.write('b1', { items: [], dismissed: [{ candidate: 'X1', reason: 'different-subject' }] });
    expect(run.render('b1').status).toBe(0);
  });

  it('refuses an id of another batch, an unknown id and a dismissal of either', () => {
    const run = ready();
    run.write('b1', { items: [goodItem({ candidates: ['X1', 'X2'] })] });
    expect(run.render('b1').stdout).toContain('b1: item 0 names X2, which is not a candidate of this batch');
    run.write('b1', { items: [goodItem({ candidates: ['X1', 'X9'] })] });
    expect(run.render('b1').stdout).toContain('names X9, which is not a candidate of this batch');
    run.write('b1', { items: [goodItem({ candidates: ['X1'] })], dismissed: [{ candidate: 'X3', reason: 'same' }] });
    expect(run.render('b1').stdout).toContain('b1: dismissed names X3, which is not a candidate of this batch');
  });

  it('refuses a candidate both listed and dismissed, and one dismissed twice', () => {
    const run = ready();
    run.write('b1', { items: [goodItem({ candidates: ['X1'] })], dismissed: [{ candidate: 'X1', reason: 'same' }] });
    expect(run.render('b1').stdout).toContain('b1: candidate X1 (dual, F1,F2) is both listed by an item and dismissed');
    run.write('b1', { items: [], dismissed: [{ candidate: 'X1', reason: 'same' }, { candidate: 'X1', reason: 'not-in-chapters' }] });
    expect(run.render('b1').stdout).toContain('b1: candidate X1 (dual, F1,F2) is dismissed twice');
  });

  it('refuses an item that lists a candidate none of whose features is among its features', () => {
    const run = ready();
    run.writeJson(join(run.out, 'entries', 'review-compare.json'), { sources: [], candidates: [candidate('X1', 'dual', ['F2'], 'b1')] });
    run.write('b1', { items: [goodItem({ dimension: 'complexity', features: ['F1'], candidates: ['X1'] })] });
    const result = run.render('b1');
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('b1 item 0: lists candidate X1 (dual, F2) but none of its features is among the features of the item');
  });

  it('has no rules when review-compare.json is missing or does not parse', () => {
    const run = ready({ withFile: false });
    run.write('b1', { items: [goodItem({ candidates: ['X7'] })] });
    expect(run.render('b1').status).toBe(0);
    run.writeJson(join(run.out, 'entries', 'review-compare.json'), { candidates: 'no' });
    expect(run.render('b1').status).toBe(0);
  });

  it('shows the batch as write with the reason in review status', () => {
    const run = ready();
    run.write('b1', { items: [goodItem()] });
    const lines = run.status().stdout.split('\n');
    const at = lines.findIndex((line) => line.startsWith('b1\twrite'));
    expect(at).toBeGreaterThanOrEqual(0);
    expect(lines[at + 1]).toContain('b1: candidate X1 (dual, F1,F2) has no conclusion');
  });

  it('still renders the chapter after pruning removed the handling item, and the candidate counts as not judged', () => {
    const run = ready();
    run.write('b1', { items: [goodItem({ candidates: ['X1'] })] });
    run.write('b2', { items: [], dismissed: [dismissX2] });
    run.writeJson(join(run.out, 'entries', 'review', 'b1.verdicts.json'), { verdicts: [{ index: 0, verdict: 'unsupported', reason: 'The lines do not say it.' }] });
    for (const batch of ['b1', 'b2']) expect(runHandbook(['review', 'prune', run.out, batch, '--project', run.root]).status).toBe(0);
    const result = run.render();
    expect(result.status, result.stdout).toBe(0);
    const text = runHandbook(['review', 'compare-status', run.out, '--project', run.root]).stdout;
    expect(text).toContain('UNJUDGED X1 dual F1,F2 b1');
  });
});

describe('comparison batch rules', () => {
  /** c-data-1 holds X3 (F1, F3) and X6 (F5); X1 is a dual candidate of b1 and X5 belongs to c-data-2. */
  function compareRun() {
    const run = reviewRun(cleanups);
    run.facts();
    writeCompare(run, [
      candidate('X1', 'dual', ['F1', 'F2'], 'b1'),
      candidate('X3', 'dict', ['F1', 'F3'], 'c-data-1'),
      candidate('X5', 'dict', ['F4'], 'c-data-2'),
      candidate('X6', 'dict', ['F5'], 'c-data-1'),
    ]);
    run.write = (batch, value) => run.writeJson(join(run.out, 'entries', 'review', `${batch}.json`), value);
    return run;
  }
  const across = (over = {}) => goodItem({ features: ['F1', 'F3'], cites: [`${FORM}:7`, `${FORM}:11`], candidates: ['X3'], ...over });
  const dismissX6 = [{ candidate: 'X6', reason: 'already-kept' }];

  it('an item with features of two domain batches holds, and so does a dismissal with already-kept', () => {
    const run = compareRun();
    run.write('c-data-1', { items: [across()], dismissed: dismissX6 });
    const result = run.render('c-data-1');
    expect(result.status, result.stdout).toBe(0);
  });

  it('refuses an item that lists no candidate, while the same item with one passes', () => {
    const run = compareRun();
    run.write('c-data-1', { items: [across()], dismissed: dismissX6 });
    expect(run.render('c-data-1').status).toBe(0);
    for (const bare of [across({ candidates: undefined }), across({ candidates: [] })]) {
      const item = { ...bare };
      if (item.candidates === undefined) delete item.candidates;
      run.write('c-data-1', { items: [item], dismissed: dismissX6 });
      const result = run.render('c-data-1');
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('c-data-1 item 0: a comparison batch item must list the candidates it handles');
    }
  });

  it('refuses a batch that leaves one of its candidates without a conclusion and names it', () => {
    const run = compareRun();
    run.write('c-data-1', { items: [across()], dismissed: dismissX6 });
    expect(run.render('c-data-1').status).toBe(0);
    run.write('c-data-1', { items: [across()] });
    const result = run.render('c-data-1');
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('c-data-1: candidate X6 (dict, F5) has no conclusion');
  });

  it('refuses a candidate of a domain batch or of another chunk', () => {
    const run = compareRun();
    run.write('c-data-1', { items: [across()], dismissed: dismissX6 });
    expect(run.render('c-data-1').status).toBe(0);
    run.write('c-data-1', { items: [across({ candidates: ['X3', 'X1'] })], dismissed: dismissX6 });
    expect(run.render('c-data-1').stdout).toContain('c-data-1: item 0 names X1, which is not a candidate of this batch');
    run.write('c-data-1', { items: [across()], dismissed: [...dismissX6, { candidate: 'X5', reason: 'same' }] });
    expect(run.render('c-data-1').stdout).toContain('c-data-1: dismissed names X5, which is not a candidate of this batch');
    run.write('c-data-1', { items: [across({ candidates: ['X3', 'X5'] })], dismissed: dismissX6 });
    expect(run.render('c-data-1').stdout).toContain('names X5, which is not a candidate of this batch');
  });

  it('the status of a comparison batch whose file is refused is write with the reason', () => {
    const run = compareRun();
    run.writeBatch('b1', [goodItem({ candidates: ['X1'] })]);
    run.writeBatch('b2', []);
    run.writeJson(join(run.out, 'entries', 'review', 'b1.verdicts.json'), { verdicts: [{ index: 0, verdict: 'supported', reason: 'ok' }] });
    for (const batch of ['b1', 'b2']) expect(runHandbook(['review', 'prune', run.out, batch, '--project', run.root]).status).toBe(0);
    run.write('c-data-1', { items: [across()] });
    const lines = runHandbook(['review', 'status', run.out, '--project', run.root]).stdout.split('\n');
    const at = lines.findIndex((line) => line.startsWith('c-data-1\twrite'));
    expect(at).toBeGreaterThanOrEqual(0);
    expect(lines[at + 1]).toContain('c-data-1: candidate X6');
  });
});
