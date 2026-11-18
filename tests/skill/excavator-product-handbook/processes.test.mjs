// openspec change handbook-process-review, tasks 5.1 to 5.4 (design D7): `processes facts` prints the reading list of the
// writer of the business processes; `check processes` refuses a step whose operation is not a heading of the operations
// section of the feature it names; the processes are numbered P1..Pn and the remedies check accepts those numbers; the
// assembled handbook and the page number the processes and end with the operations that no process names.
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runHandbook } from './helpers.mjs';
import { FORM, chapterText, cite, newMdRun } from './md-run-fixture.mjs';
import { numberedRun } from './numbers-fixture.mjs';
import { STUB, dataOf, html, runPage } from './page-md-fixture.mjs';
import { reviewRun } from './review-fixture.mjs';
import { defaultParts } from '../../../skills/excavator-product-handbook/lib/outline-v2.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});
const stub = mkdtempSync(join(tmpdir(), 'xhb-processes-'));
const template = join(stub, 'template.html');
writeFileSync(template, STUB);
afterAll(() => rmSync(stub, { recursive: true, force: true }));

const WIDE_OPEN = String.fromCharCode(0xff08);
const WIDE_CLOSE = String.fromCharCode(0xff09);

const TWO = `# Business processes

## Place an order

1. The clerk: **Create an order** (Orders (F1)) (${cite('5')}).
2. The system: **Archive an order** (Archive (F2)) (${cite('8')}).

## Remind a customer

1. The system: **Send a reminder** (Reminders (F3)) (${cite('11')}).
`;

const ALL = `# Business processes

## Everything

1. The clerk: **Create an order** (Orders (F1)) (${cite('5')}).
2. The clerk: **Cancel an order** (Orders (F1)) (${cite('7')}).
3. The system: **Archive an order** (Archive (F2)) (${cite('8')}).
4. The system: **Send a reminder** (Reminders (F3)) (${cite('11')}).
5. The operator: **Run the tool** (Admin tool (F4)) (${cite('12')}).
6. The clerk: **List orders** (Orders (F5)) (${cite('5-6')}).
`;

/** A run with the five feature chapters and `text` as the processes chapter; returns the run and the result of checking it. */
function withProcesses(text) {
  const run = reviewRun(cleanups);
  run.write('processes', text);
  return { run, result: run.check('processes') };
}

describe('processes facts', () => {
  const f = (range) => cite(range, FORM);
  const F1 = `# Orders

## Operations

### Create an order

1. The clerk opens the form (${f('5')}).

### Cancel an order

1. The clerk cancels the order (${f('7')}).

## Hand-overs

- Sent orders go to the archive, Archive (F2) (${f('10')}).
- This feature (F1) and a stray F9 are named here (${f('10')}).
- Reminders (F3) and Archive (F2) both read it, then F3 again
  and Admin tool (F4) too (${f('10')}).

## Points to confirm

None.

## Known defects

None.
`;
  const F2 = `# Archive

## Overview

Orders are archived (${f('8')}).

## Points to confirm

None.

## Known defects

None.
`;
  const lineOf = (text, line) => text.split('\n').indexOf(line) + 1;

  it('prints OP, UNREAD, EDGE and HANDOVER lines in map order, then the counts, and writes nothing', () => {
    const run = newMdRun({}, { check: false });
    run.write('F1', F1);
    run.write('F2', F2);
    run.writeJson(join(run.out, 'domains.json'), { domains: [], handovers: [{ from: 'Orders', to: 'Archive', what: 'Sent orders', cites: [] }] });
    const before = readFileSync(join(run.out, 'chapters', 'F1.md'), 'utf-8');
    const result = runHandbook(['processes', 'facts', run.out]);
    expect(result.status, result.stderr).toBe(0);
    const at = (title) => lineOf(F1, title);
    const edge = (text) => at(text);
    expect(result.lines).toEqual([
      `OP\tF1\tF1.md:${at('### Create an order')}\tCreate an order`,
      `OP\tF1\tF1.md:${at('### Cancel an order')}\tCancel an order`,
      `EDGE\tF1\tF2\tF1.md:${edge(`- Sent orders go to the archive, Archive (F2) (${f('10')}).`)}`,
      `EDGE\tF1\tF3\tF1.md:${edge('- Reminders (F3) and Archive (F2) both read it, then F3 again')}`,
      `EDGE\tF1\tF2\tF1.md:${edge('- Reminders (F3) and Archive (F2) both read it, then F3 again')}`,
      `EDGE\tF1\tF4\tF1.md:${edge('- Reminders (F3) and Archive (F2) both read it, then F3 again')}`,
      'UNREAD\tF2\tno operations section',
      'UNREAD\tF3\tno chapter',
      'UNREAD\tF4\tno chapter',
      'UNREAD\tF5\tno chapter',
      'HANDOVER\tOrders -> Archive: Sent orders',
      'Counts: 2 operations in 1 features, 4 features unread, 4 edges, 1 domain hand-overs',
    ]);
    expect(readFileSync(join(run.out, 'chapters', 'F1.md'), 'utf-8')).toBe(before);
    expect(runHandbook(['processes', 'facts', run.out]).stdout).toBe(result.stdout);
  });

  it('exits 1 with a message when map.json is missing', () => {
    const run = newMdRun({}, { check: false });
    rmSync(join(run.out, 'map.json'));
    const result = runHandbook(['processes', 'facts', run.out]);
    expect(result.status).toBe(1);
    expect(result.lines[0]).toContain('map.json');
  });
});

describe('check processes', () => {
  it('passes a chapter whose steps name operations of the features they name', () => {
    const { result } = withProcesses(TWO);
    expect(result.status, result.stdout).toBe(0);
  });

  it('reads a step with full-width parentheses and a step that continues on the next line', () => {
    const text = TWO.replace('(Orders (F1)) (', `(Orders ${WIDE_OPEN}F1${WIDE_CLOSE}) (`).replace('The system: **Archive an order**', 'The system:\n   **Archive an order**');
    expect(withProcesses(text).result.status).toBe(0);
  });

  it('refuses an invented operation and names the operations of the feature', () => {
    expect(withProcesses(TWO).result.status).toBe(0);
    const { result } = withProcesses(TWO.replace('**Create an order**', '**Create an**'));
    expect(result.status, result.stdout).toBe(1);
    expect(result.stdout).toContain('line 5: "Create an" is not an operation of F1; its operations are: "Create an order", "Cancel an order"');
  });

  it('refuses a step without the feature id', () => {
    expect(withProcesses(TWO).result.status).toBe(0);
    const { result } = withProcesses(TWO.replace('(Orders (F1)) (', '(Orders) ('));
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('line 5: a step needs the feature id of its operation, as (F<n>)');
  });

  it('refuses a step without a bold operation', () => {
    expect(withProcesses(TWO).result.status).toBe(0);
    const { result } = withProcesses(TWO.replace('**Create an order**', 'Create an order'));
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('line 5: a step needs its operation in bold');
  });

  it('refuses a feature that is not on the map, and a feature whose chapter has no operations section', () => {
    expect(withProcesses(TWO).result.status).toBe(0);
    expect(withProcesses(TWO.replace('(Orders (F1))', '(Orders (F9))')).result.stdout).toContain('line 5: F9 is not a feature of the map');
    const run = reviewRun(cleanups);
    run.write('F2', `# Archive\n\n## Overview\n\nOrders are archived (${cite('8')}).\n\n## Points to confirm\n\nNone.\n\n## Known defects\n\nNone.\n`);
    run.write('processes', TWO);
    expect(run.check('processes').stdout).toContain('line 6: F2 has no operations section, so "Archive an order" cannot be one of its operations');
  });

  it('refuses a process without a numbered step', () => {
    expect(withProcesses(TWO).result.status).toBe(0);
    const { result } = withProcesses(`${TWO}\n## Empty one\n\nNothing happens here (${cite('5')}).\n`);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('line 12: process "Empty one" has no numbered step');
  });

  it('does not read a heading inside a code fence as a process', () => {
    const { result } = withProcesses(`${TWO}\n\`\`\`text\n## Not a process\n\`\`\`\n`);
    expect(result.stdout).not.toContain('Not a process');
  });
});

describe('--before processes', () => {
  it('lists the features without a checked chapter, then reports ready', () => {
    const partial = newMdRun({ F1: chapterText('Orders') });
    const missing = partial.check('--before', 'processes');
    expect(missing.status).toBe(1);
    expect(missing.lines).toEqual(['missing: F2', 'missing: F3', 'missing: F4', 'missing: F5', 'Next: write and check these features before the business processes']);
    cleanups.push(partial.cleanup);
    const run = reviewRun(cleanups);
    const ready = run.check('--before', 'processes');
    expect(ready.status).toBe(0);
    expect(ready.lines).toEqual(['Business processes: ready (5 features)']);
    expect(run.check('--before', 'processes', '--no-record').status).toBe(2);
  });
});

describe('P numbers and the remedies check', () => {
  const remedies = (id, range) => `# Remedies

## Measures across processes

- **Merge entrances** Close orders from one place [${id}] (${cite(range)}).

## Defect fixes

None.

## To simplify and unify

None.

## To fix

None.
`;

  it('numbers the processes in the order of their headings; the remedies check accepts an existing P id with its citations', () => {
    const run = numberedRun(cleanups, { review: false });
    run.write('processes', TWO);
    expect(run.check('processes').status).toBe(0);
    for (const [id, range] of [['P1', '5'], ['P1', '8'], ['P2', '11']]) {
      run.write('remedies', remedies(id, range));
      const result = run.check('remedies');
      expect(result.status, `${id} ${range}\n${result.stdout}`).toBe(0);
    }
    run.write('remedies', remedies('P2', '5'));
    expect(run.check('remedies').stdout).toMatch(/the citation `src\/forms\/order-form.js:5` is not one of the citations of P2/);
  });

  it('refuses a P id beyond the processes, and one while the chapter is unchecked or missing', () => {
    const run = numberedRun(cleanups, { review: false });
    run.write('remedies', remedies('P1', '5'));
    expect(run.check('remedies').stdout).toContain('P1: the business processes are not available (processes.md is missing)');
    run.write('processes', TWO);
    expect(run.check('remedies').stdout).toContain('P1: the business processes are not available (processes.md did not pass the check, or changed after it)');
    run.check('processes');
    run.write('remedies', remedies('P9', '5'));
    expect(run.check('remedies').stdout).toContain('P9 is not a process: there are 2');
  });
});

describe('the rendered processes chapter', () => {
  it('numbers each process heading in place and ends with the operations no process names', () => {
    const run = reviewRun(cleanups);
    run.write('processes', TWO);
    expect(run.check('processes').status).toBe(0);
    const before = run.read('chapters/processes.md');
    expect(run.assemble('--views', 'product,technical').status).toBe(0);
    for (const file of ['handbook.md', 'handbook-technical.md']) {
      const book = run.read(file);
      expect(book, file).toMatch(/^#{2,3} P1 Place an order$/m);
      expect(book, file).toMatch(/^#{2,3} P2 Remind a customer$/m);
      expect(book, file).toMatch(/^#{2,3} Operations in no process\n\n- Orders \(F1\): Cancel an order\n- Admin tool \(F4\): Run the tool\n- Orders \(F5\): List orders\n/m);
    }
    expect(run.read('chapters/processes.md')).toBe(before);
  });

  it('numbers by one line each: the lines before the generated section keep their places', () => {
    const run = reviewRun(cleanups);
    run.write('processes', TWO);
    run.check('processes');
    run.assemble();
    const book = run.read('handbook.md').split('\n');
    const at = book.findIndex((line) => /^#{2,3} P1 Place an order$/.test(line));
    expect(book[at + 2]).toContain('**Create an order**');
    expect(TWO.split('\n')[2]).toBe('## Place an order');
  });

  it('says every operation appears when no operation is left out', () => {
    const run = reviewRun(cleanups);
    run.write('processes', ALL);
    expect(run.check('processes').status).toBe(0);
    run.assemble();
    expect(run.read('handbook.md')).toMatch(/^#{2,3} Operations in no process\n\nEvery operation appears in a process\.\n/m);
  });

  it('gives the page the same numbered text, and a run without the chapter shows neither', () => {
    const run = reviewRun(cleanups);
    run.write('processes', TWO);
    run.check('processes');
    expect(runPage(run, { template }).status).toBe(0);
    const chapter = dataOf(html(run)).chapters.find((entry) => entry.id === 'processes');
    expect(chapter.texts.product).toContain('## P1 Place an order');
    expect(chapter.texts.product).toContain('## Operations in no process');
    const plain = reviewRun(cleanups);
    expect(runPage(plain, { template }).status).toBe(0);
    expect(dataOf(html(plain)).chapters.some((entry) => entry.id === 'processes')).toBe(false);
  });
});

describe('where the chapter sits and how it is counted', () => {
  it('the default outline puts it after the domains and before the roles', () => {
    const parts = defaultParts({ blocks: ['domains', 'processes', 'roles', 'F1'], featureIds: ['F1'], t: (key) => key });
    expect(parts[0]).toEqual({ title: 'md.part.people', chapters: ['domains', 'processes', 'roles'] });
  });

  it('reply counts it when written and not when absent', () => {
    const chapters = (run) => /^Chapters: (\d+) /m.exec(run.reply().stdout)?.[1];
    const plain = reviewRun(cleanups);
    plain.assemble();
    const withIt = reviewRun(cleanups);
    withIt.write('processes', TWO);
    withIt.check('processes');
    withIt.assemble();
    expect(Number(chapters(withIt))).toBe(Number(chapters(plain)) + 1);
  });
});
