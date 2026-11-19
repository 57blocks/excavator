// openspec change handbook-process-review, tasks 6.1 and 6.3 (design D8, D9): the process batches of the design-problems
// phase (packing, resume by digest, status, item rules, the chapter line), `review processes`, the process column and table
// of `remedies-inputs`, the digest of processes.md in the remedies state, and the reply line.
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { runHandbook } from './helpers.mjs';
import { CROSS, FORM, cite, newMdRun, remediesText, textOf } from './md-run-fixture.mjs';
import { DEFECTS_THREE } from './numbers-fixture.mjs';
import { goodItem, reviewRun } from './review-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const TWO = `# Business processes

## Place an order

1. The clerk: **Create an order** (Orders (F1)) (${cite('5')}).
2. The system: **Archive an order** (Archive (F2)) (${cite('8')}).

End state: the order is archived (${cite('8')}).

## Remind a customer

1. The system: **Send a reminder** (Reminders (F3)) (${cite('11')}).
`;

const processesFile = (run) => join(run.out, 'entries', 'review-processes.json');
const readProcesses = (run) => JSON.parse(readFileSync(processesFile(run), 'utf-8'));
const has = (run, name) => existsSync(join(run.out, name));

/** A run whose processes chapter `text` passed `check processes`, with the facts and process batches written. */
function passedRun(text = TWO) {
  const run = reviewRun(cleanups);
  run.write('processes', text);
  expect(run.check('processes').status).toBe(0);
  run.facts();
  return run;
}

/** A run whose processes.md has `counts[i]` steps in process i and a state record that says passed; no check runs. */
function packedRun(counts) {
  const run = reviewRun(cleanups);
  const text = counts.map((count, at) => `## Process ${at + 1}\n\n${Array.from({ length: count }, (_, n) => `${n + 1}. The clerk: **Create an order** (Orders (F1)) (${cite('5')}).`).join('\n')}\n`).join('\n');
  run.write('processes', `# Business processes\n\n${text}`);
  const path = join(run.out, 'state.json');
  const state = existsSync(path) ? JSON.parse(readFileSync(path, 'utf-8')) : { format: 'excavator-product-handbook-state/2', chapters: {} };
  state.chapters.processes = { status: 'passed', attempts: 1, reasons: [] };
  writeFileSync(path, JSON.stringify(state));
  return run;
}

describe('process batches', () => {
  it('packs consecutive processes up to 60 steps, and a longer process alone', () => {
    const run = packedRun([30, 25, 10, 70, 5]);
    const result = run.facts();
    expect(result.lines).toContain('Process batches: 4 (5 processes)');
    expect(readProcesses(run).batches.map((batch) => [batch.id, batch.processes.map((process) => process.id)])).toEqual([['p1', ['P1', 'P2']], ['p2', ['P3']], ['p3', ['P4']], ['p4', ['P5']]]);
    expect(readProcesses(run).batches[0].processes[0]).toEqual({ id: 'P1', name: 'Process 1', features: ['F1'], steps: 30 });
  });

  it('writes no file and no batch when the processes chapter has not passed, and removes an old file', () => {
    const run = reviewRun(cleanups);
    const result = run.facts();
    expect(result.lines).toContain('Process batches: none (the business processes chapter has not passed)');
    expect(has(run, 'entries/review-processes.json')).toBe(false);
    run.write('processes', TWO);
    expect(run.check('processes').status).toBe(0);
    run.facts();
    expect(has(run, 'entries/review-processes.json')).toBe(true);
    run.write('processes', `${TWO}\nedited\n`);
    run.check('processes', '--no-record');
    const state = JSON.parse(readFileSync(join(run.out, 'state.json'), 'utf-8'));
    state.chapters.processes.status = 'failed';
    writeFileSync(join(run.out, 'state.json'), JSON.stringify(state));
    run.facts();
    expect(has(run, 'entries/review-processes.json')).toBe(false);
    expect(run.status().lines.map((line) => line.split('\t')[0])).toEqual(['b1', 'b2']);
  });

  it('lists the batches after the domain batches, with their names, and keeps titles to the domain batches', () => {
    const run = passedRun();
    expect(run.status().lines).toEqual(['b1\twrite\tOrder handling', 'b2\twrite\tAutomatic work', 'p1\twait\tP1-P2']);
    run.writeBatch('b1', [goodItem()]);
    expect(runHandbook(['review', 'titles', run.out, '--project', run.root]).lines.every((line) => line.startsWith('b1\t'))).toBe(true);
  });

  it('clears every p batch, its verdicts, unpruned copy and removal records when the digest changes, and touches nothing when it is the same', () => {
    const run = passedRun();
    const dir = join(run.out, 'entries', 'review');
    for (const name of ['p1.json', 'p1.unpruned.json', 'p1.verdicts.json', 'b1.json']) writeFileSync(join(dir, name), JSON.stringify({ items: [] }));
    run.writeJson(join(run.out, 'entries', 'review-removed.json'), { removed: [{ batch: 'p1', title: 'x' }, { batch: 'b1', title: 'y' }] });
    run.facts();
    for (const name of ['p1.json', 'p1.unpruned.json', 'p1.verdicts.json', 'b1.json']) expect(has(run, `entries/review/${name}`)).toBe(true);
    expect(JSON.parse(readFileSync(join(run.out, 'entries', 'review-removed.json'), 'utf-8')).removed).toHaveLength(2);
    run.write('processes', TWO.replace('Remind a customer', 'Remind someone'));
    expect(run.check('processes').status).toBe(0);
    run.facts();
    for (const name of ['p1.json', 'p1.unpruned.json', 'p1.verdicts.json']) expect(has(run, `entries/review/${name}`)).toBe(false);
    expect(has(run, 'entries/review/b1.json')).toBe(true);
    expect(JSON.parse(readFileSync(join(run.out, 'entries', 'review-removed.json'), 'utf-8')).removed.map((entry) => entry.batch)).toEqual(['b1']);
  });

  it('is wait until the domain batches are done, then write', () => {
    const run = passedRun();
    for (const batch of ['b1', 'b2']) {
      run.writeBatch(batch, []);
      expect(run.prune(batch).status).toBe(0);
    }
    expect(run.status().lines).toEqual(['b1\tdone\tOrder handling', 'b2\tdone\tAutomatic work', 'p1\twrite\tP1-P2']);
  });
});

const processItem = (over = {}) => goodItem({ dimension: 'redundancy', features: ['F1'], process: 'P1', title: 'The order is ended twice', situation: 'The order is closed in two steps', consequence: 'The clerk repeats the work', cites: [`${FORM}:7`], ...over });

describe('process items', () => {
  const reasonsOf = (run, item) => {
    run.writeBatch('p1', [item]);
    const result = run.render('p1');
    return result.status === 0 ? [] : result.lines.filter((line) => line.startsWith('p1 item 0'));
  };

  it('accepts a process item', () => {
    const run = passedRun();
    expect(reasonsOf(run, processItem())).toEqual([]);
  });

  it('refuses each broken rule', () => {
    const run = passedRun();
    const { process, ...noProcess } = processItem();
    expect(process).toBe('P1');
    expect(reasonsOf(run, noProcess)[0]).toMatch(/must name its process, one of P1, P2/);
    expect(reasonsOf(run, processItem({ process: 'P3' }))[0]).toMatch(/process "P3" is not a process of batch p1/);
    expect(reasonsOf(run, processItem({ dimension: 'access', features: ['F1', 'F2'], cites: [`${FORM}:7`, `${FORM}:8`] }))[0]).toMatch(/a process batch item has dimension duplication, complexity, redundancy, manual, dead-end/);
    expect(reasonsOf(run, processItem({ features: ['F3'], cites: [`${FORM}:11`] }))[0]).toMatch(/features F3 are not steps of process P1 \(Place an order\)/);
    expect(reasonsOf(run, processItem({ candidates: ['X1'] }))[0]).toMatch(/has no candidates/);
    run.writeBatch('b1', [processItem({ features: ['F1'] })]);
    expect(run.render('b1').lines.join('\n')).toMatch(/b1 item 0: process is only for a process batch/);
  });

  it('shows the process on the impact line and numbers the item the same in designNumbers, the page and remedies-inputs', () => {
    const run = passedRun();
    run.write('defects', DEFECTS_THREE);
    run.check('defects');
    run.writeBatch('b1', [goodItem()]);
    run.writeBatch('b2', []);
    run.writeBatch('p1', [processItem()]);
    const rendered = run.render();
    expect(rendered.status, rendered.stdout).toBe(0);
    const chapter = readFileSync(join(run.out, 'chapters', 'review.md'), 'utf-8');
    expect(chapter).toContain('; Process: P1 Place an order (');
    expect(run.check('review').status).toBe(0);
    const inputs = runHandbook(['remedies-inputs', run.out]).lines;
    expect(inputs).toContain('DESIGN R1 medium duplication F1,F2 Two places end an order');
    expect(inputs).toContain('DESIGN R2 medium redundancy F1 P1 The order is ended twice');
    expect(inputs.slice(inputs.indexOf('PROCESS P1 2 F1,F2 Place an order'))).toEqual([
      'PROCESS P1 2 F1,F2 Place an order',
      '  design: R2',
      '  defects: D1, D2, D3',
      `  cites: ${FORM}:5; ${FORM}:8`,
    ]);
  });

  it('says in the PROCESS table when no design problem names a process or the chapter is not available', () => {
    const run = passedRun();
    run.write('defects', DEFECTS_THREE);
    run.check('defects');
    run.writeBatch('b1', [goodItem()]);
    run.writeBatch('b2', []);
    run.writeBatch('p1', []);
    expect(run.render().status).toBe(0);
    run.check('review');
    expect(runHandbook(['remedies-inputs', run.out]).lines.slice(-1)).toEqual(['PROCESS none: no design problem names a process']);
  });
});

describe('review processes', () => {
  it('prints only the processes of its batch with the line numbers of processes.md', () => {
    const run = packedRun([40, 40]);
    run.facts();
    const first = runHandbook(['review', 'processes', run.out, 'p1']);
    expect(first.status).toBe(0);
    const all = readFileSync(join(run.out, 'chapters', 'processes.md'), 'utf-8').split('\n');
    expect(first.lines[0]).toBe('PROCESS\tP1\tProcess 1\tF1');
    expect(first.lines).toHaveLength(41);
    expect(first.lines.some((line) => line.includes('Process 2'))).toBe(false);
    for (const line of first.lines.slice(1)) {
      const [, n, text] = /^processes\.md:(\d+): (.*)$/.exec(line);
      expect(all[Number(n) - 1]).toBe(text);
    }
    const second = runHandbook(['review', 'processes', run.out, 'p2']);
    expect(second.lines[0]).toBe('PROCESS\tP2\tProcess 2\tF1');
    expect(second.lines[1]).toBe(`processes.md:${all.indexOf('## Process 2') + 3}: 1. The clerk: **Create an order** (Orders (F1)) (${cite('5')}).`);
  });

  it('prints the end state line, refuses a non-process batch, and refuses a changed chapter', () => {
    const run = passedRun();
    const lines = runHandbook(['review', 'processes', run.out, 'p1']).lines;
    expect(lines[0]).toBe('PROCESS\tP1\tPlace an order\tF1,F2');
    expect(lines.some((line) => line.includes('End state: the order is archived'))).toBe(true);
    const wrong = runHandbook(['review', 'processes', run.out, 'b1']);
    expect(wrong.status).toBe(1);
    expect(wrong.lines[0]).toBe('b1 is not a process batch; the process batches are p1');
    run.write('processes', `${TWO}\nmore\n`);
    const stale = runHandbook(['review', 'processes', run.out, 'p1']);
    expect(stale.status).toBe(1);
    expect(stale.lines).toEqual(['processes.md changed since review facts; run review facts again']);
  });
});

describe('remedies state and reply', () => {
  it('a passed remedies chapter is stale when processes.md changes', () => {
    const run = newMdRun({ defects: DEFECTS_THREE, remedies: remediesText() });
    cleanups.push(run.cleanup);
    expect(runHandbook(['remedies-state', run.out]).lines[3]).toBe('STALE=no');
    run.write('processes', TWO);
    expect(runHandbook(['remedies-state', run.out]).lines[3]).toBe('STALE=yes');
  });

  it('the reply says there are no process items when the review chapter exists and the processes file does not', () => {
    const all = ['system', 'F1', 'F2', 'F3', 'F4', 'F5', ...CROSS, 'review'];
    const run = newMdRun(Object.fromEntries(all.map((name) => [name, textOf(name)])));
    cleanups.push(run.cleanup);
    run.assemble();
    const noFile = run.reply().lines;
    expect(noFile).toContain('Design problems: no process items, because the business processes chapter is not written or did not pass');
    mkdirSync(join(run.out, 'entries'), { recursive: true });
    writeFileSync(join(run.out, 'entries', 'review-processes.json'), JSON.stringify({ batches: [] }));
    expect(run.reply().lines.some((line) => line.includes('no process items'))).toBe(false);
  });
});
