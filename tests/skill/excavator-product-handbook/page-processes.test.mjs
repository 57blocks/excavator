// Oracle of openspec change handbook-process-review (task 7.1, design D10): the `processes` key of the page data (the
// processes of the checked chapter, numbered by item-numbers, with their steps, end state, features and the operations in
// no process), the `process` of a design row, and the `remedies` of each row (every item of the remedies chapter whose id
// group names it). The runs are written chapter by chapter with records that match the bytes. Full-width marks are built
// from code points so that this file holds only ASCII.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { loadMdRun } from '../../../skills/excavator-product-handbook/lib/md-run.mjs';
import { buildPageData } from '../../../skills/excavator-product-handbook/lib/page-data.mjs';
import { reviewChapterText } from '../../../skills/excavator-product-handbook/lib/review-render.mjs';
import { loadUi } from '../../../skills/excavator-product-handbook/lib/ui.mjs';
import { FORM } from './md-run-fixture.mjs';
import { makeRun } from './helpers.mjs';

const WIDE_OPEN = String.fromCharCode(0xff08);
const WIDE_CLOSE = String.fromCharCode(0xff09);
const WIDE_COLON = String.fromCharCode(0xff1a);
const WIDE_COMMA = String.fromCharCode(0xff0c);
const sha = (text) => createHash('sha256').update(text).digest('hex');

const DEFECTS = `# Defects

## P0

- **security** **Open secret** A secret is stored in the code, Orders (F1) (\`${FORM}:5\`).

## P1

- **display** **Hidden button** The list hides a button, Archive (F2) (\`${FORM}:6\`).
`;

const features = (id, operations) => `# ${id}\n\n## Operations\n\n${operations.map((title) => `### ${title}\n\nSteps.\n`).join('\n')}\n## Points to confirm\n\n- None.\n`;
const F1 = features('Orders', ['Place an order', 'Close an order']);
const F2 = features('Archive', ['Archive an order', 'Restore an order']);
const F3 = features('Reminders', ['Send a reminder']);

const PROCESSES = `# Business processes

## Order to archive

1. Clerk: **Place an order** (Orders (F1)) The clerk saves the order (\`${FORM}:5\`; \`${FORM}:6\`).
2. System ${WIDE_COLON} **Archive an order** (Archive ${WIDE_OPEN}F2${WIDE_CLOSE}) The system moves it to the archive${WIDE_COMMA}later (\`${FORM}:7\`).
3. Approver: **Close an order** (Orders (F1))${WIDE_COLON}The approver closes it (\`${FORM}:8\`).

End state: Archived (\`${FORM}:7\`).

## Reminder run

1. System: **Send a reminder** (Reminders (F3)): The job mails the clerk (\`${FORM}:6\`).
`;

const REMEDIES = `# Remedies

## Measures across processes

- **Merge entrances** Close orders in one place [P1, R1, D1] (\`${FORM}:7\`).

## Defect fixes

- **display** Show the button [D2, D99] (\`${FORM}:6\`).

## To fix

1. **Fix** Move the secret [D1] (\`${FORM}:5\`).
`;

const OLD_REMEDIES = '# Remedies\n\n## Fix security problems\n\nText.\n\n## Duplication\n\nText.\n';

const batch = (over) => ({
  dimension: 'duplication', impact: 'high', features: ['F1', 'F2'], title: 'Two places end an order',
  situation: 'Both features close an order', consequence: 'A clerk must know which one to use', cites: [`${FORM}:7`, `${FORM}:8`], ...over,
});
const B1 = [batch({}), batch({ dimension: 'access', impact: 'low', title: 'A low access item' })];
const P1 = [batch({ dimension: 'manual', impact: 'medium', title: 'A manual hand-over', process: 'P1' })];

const dirs = [];
afterEach(() => {
  while (dirs.length > 0) dirs.pop()();
});

/** A run with the chapters written as given (each recorded as passed unless named in `failed`) and one domain batch plus one process batch of design problems. */
function setup({ chapters, failed = [] }) {
  const run = makeRun();
  dirs.push(run.cleanup);
  run.writeMap();
  mkdirSync(join(run.out, 'chapters'), { recursive: true });
  mkdirSync(join(run.out, 'entries', 'review'), { recursive: true });
  const ui = loadUi(run.out).strings;
  const all = { ...chapters };
  if (chapters.processes !== undefined) {
    run.writeJson(join(run.out, 'entries', 'review-processes.json'), {
      format: 'excavator-product-handbook-review-processes/1',
      digest: sha(Buffer.from(chapters.processes)),
      batches: [{ id: 'p1', processes: [{ id: 'P1', name: 'Order to archive', features: ['F1', 'F2'], steps: 3 }] }],
    });
    writeFileSync(join(run.out, 'entries', 'review-facts.json'), JSON.stringify({ batches: [{ id: 'b1' }] }));
    run.writeJson(join(run.out, 'entries', 'review', 'b1.json'), { items: B1 });
    run.writeJson(join(run.out, 'entries', 'review', 'p1.json'), { items: P1 });
    all.review = reviewChapterText({ strings: ui, map: run.map, outDir: run.out }, [{ batch: { id: 'b1' }, items: B1 }, { batch: { id: 'p1' }, items: P1 }]);
  }
  const records = {};
  for (const [name, text] of Object.entries(all)) {
    writeFileSync(join(run.out, 'chapters', `${name}.md`), text);
    records[name] = { status: failed.includes(name) ? 'failed' : 'passed', attempts: 1, reasons: [], sha256: sha(Buffer.from(text)) };
  }
  writeFileSync(join(run.out, 'state.json'), JSON.stringify({ format: 'excavator-product-handbook-state/2', chapters: records }));
  run.load = () => {
    const loaded = loadMdRun(run.out, run.root);
    if (!loaded.ok) throw new Error(loaded.lines.join('\n'));
    return loaded;
  };
  return run;
}

const FULL = { defects: DEFECTS, F1, F2, F3, processes: PROCESSES, remedies: REMEDIES };
const dataOf = (run, views = ['product', 'technical']) => buildPageData(run.load(), [run.root], { views });
const row = (data, id) => data.problems.rows.find((entry) => entry.id === id);

describe('page data /23: processes', () => {
  it('is format /23 and lists each process with its number, name, steps, end state and features', () => {
    const data = dataOf(setup({ chapters: FULL }));
    expect(data.format).toBe('excavator-product-handbook-page/23');
    expect(data.processes.items.map((item) => [item.id, item.name, item.steps.length, item.features])).toEqual([
      ['P1', 'Order to archive', 3, ['F1', 'F2']],
      ['P2', 'Reminder run', 1, ['F3']],
    ]);
    const [first] = data.processes.items;
    expect(first.steps.map((step) => [step.role, step.operation, step.feature])).toEqual([
      ['Clerk', 'Place an order', 'F1'], ['System', 'Archive an order', 'F2'], ['Approver', 'Close an order', 'F1'],
    ]);
    // The sentence is flattened, without its citations or the closing bracket of the feature reference.
    expect(first.steps[0].text).toBe('The clerk saves the order.');
    expect(first.steps[1].text).toBe(`The system moves it to the archive${WIDE_COMMA}later.`);
    expect(first.end.text).toBe('Archived.');
    // A colon after the feature reference (ASCII or full-width) is not part of the sentence.
    expect(first.steps[2].text).toBe('The approver closes it.');
    expect(data.processes.items[1].steps[0].text).toBe('The job mails the clerk.');
    expect(data.processes.items[1].end).toBeUndefined();
    expect(Object.keys(data)).toContain('processes');
  });

  it('gives citations only in the technical view', () => {
    const run = setup({ chapters: FULL });
    const technical = dataOf(run, ['technical']).processes.items[0];
    expect(technical.steps[0].cites).toEqual([`${FORM}:5`, `${FORM}:6`]);
    expect(technical.end.cites).toEqual([`${FORM}:7`]);
    const product = dataOf(run, ['product']);
    expect(JSON.stringify(product.processes)).not.toMatch(/order-form\.js/);
    expect(Object.hasOwn(product.processes.items[0].steps[0], 'cites')).toBe(false);
  });

  it('lists the operations no step names, by feature', () => {
    const data = dataOf(setup({ chapters: FULL }));
    expect(data.processes.coverage).toEqual([{ feature: 'F2', operations: ['Restore an order'] }]);
  });

  it('is null without a business-processes chapter, and for one that did not pass its check', () => {
    expect(dataOf(setup({ chapters: { defects: DEFECTS, F1, F2, remedies: REMEDIES } })).processes).toBeNull();
    expect(dataOf(setup({ chapters: FULL, failed: ['processes'] })).processes).toBeNull();
  });
});

describe('page data /23: the process and the remedies of a row', () => {
  it('carries the process of a design row that names one, and no key on the others', () => {
    const data = dataOf(setup({ chapters: FULL }));
    const design = data.problems.rows.filter((entry) => entry.type === 'design');
    expect(design).toHaveLength(3);
    expect(design.filter((entry) => Object.hasOwn(entry, 'process')).map((entry) => entry.process)).toEqual(['P1']);
    expect(data.problems.rows.filter((entry) => entry.type !== 'design').some((entry) => Object.hasOwn(entry, 'process'))).toBe(false);
  });

  it('links a row to every item of the remedies chapter whose id group names it; an id no row has changes nothing', () => {
    const data = dataOf(setup({ chapters: FULL }));
    expect(row(data, 'd1').remedies).toEqual([{ heading: 'Measures across processes', anchor: 'remedy-7' }, { heading: 'To fix', anchor: 'remedy-15' }]);
    expect(row(data, 'd2').remedies).toEqual([{ heading: 'Defect fixes', anchor: 'remedy-11' }]);
    const designs = data.problems.rows.filter((entry) => entry.type === 'design');
    // Which design problem is R1 depends on the sort of the chapter: the one the first item names has that item, the others have none.
    expect(designs.filter((entry) => entry.remedies.length > 0).map((entry) => [entry.id, entry.remedies])).toEqual([['r1', [{ heading: 'Measures across processes', anchor: 'remedy-7' }]]]);
    expect(designs.filter((entry) => entry.remedies.length === 0)).toHaveLength(designs.length - 1);
    expect(data.problems.rows.filter((entry) => entry.type === 'open').every((entry) => entry.remedies.length === 0)).toBe(true);
  });

  it('keeps the link to the category or dimension section for a remedies chapter that names no id, and gives [] when there is none', () => {
    const data = dataOf(setup({ chapters: { ...FULL, remedies: OLD_REMEDIES } }));
    expect(row(data, 'd1').remedies).toEqual([{ heading: 'Fix security problems', anchor: 'h-0' }]);
    expect(row(data, 'd2').remedies).toEqual([]);
    const duplication = data.problems.rows.find((entry) => entry.group === 'duplication');
    expect(duplication.remedies).toEqual([{ heading: 'Duplication', anchor: 'h-1' }]);
    expect(Object.hasOwn(row(data, 'd1'), 'remedy')).toBe(false);
  });

  it('puts each anchor on the line the page renders the item on, in both views', () => {
    const data = dataOf(setup({ chapters: FULL }));
    const chapter = data.chapters.find((entry) => entry.id === 'remedies');
    const anchors = [...new Set(data.problems.rows.flatMap((entry) => entry.remedies.map((link) => link.anchor)))];
    expect(anchors.sort()).toEqual(['remedy-11', 'remedy-15', 'remedy-7']);
    const words = { 'remedy-7': 'Merge entrances', 'remedy-11': 'Show the button', 'remedy-15': 'Move the secret' };
    for (const view of ['product', 'technical']) {
      const lines = chapter.texts[view].split('\n');
      for (const [anchor, word] of Object.entries(words)) expect(lines[Number(anchor.slice('remedy-'.length)) - 1], `${view} ${anchor}`).toContain(word);
    }
  });
});

describe('page data /23: the search index', () => {
  it('has the numbered process headings, the generated sections and one item per defect and design problem with its number', () => {
    const data = dataOf(setup({ chapters: FULL }));
    const headings = data.search.filter((item) => item.kind === 'heading' && item.chapter === 'processes').map((item) => item.title);
    expect(headings).toEqual(['P1 Order to archive', 'P2 Reminder run', 'Operations in no process']);
    expect(data.search.some((item) => item.kind === 'heading' && item.chapter === 'remedies' && item.title === 'Problems no measure addresses')).toBe(true);
    const problems = data.search.filter((item) => item.kind === 'problem');
    expect(problems.map((item) => [item.id, item.title])).toEqual([
      ['d1', 'D1 Open secret'], ['d2', 'D2 Hidden button'], ['r1', expect.stringMatching(/^R1 /)], ['r2', expect.stringMatching(/^R2 /)], ['r3', expect.stringMatching(/^R3 /)],
    ]);
  });
});
