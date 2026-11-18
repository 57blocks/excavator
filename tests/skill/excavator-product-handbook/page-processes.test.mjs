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
function setup({ chapters, failed = [], domains = null }) {
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
  if (domains !== null) {
    // Two domains give two batches of design problems: the second has none.
    const list = Buffer.from(`${JSON.stringify({ domains, handovers: [] })}\n`);
    writeFileSync(join(run.out, 'domains.json'), list);
    writeFileSync(join(run.out, 'entries', 'review-facts.json'), JSON.stringify({ batches: [{ id: 'b1' }, { id: 'b2' }] }));
    run.writeJson(join(run.out, 'entries', 'review', 'b2.json'), { items: [] });
    all.domains = '# Domains\n';
    records.domains = { status: 'passed', attempts: 1, reasons: [], sha256: sha(Buffer.from(all.domains)), json: sha(list) };
  }
  for (const [name, text] of Object.entries(all)) {
    writeFileSync(join(run.out, 'chapters', `${name}.md`), text);
    if (name === 'domains' && domains !== null) continue;
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
  it('has each process by its name (no number in the title, the chapter itself and its headings left out), the generated section of the remedies and one item per defect and design problem with its number', () => {
    const data = dataOf(setup({ chapters: FULL }));
    expect(data.search.filter((item) => item.chapter === 'processes')).toEqual([]);
    const processes = data.search.filter((item) => item.kind === 'process');
    expect(processes.map((item) => [item.id, item.title])).toEqual([['P1', 'Order to archive'], ['P2', 'Reminder run']]);
    expect(data.search.some((item) => item.kind === 'heading' && item.chapter === 'remedies' && item.title === 'Problems no measure addresses')).toBe(true);
    const problems = data.search.filter((item) => item.kind === 'problem');
    expect(problems.map((item) => [item.id, item.title])).toEqual([
      ['d1', 'D1 Open secret'], ['d2', 'D2 Hidden button'], ['r1', expect.stringMatching(/^R1 /)], ['r2', expect.stringMatching(/^R2 /)], ['r3', expect.stringMatching(/^R3 /)],
    ]);
  });
});

const BY_PROCESS = `# Remedies

## P1 Order to archive

- **Merge entrances** Close orders in one place [P1, R1, D1] (\`${FORM}:7\`).
- **Show it** Show the button [P1, D2] (\`${FORM}:6\`).

## P2 Reminder run

- **Fix** Mail the clerk [P2, D1] (\`${FORM}:6\`).

## Defect fixes

- **display** Show the button [D2, D99] (\`${FORM}:6\`).
`;
const DOMAINS = [{ name: 'Order domain', features: ['F1'] }, { name: 'Other domain', features: ['F2', 'F3'] }];
const BY_PROCESS_RUN = { ...FULL, remedies: BY_PROCESS };
const lineOf = (data, word, view = 'technical') => data.chapters.find((entry) => entry.id === 'remedies').texts[view].split('\n').findIndex((text) => text.includes(word)) + 1;

describe('page data /23: the domain of a process', () => {
  it('is the page id of the domain of the first step feature, even when a later step passes through another domain', () => {
    const data = dataOf(setup({ chapters: FULL, domains: DOMAINS }));
    expect(data.domains.state).toBe('ok');
    // P1 starts at F1 (first domain) and also passes through F2 (second); P2 starts at F3 (second).
    expect(data.processes.items.map((item) => [item.id, item.domain])).toEqual([['P1', 'd1'], ['P2', 'd2']]);
  });

  it('has no domain key when the domains are not usable or no domain lists the feature', () => {
    const none = dataOf(setup({ chapters: FULL })).processes.items;
    expect(none.some((item) => Object.hasOwn(item, 'domain'))).toBe(false);
    const partial = dataOf(setup({ chapters: FULL, domains: [{ name: 'Order domain', features: ['F1'] }, { name: 'Empty one', features: [] }, { name: 'Third', features: ['F2'] }] })).processes.items;
    expect(partial.map((item) => Object.hasOwn(item, 'domain'))).toEqual([true, false]);
  });
});

describe('page data /23: the remedies of a process', () => {
  it('lists the items under the heading of the process in chapter order, with their text by view', () => {
    const data = dataOf(setup({ chapters: BY_PROCESS_RUN }));
    const [first, second] = data.processes.items;
    expect(first.remedies.map((entry) => entry.line)).toEqual([lineOf(data, 'Merge entrances'), lineOf(data, 'Show it')]);
    expect(first.remedies[0].texts.technical).toContain('Close orders in one place [P1, R1, D1]');
    expect(first.remedies[0].texts.technical).toContain(`\`${FORM}:7\``);
    expect(first.remedies[0].texts.product).toContain('Close orders in one place [P1, R1, D1]');
    expect(first.remedies[0].texts.product).not.toContain(FORM);
    expect(second.remedies.map((entry) => entry.line)).toEqual([lineOf(data, 'Mail the clerk')]);
  });

  it('says on each remedy entry of a row which page it is on: the process page for an item under a process, the remedies page for the others', () => {
    const data = dataOf(setup({ chapters: BY_PROCESS_RUN }));
    expect(row(data, 'd1').remedies).toEqual([
      { heading: 'P1 Order to archive', anchor: `remedy-${lineOf(data, 'Merge entrances')}`, process: 'P1' },
      { heading: 'P2 Reminder run', anchor: `remedy-${lineOf(data, 'Mail the clerk')}`, process: 'P2' },
    ]);
    expect(row(data, 'd2').remedies).toEqual([
      { heading: 'P1 Order to archive', anchor: `remedy-${lineOf(data, 'Show it')}`, process: 'P1' },
      { heading: 'Defect fixes', anchor: `remedy-${lineOf(data, 'Show the button [D2, D99]')}` },
    ]);
  });

  it('folds the sections of the processes in the search index into one heading in front of the others, numbered the way the page numbers them', () => {
    const data = dataOf(setup({ chapters: BY_PROCESS_RUN }));
    const headings = data.search.filter((item) => item.kind === 'heading' && item.chapter === 'remedies');
    expect(headings.map((item) => [item.title, item.heading])).toEqual([['Suggestions along the business processes', 0], ['Defect fixes', 1], ['Problems no measure addresses', 2]]);
  });

  it('leaves an old output as it was: no process section, no remedies on a process, no process on an entry, every heading in the index', () => {
    const data = dataOf(setup({ chapters: FULL }));
    expect(data.processes.items.some((item) => Object.hasOwn(item, 'remedies'))).toBe(false);
    expect(data.problems.rows.flatMap((entry) => entry.remedies).some((link) => Object.hasOwn(link, 'process'))).toBe(false);
    const headings = data.search.filter((item) => item.kind === 'heading' && item.chapter === 'remedies').map((item) => [item.title, item.heading]);
    expect(headings).toEqual([['Measures across processes', 0], ['Defect fixes', 1], ['To fix', 2], ['Problems no measure addresses', 3]]);
    // A run with no processes chapter keeps the sections `P<n> <name>` where they are: they name no process of the page.
    const bare = dataOf(setup({ chapters: { defects: DEFECTS, F1, F2, remedies: BY_PROCESS } }));
    expect(bare.processes).toBeNull();
    expect(bare.problems.rows.flatMap((entry) => entry.remedies).some((link) => Object.hasOwn(link, 'process'))).toBe(false);
    expect(bare.search.filter((item) => item.kind === 'heading' && item.chapter === 'remedies').map((item) => item.title)).toContain('P1 Order to archive');
  });
});

const BY_DOMAIN_TEXT = `# Remedies

## P1 Order to archive

- **Merge entrances** Close orders in one place [P1, D1] (\`${FORM}:7\`).

## Defect fixes

- **display** Fix both sides [D1, D2, P2] (\`${FORM}:6\`).

- **display** A note with no ids here (\`${FORM}:6\`).
`;
const BY_DOMAIN_RUN = { ...FULL, remedies: BY_DOMAIN_TEXT };

describe('page data /23: the items of the remedies under the business domains', () => {
  const data = () => dataOf(setup({ chapters: BY_DOMAIN_RUN, domains: DOMAINS }));

  it('puts an item that names defects of two domains and a process under both domains, with the problems of each domain only', () => {
    const page = data();
    const both = lineOf(page, 'Fix both sides');
    const [first, second] = page.remedyDomains.domains;
    // D1 is a defect of F1 (first domain), D2 of F2 and P2 starts at F3 (second domain).
    expect([first.id, second.id]).toEqual(['d1', 'd2']);
    expect(first.sections).toEqual([{ heading: 'Defect fixes', items: [{ line: both, problems: ['d1'] }] }]);
    expect(second.sections).toEqual([{ heading: 'Defect fixes', items: [{ line: both, problems: ['d2'] }] }]);
    expect(second.processes).toEqual([]);
  });

  it('puts an item under the heading of a process under that process, in the domain of its first step, with every problem it names', () => {
    const page = data();
    const merge = lineOf(page, 'Merge entrances');
    expect(page.remedyDomains.domains[0].processes).toEqual([{ id: 'P1', items: [{ line: merge, problems: ['d1'] }] }]);
    expect(page.remedyDomains.items.map((item) => item.line)).toEqual([merge, lineOf(page, 'Fix both sides'), lineOf(page, 'A note with no ids')]);
    expect(page.remedyDomains.items[0].texts.product).not.toContain(FORM);
    expect(page.remedyDomains.items[0].texts.technical).toContain(FORM);
  });

  it('puts an item with no id in the bucket of the items tied to no domain', () => {
    const page = data();
    expect(page.remedyDomains.untied).toEqual([{ line: lineOf(page, 'A note with no ids'), problems: [] }]);
  });

  it('says on each entry of a row where it is: under the domain of the row, or on the page of the process', () => {
    const page = data();
    const both = lineOf(page, 'Fix both sides');
    expect(row(page, 'd1').remedies).toEqual([
      { heading: 'P1 Order to archive', anchor: `remedy-${lineOf(page, 'Merge entrances')}`, process: 'P1' },
      { heading: 'Defect fixes', anchor: `remedy-d1-${both}`, domain: 'd1' },
    ]);
    expect(row(page, 'd2').remedies).toEqual([{ heading: 'Defect fixes', anchor: `remedy-d2-${both}`, domain: 'd2' }]);
  });

  it('has the headings of the new layout in the search index: the domains, their processes and sections, the untied section', () => {
    const page = data();
    const headings = page.search.filter((item) => item.kind === 'heading' && item.chapter === 'remedies').map((item) => [item.title, item.level, item.heading]);
    expect(headings).toEqual([
      ['Order domain', 2, 0], ['Order to archive', 3, 1], ['Defect fixes', 3, 2],
      ['Other domain', 2, 3], ['Defect fixes', 3, 4],
      ['Not tied to a business domain', 2, 5], ['Problems no measure addresses', 2, 6],
    ]);
  });

  it('leaves an old output as it was: no domain layout without usable domains or without an id in the chapter, and the entries as before', () => {
    const noDomains = dataOf(setup({ chapters: BY_DOMAIN_RUN }));
    expect(noDomains.remedyDomains).toBeNull();
    expect(row(noDomains, 'd2').remedies.some((link) => Object.hasOwn(link, 'domain'))).toBe(false);
    const oldChapter = dataOf(setup({ chapters: { ...FULL, remedies: OLD_REMEDIES }, domains: DOMAINS }));
    expect(oldChapter.remedyDomains).toBeNull();
    expect(row(oldChapter, 'd1').remedies).toEqual([{ heading: 'Fix security problems', anchor: 'h-0' }]);
  });
});

describe('page data /23: the coverage page', () => {
  it('has the operations no step names as a section of its own, with the same lines as the chapter generated section, and none without processes', () => {
    const page = dataOf(setup({ chapters: FULL }));
    expect(page.coverage.product).toContain('## Operations in no process');
    expect(page.coverage.product).toContain('- Archive (F2): Restore an order');
    const chapter = page.chapters.find((entry) => entry.id === 'processes').texts.product;
    expect(chapter).toContain('- Archive (F2): Restore an order');
    const bare = dataOf(setup({ chapters: { defects: DEFECTS, F1, F2, remedies: REMEDIES } }));
    expect(bare.coverage.product).not.toContain('Operations in no process');
  });
});
