// Oracle of openspec change handbook-page-structure (tasks 2.1 to 2.3, design D1, D3, D4, D5): the
// `problems` key of the page data holds one row per defect, design problem and open question, a
// state for each source, and the remedy anchor found by name. The runs are written chapter by
// chapter here with records that match the bytes, so no command is run. Full-width marks are built
// from code points so that this file holds only ASCII.
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { loadMdRun } from '../../../skills/excavator-product-handbook/lib/md-run.mjs';
import { buildPageData } from '../../../skills/excavator-product-handbook/lib/page-data.mjs';
import { problemsData, summaryOf } from '../../../skills/excavator-product-handbook/lib/page-problems.mjs';
import { reviewChapterText } from '../../../skills/excavator-product-handbook/lib/review-render.mjs';
import { loadUi } from '../../../skills/excavator-product-handbook/lib/ui.mjs';
import { FORM } from './md-run-fixture.mjs';
import { makeRun } from './helpers.mjs';

const WIDE_SEMICOLON = String.fromCharCode(0xff1b);
const WIDE_STOP = String.fromCharCode(0x3002);
const ELLIPSIS = String.fromCharCode(0x2026);
const sha = (text) => createHash('sha256').update(text).digest('hex');

const DEFECTS = `# Defects

## P0

- **security** A secret is stored in the code, Orders (F1) and Archive (F2) (\`${FORM}:5\`); it can leak.

## P1

- **display** **Hidden button** The list hides a button, Orders (F1). A second sentence follows (\`${FORM}:6\`).

## P2

- **time** ${'a long word '.repeat(14)}with no stop at all, Reminders (F3).
`;

const item = (over) => ({
  dimension: 'duplication', impact: 'high', features: ['F1', 'F2'], title: 'Two places end an order',
  situation: 'Both features close an order', consequence: 'A clerk must know which one to use', cites: [`${FORM}:7`, `${FORM}:8`], ...over,
});
const B1 = [
  item({ dimension: 'access', impact: 'low', title: 'A low access item' }),
  item({}),
];
const B2 = [item({ title: 'A second duplication', features: ['F3', 'F4'] })];

const SYSTEM = `# System

## Points to confirm

- **Archive owner** Who owns the archive (\`${FORM}:5\`)?
- A question that is wrapped
  onto a second line.

None.
`;
const F1 = '# Orders\n\n## Points to confirm\n\n- None.\n';
const F2 = '# Archive\n\n## Points to confirm\n\n- Is the archive kept for good?\n';

const REMEDIES = `# Remedies

## Fix security problems

Text.

## The display fixes

### A subsection about display

Text.

## About time

## More time

## Permissions and roles
`;

const dirs = [];
afterEach(() => {
  while (dirs.length > 0) dirs.pop()();
});

/** A run with `chapters` ({ name: text }) checked as written; `failed` names the chapters whose record is failed. */
function setup({ chapters = {}, batches = null, failed = [] } = {}) {
  const run = makeRun();
  dirs.push(run.cleanup);
  run.writeMap();
  mkdirSync(join(run.out, 'chapters'), { recursive: true });
  mkdirSync(join(run.out, 'entries', 'review'), { recursive: true });
  const records = {};
  const write = (name, text) => {
    writeFileSync(join(run.out, 'chapters', `${name}.md`), text);
    records[name] = { status: failed.includes(name) ? 'failed' : 'passed', attempts: 1, reasons: [], sha256: sha(Buffer.from(text)) };
  };
  const ui = loadUi(run.out).strings;
  const all = { ...chapters };
  if (batches !== null) {
    const ids = Object.keys(batches);
    writeFileSync(join(run.out, 'entries', 'review-facts.json'), JSON.stringify({ batches: ids.map((id) => ({ id })) }));
    for (const [id, items] of Object.entries(batches)) run.writeJson(join(run.out, 'entries', 'review', `${id}.json`), { items });
    all.review = reviewChapterText({ strings: ui, map: run.map }, ids.map((id) => ({ batch: { id }, items: batches[id] })));
  }
  for (const [name, text] of Object.entries(all)) write(name, text);
  writeFileSync(join(run.out, 'state.json'), JSON.stringify({ format: 'excavator-product-handbook-state/2', chapters: records }));
  run.load = () => {
    const loaded = loadMdRun(run.out, run.root);
    if (!loaded.ok) throw new Error(loaded.lines.join('\n'));
    return loaded;
  };
  return run;
}
const full = (extra = {}) => setup({ chapters: { defects: DEFECTS, system: SYSTEM, F1, F2, remedies: REMEDIES, ...extra }, batches: { b1: B1, b2: B2 } });
const rowsOf = (data, type) => data.rows.filter((row) => row.type === type);

describe('problemsData: rows', () => {
  it('lists the defects, then the design problems, then the open questions, with their fields', () => {
    const run = full();
    const data = problemsData(run.load(), ['product', 'technical']);
    expect(data.sources).toEqual({ defects: { state: 'ok', count: 3 }, design: { state: 'ok', count: 3 }, open: { state: 'ok', count: 3, unmatched: [] } });
    expect(data.rows.map((row) => row.id)).toEqual(['d1', 'd2', 'd3', 'r1', 'r2', 'r3', 'q1', 'q2', 'q3']);
    const [d1, d2, d3] = rowsOf(data, 'defect');
    expect([d1.level, d1.group, d1.features, d1.source]).toEqual(['P0', 'security', ['F1', 'F2'], { chapter: 'defects', line: 5 }]);
    expect([d2.level, d2.group, d2.features]).toEqual(['P1', 'display', ['F1']]);
    expect([d3.level, d3.group, d3.features]).toEqual(['P2', 'time', ['F3']]);
    expect(d1.texts.technical).toBe(`A secret is stored in the code, Orders (F1) and Archive (F2) (\`${FORM}:5\`); it can leak.`);
    expect(d1.texts.product).not.toContain('`');
    expect(d1.texts.product).not.toContain('**');
    expect(d1.cites).toEqual([`${FORM}:5`]);
    expect(d1.summary).toBe('A secret is stored in the code, Orders (F1) and Archive (F2)');
    // An item with a short title (design D20) is labelled by it, and its text starts after it; one without falls back to its first clause.
    expect(d2.summary).toBe('Hidden button');
    expect(d2.texts.product.startsWith('The list hides a button')).toBe(true);
    expect(d2.texts.technical).not.toContain('Hidden button');
    expect(d3.summary).toHaveLength(121);
    expect(d3.summary.endsWith(ELLIPSIS)).toBe(true);
  });

  it('lists the design problems in the order of the chapter, as titles with situation and consequence', () => {
    const data = problemsData(full().load(), ['product', 'technical']);
    const design = rowsOf(data, 'design');
    expect(design.map((row) => [row.summary, row.level, row.group])).toEqual([
      ['Two places end an order', 'high', 'duplication'],
      ['A second duplication', 'high', 'duplication'],
      ['A low access item', 'low', 'access'],
    ]);
    expect(design[0].texts.product).toEqual({ situation: 'Both features close an order', consequence: 'A clerk must know which one to use' });
    expect(design[1].features).toEqual(['F3', 'F4']);
    expect(design[0].cites).toEqual([`${FORM}:7`, `${FORM}:8`]);
    expect(design[0].source.chapter).toBe('review');
    expect(design.map((row) => row.source.line)).toEqual([...design.map((row) => row.source.line)].sort((a, b) => a - b));
    expect(design[0].source.line).toBeGreaterThan(1);
  });

  it('lists the open questions of the system and each feature, skipping the none line and joining a wrapped item', () => {
    const data = problemsData(full().load(), ['product', 'technical']);
    const open = rowsOf(data, 'open');
    expect(open.map((row) => [row.features, row.level, row.group, row.remedy])).toEqual([[['system'], null, null, null], [['system'], null, null, null], [['F2'], null, null, null]]);
    expect(open[0].texts.technical).toContain('Who owns the archive');
    expect(open[0].cites).toEqual([`${FORM}:5`]);
    expect(open[0].texts.product).not.toContain('`');
    expect(open[1].texts.product).toBe('A question that is wrapped onto a second line.');
    expect(open[1].cites).toEqual([]);
    expect(open[2].source.chapter).toBe('F2');
    expect(open[0].source).toEqual({ chapter: 'system', line: 5 });
  });

  it('labels an open question with its short bold title and starts its text after the title (design D21)', () => {
    const open = rowsOf(problemsData(full().load(), ['product', 'technical']), 'open');
    expect(open[0].summary).toBe('Archive owner');
    expect(open[0].texts.product).toBe('Who owns the archive?');
    expect(open[0].texts.technical).not.toContain('Archive owner');
    // An item without a title (an older output) keeps its whole text and a label cut from it.
    expect(open[1].summary).toBe('A question that is wrapped onto a second line');
    expect(open[1].texts.product).toBe('A question that is wrapped onto a second line.');
  });

  it('gives the product view no citation and no cites key, and the technical view the cites', () => {
    const product = problemsData(full().load(), ['product']);
    for (const row of product.rows) {
      expect(Object.keys(row.texts)).toEqual(['product']);
      expect(Object.hasOwn(row, 'cites')).toBe(false);
      expect(JSON.stringify(row)).not.toMatch(/\.js:\d/);
    }
    const technical = problemsData(full().load(), ['technical']);
    for (const row of technical.rows) {
      expect(Object.keys(row.texts)).toEqual(['technical']);
      expect(Array.isArray(row.cites)).toBe(true);
    }
    expect(rowsOf(technical, 'defect')[0].cites).toEqual([`${FORM}:5`]);
  });
});

describe('summaryOf', () => {
  it('cuts at the first sentence end and drops it', () => {
    expect(summaryOf(`One part${WIDE_SEMICOLON}second part${WIDE_STOP}`)).toBe('One part');
    expect(summaryOf(`First sentence${WIDE_STOP}second`)).toBe('First sentence');
    expect(summaryOf('One part; second part. Third')).toBe('One part');
    expect(summaryOf('First sentence. Second; third')).toBe('First sentence');
    expect(summaryOf('A single sentence.')).toBe('A single sentence');
    expect(summaryOf('No stop here')).toBe('No stop here');
  });

  it('keeps 120 characters and an ellipsis when no end comes within them', () => {
    const long = `${'x'.repeat(130)}. tail`;
    expect(summaryOf(long)).toBe(`${'x'.repeat(120)}${ELLIPSIS}`);
    expect(summaryOf(`${'y'.repeat(120)}. tail`)).toBe('y'.repeat(120));
  });
});

describe('problemsData: remedies', () => {
  it('links a defect to the one level-2 heading naming its category, counting every ## and ### heading', () => {
    const data = problemsData(full().load(), ['product']);
    expect(data.remedies).toBe('remedies');
    const [security, display, time] = rowsOf(data, 'defect');
    expect(security.remedy).toEqual({ chapter: 'remedies', heading: 0 });
    expect(display.remedy).toEqual({ chapter: 'remedies', heading: 1 });
    expect(time.remedy).toBeNull();
  });

  it('links a design problem by the dimension label and leaves a dimension with no heading unlinked', () => {
    const data = problemsData(full().load(), ['product']);
    const design = rowsOf(data, 'design');
    expect(design.find((row) => row.group === 'access').remedy).toEqual({ chapter: 'remedies', heading: 5 });
    expect(design.find((row) => row.group === 'duplication').remedy).toBeNull();
  });

  it('links a row to the level-2 heading of the first item whose id group names its number; a row no item names gets none', () => {
    const numbered = `# Remedies

## Measures across processes

- **Merge entrances** Close orders in one place [R1, D1] (\`${FORM}:7\`).

## Defect fixes

- **display** Show the button [D2] (\`${FORM}:6\`).

## To simplify and unify

1. **Unify the rule** One duplication rule [R2] (\`${FORM}:7\`).

## To fix

1. **Fix** Move the secret [D1] (\`${FORM}:5\`).
`;
    const data = problemsData(full({ remedies: numbered }).load(), ['product']);
    const heading = (id) => data.rows.find((row) => row.id === id).remedy;
    expect(heading('d1')).toEqual({ chapter: 'remedies', heading: 0 });
    expect(heading('d2')).toEqual({ chapter: 'remedies', heading: 1 });
    expect(heading('d3')).toBeNull();
    expect(heading('r1')).toEqual({ chapter: 'remedies', heading: 0 });
    expect(heading('r2')).toEqual({ chapter: 'remedies', heading: 2 });
    expect(heading('r3')).toBeNull();
  });

  it('has no remedies chapter id and no links without a remedies chapter', () => {
    const run = setup({ chapters: { defects: DEFECTS, system: SYSTEM }, batches: { b1: B1, b2: B2 } });
    const data = problemsData(run.load(), ['product']);
    expect(data.remedies).toBeNull();
    expect(data.rows.every((row) => row.remedy === null)).toBe(true);
  });

  it('matches a category as a whole word only', () => {
    const run = setup({ chapters: { defects: DEFECTS, system: SYSTEM, remedies: '# R\n\n## Fix timeouts\n\n## Fix securityfoo\n' } });
    const data = problemsData(run.load(), ['product']);
    expect(rowsOf(data, 'defect').map((row) => row.remedy)).toEqual([null, null, null]);
  });
});

describe('problemsData: states', () => {
  const stateOf = (run, source) => problemsData(run.load(), ['product']).sources[source];

  it('says missing for a defects or review chapter that was not written, with no rows and no count', () => {
    const run = setup({ chapters: { system: SYSTEM } });
    const data = problemsData(run.load(), ['product']);
    expect(data.sources.defects).toEqual({ state: 'missing', count: null });
    expect(data.sources.design).toEqual({ state: 'missing', count: null });
    expect(data.sources.open).toEqual({ state: 'ok', count: 2, unmatched: [] });
    expect(data.rows.map((row) => row.type)).toEqual(['open', 'open']);
  });

  it('says failed for a chapter whose record is not passed', () => {
    const run = setup({ chapters: { defects: DEFECTS, system: SYSTEM }, batches: { b1: B1, b2: B2 }, failed: ['defects', 'review'] });
    const data = problemsData(run.load(), ['product']);
    expect(data.sources.defects).toEqual({ state: 'failed', count: null });
    expect(data.sources.design).toEqual({ state: 'failed', count: null });
    expect(rowsOf(data, 'defect')).toEqual([]);
    expect(rowsOf(data, 'design')).toEqual([]);
  });

  it('says failed for a defects chapter with an item the parser cannot split, and gives no defect rows', () => {
    const run = setup({ chapters: { defects: `${DEFECTS}\n- **bogus** An item with an unknown category, Orders (F1).\n` } });
    const data = problemsData(run.load(), ['product']);
    expect(data.sources.defects).toEqual({ state: 'failed', count: null });
    expect(rowsOf(data, 'defect')).toEqual([]);
  });

  it('says changed when a batch file was edited after the chapter was rendered', () => {
    const run = full();
    run.writeJson(join(run.out, 'entries', 'review', 'b1.json'), { items: [item({ title: 'An edited title' })] });
    expect(stateOf(run, 'design')).toEqual({ state: 'changed', count: null });
  });

  it('says changed when a batch file is missing or is not an items list', () => {
    const run = full();
    rmSync(join(run.out, 'entries', 'review', 'b2.json'));
    expect(stateOf(run, 'design')).toEqual({ state: 'changed', count: null });
    run.writeJson(join(run.out, 'entries', 'review', 'b2.json'), { other: [] });
    expect(stateOf(run, 'design')).toEqual({ state: 'changed', count: null });
  });

  it('uses the batches of the map when there is no facts file', () => {
    const run = setup({ chapters: {}, batches: { b1: B1, b2: B2, cross: [] } });
    rmSync(join(run.out, 'entries', 'review-facts.json'));
    expect(stateOf(run, 'design')).toEqual({ state: 'ok', count: 3 });
  });

  it('takes the items of a numbered list as questions, like bullets', () => {
    const run = setup({ chapters: { system: '# System\n\n## Points to confirm\n\n1. Who owns the archive?\n2) Is it kept\n   for good?\n10. A third one.\n' } });
    const open = rowsOf(problemsData(run.load(), ['product']), 'open');
    expect(open.map((row) => [row.texts.product, row.source.line])).toEqual([['Who owns the archive?', 5], ['Is it kept for good?', 6], ['A third one.', 8]]);
  });

  it('counts an open source with no question as ok with 0', () => {
    const run = setup({ chapters: { system: '# System\n\n## Points to confirm\n\nNone.\n' } });
    expect(stateOf(run, 'open')).toEqual({ state: 'ok', count: 0, unmatched: [] });
  });

  it('lists a chapter with another section heading as unmatched and takes no rows from it', () => {
    const run = setup({ chapters: { system: SYSTEM, F1, F2: '# Archive\n\n## Things to confirm\n\n- Is the archive kept for good?\n' } });
    const data = problemsData(run.load(), ['product']);
    expect(data.sources.open).toEqual({ state: 'ok', count: 2, unmatched: ['F2'] });
    expect(data.rows.every((row) => row.features[0] === 'system')).toBe(true);
  });

  it('does not list a chapter whose section holds only the none line', () => {
    const run = setup({ chapters: { system: '# System\n\n## Points to confirm\n\nNone.\n', F1 } });
    expect(stateOf(run, 'open')).toEqual({ state: 'ok', count: 0, unmatched: [] });
  });
});

describe('buildPageData: the problems key', () => {
  it('comes right after domains and holds the same table', () => {
    const run = full();
    const loaded = run.load();
    const data = buildPageData(loaded, [run.root], { views: ['product', 'technical'] });
    const keys = Object.keys(data);
    expect(keys.indexOf('problems')).toBe(keys.indexOf('domains') + 1);
    expect(data.problems.rows).toHaveLength(9);
    expect(data.problems.sources.defects.count).toBe(3);
    expect(data.format).toBe('excavator-product-handbook-page/22');
  });
});
