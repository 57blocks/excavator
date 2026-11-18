// openspec change handbook-process-review, task 2.2: the buckets of the comparison candidates, `review compare-status`,
// the coverage section of the design-problems chapter and the optional candidates / dismissed fields of a batch file.
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { runHandbook } from './helpers.mjs';
import { FORM } from './md-run-fixture.mjs';
import { goodItem, reviewRun } from './review-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const candidate = (id, source, features, batch) => ({ id, source, features, batch, facts: {} });
const second = () => goodItem({ dimension: 'complexity', impact: 'high', features: ['F1'], title: 'Sending takes many steps', situation: 'Creating an order takes 4 steps', consequence: 'A clerk needs several screens', cites: [`${FORM}:6`], candidates: ['X4'] });

/** Sources: dual X1 (item), X5 (unjudged); dict X2 (dismissed); table X3 (unjudged, no feature); topic not computed; code X4 (only a removed item names it). */
function ready({ withFile = true, sources } = {}) {
  const run = reviewRun(cleanups);
  run.facts();
  if (withFile) {
    run.writeJson(join(run.out, 'entries', 'review-compare.json'), {
      format: 'x',
      sources: sources ?? [
        { source: 'dual', computed: true, count: 2 },
        { source: 'dict', computed: true, count: 1 },
        { source: 'table', computed: true, count: 1 },
        { source: 'topic', computed: false, reason: 'chapters/topics.md is missing' },
        { source: 'code', computed: true, count: 1 },
      ],
      candidates: [
        candidate('X1', 'dual', ['F1', 'F2'], 'b1'),
        candidate('X2', 'dict', ['F3'], 'b2'),
        candidate('X3', 'table', [], null),
        candidate('X4', 'code', ['F1', 'F3'], 'b1'),
        candidate('X5', 'dual', ['F3', 'F4'], 'b3'),
      ],
    });
  }
  run.writeBatch('b1', [goodItem({ candidates: ['X1'] }), second()]);
  run.writeJson(join(run.out, 'entries', 'review', 'b2.json'), { items: [], dismissed: [{ candidate: 'X2', reason: 'same' }] });
  run.writeBatch('cross', []);
  run.prune = (batch) => runHandbook(['review', 'prune', run.out, batch, '--project', run.root]);
  run.status = () => runHandbook(['review', 'compare-status', run.out, '--project', run.root]);
  run.chapter = () => readFileSync(join(run.out, 'chapters', 'review.md'), 'utf-8');
  return run;
}

function pruned(run) {
  run.writeJson(join(run.out, 'entries', 'review', 'b1.verdicts.json'), { verdicts: [
    { index: 0, verdict: 'supported', reason: 'The lines say it.' },
    { index: 1, verdict: 'unsupported', reason: 'The lines do not say it.' },
  ] });
  for (const batch of ['b1', 'b2', 'cross']) expect(run.prune(batch).status).toBe(0);
}

describe('compare buckets', () => {
  it('counts a candidate of a kept item, a dismissed one and an unjudged one, and the counts add up', () => {
    const run = ready();
    pruned(run);
    const result = run.status();
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines).toEqual([
      'COMPARE dual candidates 2 item 1 dismissed 0 unjudged 1',
      'COMPARE dict candidates 1 item 0 dismissed 1 unjudged 0',
      'COMPARE table candidates 1 item 0 dismissed 0 unjudged 1',
      'COMPARE topic not computed: chapters/topics.md is missing',
      'COMPARE code candidates 1 item 0 dismissed 0 unjudged 1',
      'UNJUDGED X5 dual F3,F4 b3',
      'UNJUDGED X3 table - -',
      'UNJUDGED X4 code F1,F3 b1',
    ]);
    for (const line of result.lines.filter((entry) => / candidates \d+ item /.test(entry))) {
      const n = line.match(/candidates (\d+) item (\d+) dismissed (\d+) unjudged (\d+)/).slice(1).map(Number);
      expect(n[1] + n[2] + n[3]).toBe(n[0]);
    }
  });

  it('counts a candidate of a batch not pruned yet as unjudged', () => {
    const run = ready();
    expect(run.render().status).toBe(0);
    expect(run.status().lines[0]).toBe('COMPARE dual candidates 2 item 0 dismissed 0 unjudged 2');
  });

  it('writes the coverage section after the items, with the removed item\'s candidate listed with its source and features', () => {
    const run = ready();
    pruned(run);
    const text = run.chapter();
    const section = text.slice(text.indexOf('## Coverage of the comparison candidates'));
    expect(section.split('\n')).toEqual([
      '## Coverage of the comparison candidates', '',
      '- Two implementations of one feature: 2 candidates; 1 became design problems, 0 judged not a problem, 1 not judged',
      '- Dictionary values that differ: 1 candidates; 0 became design problems, 1 judged not a problem, 0 not judged',
      '- Tables shared by applications: 1 candidates; 0 became design problems, 0 judged not a problem, 1 not judged',
      '- Cross-cutting topic rows: not computed',
      '- Code shared across batches: 1 candidates; 0 became design problems, 0 judged not a problem, 1 not judged',
      '', 'Not judged:', '',
      '- X5 Two implementations of one feature Reminders (F3), Admin tool (F4)',
      '- X3 Tables shared by applications',
      '- X4 Code shared across batches Orders (F1), Reminders (F3)',
      '',
    ]);
    expect(text).not.toContain('chapters/topics.md');
    expect(text.indexOf('### R1')).toBeLessThan(text.indexOf('## Coverage'));
  });

  it('passes the chapter check, and the R numbers are the same with and without the section', () => {
    const run = ready();
    pruned(run);
    const check = runHandbook(['check', run.out, 'review', '--no-record', '--project', run.root]);
    expect(check.status, check.stdout).toBe(0);
    const numbers = () => runHandbook(['review', 'titles', run.out, '--project', run.root]).lines;
    const withSection = run.chapter().split('\n').filter((line) => /^### R\d+ /.test(line));
    expect(withSection.length).toBe(1);
    rmSync(join(run.out, 'entries', 'review-compare.json'));
    expect(run.render().status).toBe(0);
    const without = run.chapter();
    expect(without).toContain('The comparison candidates were not computed.');
    expect(without.split('\n').filter((line) => /^### R\d+ /.test(line))).toEqual(withSection);
    expect(numbers().length).toBeGreaterThan(0);
  });

  it('says two sources were not computed when their artifacts are missing and counts the others', () => {
    const run = ready({ sources: [
      { source: 'dual', computed: true, count: 2 },
      { source: 'dict', computed: false, reason: 'dictionaries.json is missing' },
      { source: 'table', computed: false, reason: 'data.json is missing' },
      { source: 'topic', computed: true, count: 0 },
      { source: 'code', computed: true, count: 1 },
    ] });
    pruned(run);
    const text = run.chapter();
    expect(text).toContain('- Dictionary values that differ: not computed');
    expect(text).toContain('- Tables shared by applications: not computed');
    expect(text).toContain('- Cross-cutting topic rows: 0 candidates; 0 became design problems, 0 judged not a problem, 0 not judged');
    expect(run.status().lines).toContain('COMPARE dict not computed: dictionaries.json is missing');
  });

  it('says so in the chapter and the command when review-compare.json is missing', () => {
    const run = ready({ withFile: false });
    expect(run.render().status).toBe(0);
    expect(run.chapter()).toContain('## Coverage of the comparison candidates\n\nThe comparison candidates were not computed.\n');
    const result = run.status();
    expect(result.status).toBe(0);
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatch(/^COMPARE not computed: entries\/review-compare\.json /);
    expect(runHandbook(['check', run.out, 'review', '--no-record', '--project', run.root]).status).toBe(0);
  });
});

describe('candidates and dismissed shape', () => {
  const refused = (label, mutate, reason) => it(`refuses ${label}`, () => {
    const run = ready();
    mutate(run);
    const result = run.render('b1', 'b2');
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(reason);
  });
  const withItem = (over) => (run) => run.writeBatch('b1', [goodItem(over)]);
  const withDismissed = (dismissed) => (run) => run.writeJson(join(run.out, 'entries', 'review', 'b2.json'), { items: [], dismissed });

  refused('candidates that is not a list', withItem({ candidates: 'X1' }), /b1 item 0: candidates must be a list of distinct comparison candidate ids/);
  refused('a candidate id of the wrong form', withItem({ candidates: ['X0'] }), /candidates must be a list/);
  refused('a repeated candidate id', withItem({ candidates: ['X1', 'X1'] }), /candidates must be a list/);
  refused('dismissed that is not a list', withDismissed({}), /b2: dismissed must be a list/);
  refused('a dismissed entry with another key', withDismissed([{ candidate: 'X1', reason: 'same', note: 'x' }]), /b2 dismissed 0: must be an object with exactly candidate and reason/);
  refused('a dismissed candidate of the wrong form', withDismissed([{ candidate: 'F1', reason: 'same' }]), /b2 dismissed 0: candidate "F1" is not a comparison candidate id/);
  refused('a dismissed reason out of the list', withDismissed([{ candidate: 'X1', reason: 'boring' }]), /b2 dismissed 0: reason "boring" is not one of same, different-subject, not-in-chapters/);

  it('accepts a right shape, and prune keeps the dismissed list', () => {
    const run = ready();
    expect(run.render().status).toBe(0);
    pruned(run);
    expect(JSON.parse(readFileSync(join(run.out, 'entries', 'review', 'b2.json'), 'utf-8')).dismissed).toEqual([{ candidate: 'X2', reason: 'same' }]);
  });
});
