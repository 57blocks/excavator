// openspec change handbook-design-review, task 2.2: `review render` refuses each class of bad item with one line naming
// the batch, the item and the rule, validates only the named batches without writing, and, with no batch named,
// writes chapters/review.md, which passes `check` as a cross chapter. Non-English text is built from code points.
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { SHIPPED_UI } from './helpers.mjs';
import { FORM } from './md-run-fixture.mjs';
import { goodItem, reviewRun } from './review-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

/** A run with the facts written and b2 empty, b1 holding `items`, cross empty unless given. */
function ready(items, { b2 = [], cross = [] } = {}) {
  const run = reviewRun(cleanups);
  expect(run.facts().status).toBe(0);
  run.writeBatch('b1', items);
  run.writeBatch('b2', b2);
  run.writeBatch('cross', cross);
  return run;
}

/** `item` must be refused in batch b1 with a line that names `b1 item 0` and matches `expected`. */
function refuses(name, over, expected, { b2, cross, batch = 'b1' } = {}) {
  it(name, () => {
    const run = ready([goodItem(over)], { b2, cross });
    if (batch !== 'b1') {
      run.writeBatch('b1', []);
      run.writeBatch(batch, [goodItem(over)]);
    }
    const result = run.render(batch);
    expect(result.status, result.stdout).toBe(1);
    const line = result.lines.find((entry) => entry.startsWith(`${batch} item 0:`));
    expect(line, result.stdout).toMatch(expected);
    expect(existsSync(join(run.out, 'chapters', 'review.md'))).toBe(false);
  });
}

describe('review render: a good item', () => {
  it('validates the named batch and writes nothing', () => {
    const run = ready([goodItem()]);
    const result = run.render('b1');
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines).toEqual(['b1: ok (1 items)']);
    expect(existsSync(join(run.out, 'chapters', 'review.md'))).toBe(false);
  });

  it('a number that is a fact of a listed feature, or in a cited line, is allowed; ids with digits are not numbers', () => {
    const run = ready([goodItem({ title: 'Orders (F1) and Archive (F2)', situation: 'Creating an order takes 4 steps and 1 of them is the server', consequence: 'An archived order waits 30 days', cites: [`${FORM}:7`, `${FORM}:9`] })]);
    const result = run.render('b1');
    expect(result.status, result.stdout).toBe(0);
    const marker = ready([goodItem({ consequence: 'An archived order waits 45 days' })]);
    expect(marker.render('b1').lines.join('\n')).toMatch(/the number 45 in consequence/);
  });
});

describe('review render: the rules', () => {
  refuses('a dimension that is not one of the ten', { dimension: 'slow' }, /dimension "slow" is not one of duplication, contradiction/);
  refuses('an impact that is not high, medium or low', { impact: 'urgent' }, /impact "urgent" is not one of high, medium, low/);
  refuses('an empty title', { title: '  ' }, /title must be a non-empty text/);
  refuses('an unknown key', { extra: 1 }, /exactly the keys dimension, impact, features/);
  refuses('a feature that is not in the map', { features: ['F1', 'F9'] }, /features F9 are not in the map/);
  refuses('a feature outside the batch', { features: ['F1', 'F3'] }, /features F3 are not in batch b1; an item across batches belongs to the cross batch/);
  refuses('a cite that no listed chapter holds', { cites: [`${FORM}:7`, `${FORM}:99`] }, /cite "src\/forms\/order-form.js:99" does not occur in a chapter of the features it lists \(F1, F2\)/);
  refuses('a cite copied from a feature the item does not list', { features: ['F1', 'F2'], cites: [`${FORM}:7`, `${FORM}:11`] }, /cite "src\/forms\/order-form.js:11" does not occur/);
  refuses('a two-place dimension with one chapter line', { cites: [`${FORM}:7`] }, /a duplication item needs citations from 2 different chapter lines; its citations are on 1/);
  refuses('a contradiction with one chapter line', { dimension: 'contradiction', cites: [`${FORM}:8`] }, /a contradiction item needs citations from 2 different chapter lines/);
  refuses('an inconsistency with one chapter line', { dimension: 'inconsistency', cites: [`${FORM}:8`] }, /an? inconsistency item needs citations from 2/);
  refuses('an access item with one chapter line', { dimension: 'access', cites: [`${FORM}:8`] }, /an? access item needs citations from 2/);
  refuses('a number in no cited line and no fact', { situation: 'Submitting takes 9 steps' }, /the number 9 in situation is in no cited chapter line and in no fact of the features it lists/);
  refuses('a number in the title', { title: 'Seven places and 77 clicks' }, /the number 77 in title/);
  refuses('a code word in reader text', { situation: 'The order_form screen closes the order' }, /situation: "order_form" is not allowed in reader text \(underscore identifier\)/);
  refuses('a word of advice', { consequence: 'The clerk should use one screen' }, /consequence: "should" is a word of advice/);
  refuses('a backtick', { title: 'Two `places` end an order' }, /title holds a backtick or a citation group/);
  refuses('two sentences', { situation: 'One screen ends it. Another ends it too' }, /situation holds more than one sentence/);
  refuses('a cross item with features of one batch', { features: ['F1', 'F2'] }, /a cross item lists features of 1 batch \(b1\); it needs features of 2 or more batches/, { batch: 'cross' });

  it('a one-place dimension needs no second line', () => {
    const run = ready([goodItem({ dimension: 'complexity', cites: [`${FORM}:7`] })]);
    expect(run.render('b1').status).toBe(0);
  });

  it('a cross item with features of two batches holds', () => {
    const run = ready([], { cross: [goodItem({ features: ['F1', 'F3'], cites: [`${FORM}:7`, `${FORM}:11`] })] });
    const result = run.render('cross');
    expect(result.status, result.stdout).toBe(0);
  });

  it('reports every refused item, not only the first', () => {
    const run = ready([goodItem({ dimension: 'slow' }), goodItem(), goodItem({ impact: 'urgent' })]);
    const result = run.render('b1');
    expect(result.lines.filter((line) => /^b1 item \d:/.test(line)).map((line) => line.slice(0, 9))).toEqual(['b1 item 0', 'b1 item 2']);
  });

  it('a batch file that is missing or malformed is one line', () => {
    const run = ready([goodItem()]);
    writeFileSync(join(run.out, 'entries', 'review', 'b2.json'), '{"items": 3}');
    expect(run.render('b2').lines[0]).toBe('b2: entries/review/b2.json must be an object with exactly the key "items", a list');
    expect(run.render('cross').status).toBe(0);
    writeFileSync(join(run.out, 'entries', 'review', 'cross.json'), 'nope');
    expect(run.render('cross').lines[0]).toMatch(/^cross: entries\/review\/cross.json is not valid JSON/);
  });

  it('a batch that is not in the facts file, and a missing facts file, are refused', () => {
    const run = ready([goodItem()]);
    expect(run.render('b7').lines[0]).toBe('b7 is not a batch; the batches are b1, b2, cross');
    const bare = reviewRun(cleanups);
    expect(bare.render().lines[0]).toMatch(/entries\/review-facts.json is missing; run review facts first/);
  });
});

describe('review render: the chapter', () => {
  it('with no batch named, refuses while a batch file is missing and writes nothing', () => {
    const run = ready([goodItem()]);
    rmSync(join(run.out, 'entries', 'review', 'cross.json'));
    const result = run.render();
    expect(result.status).toBe(1);
    expect(result.lines[0]).toMatch(/^cross: entries\/review\/cross.json is missing/);
    expect(existsSync(join(run.out, 'chapters', 'review.md'))).toBe(false);
  });

  it('writes fixed headings, a counts table, and one level-3 heading per item with the citation group on each field', () => {
    const run = ready(
      [goodItem(), goodItem({ dimension: 'complexity', impact: 'high', features: ['F1'], title: 'Sending takes many steps', situation: 'Creating an order takes 4 steps', consequence: 'A clerk needs several screens', cites: [`${FORM}:6`] })],
      { b2: [goodItem({ dimension: 'dead-end', impact: 'low', features: ['F3'], title: 'A reminder cannot be stopped', situation: 'Sending a reminder is one step', consequence: 'Nobody can cancel it', cites: [`${FORM}:11`] })], cross: [goodItem({ dimension: 'redundancy', features: ['F1', 'F4'], title: 'Same code twice', situation: 'Both features run the same code', consequence: 'Two places change together', cites: [`${FORM}:12`] })] },
    );
    const result = run.render();
    expect(result.status, result.stdout).toBe(0);
    expect(result.lines.slice(0, 3)).toEqual(['b1: ok (2 items)', 'b2: ok (1 items)', 'cross: ok (1 items)']);
    const text = readFileSync(join(run.out, 'chapters', 'review.md'), 'utf-8');
    expect(text.startsWith('# Design problems\n\n## Counts by dimension and impact\n\n| Dimension | High | Medium | Low |\n| --- | --- | --- | --- |\n')).toBe(true);
    expect(text).toContain('| Duplication | 0 | 1 | 0 |');
    expect(text).toContain('| Complexity | 1 | 0 | 0 |');
    expect(text).toContain('| Dead end | 0 | 0 | 1 |');
    const dims = [...text.matchAll(/^## (.+)$/gm)].map((match) => match[1]);
    expect(dims).toEqual(['Counts by dimension and impact', 'Duplication', 'Complexity', 'Redundancy', 'Dead end']);
    expect(text).toContain('### Two places end an order\n\nImpact: Medium; Features: Orders (F1), Archive (F2) (`src/forms/order-form.js:7`; `src/forms/order-form.js:8`).');
    expect(text).toContain('Situation: Both features let the clerk close an order (`src/forms/order-form.js:7`; `src/forms/order-form.js:8`).');
    expect(text).toContain('Consequence: A clerk has to know which screen to use (`src/forms/order-form.js:7`; `src/forms/order-form.js:8`).');
  });

  it('the same input gives the same bytes, and the chapter passes check as a cross chapter', () => {
    const run = ready([goodItem(), goodItem({ dimension: 'complexity', impact: 'high', features: ['F1'], title: 'Sending takes many steps', situation: 'Creating an order takes 4 steps', consequence: 'A clerk needs several screens', cites: [`${FORM}:6`] })]);
    expect(run.render().status).toBe(0);
    const first = readFileSync(join(run.out, 'chapters', 'review.md'), 'utf-8');
    expect(run.render().status).toBe(0);
    expect(readFileSync(join(run.out, 'chapters', 'review.md'), 'utf-8')).toBe(first);
    const checked = run.check('review');
    expect(checked.status, checked.stdout).toBe(0);
    expect(checked.lines).toContain('chapters/review.md: passed');
  });

  it('with no item at all, the chapter holds the counts and the fixed none line and passes check', () => {
    const run = ready([]);
    expect(run.render().status).toBe(0);
    const text = readFileSync(join(run.out, 'chapters', 'review.md'), 'utf-8');
    expect(text.trimEnd().endsWith('None.')).toBe(true);
    expect(run.check('review').status).toBe(0);
  });

  it('a text in a script without spaces gets the full-width citation group and full stop, and passes check', () => {
    const han = String.fromCharCode(0x8ba2, 0x5355);
    const run = ready([goodItem({ situation: han.repeat(3), consequence: `${han}${String.fromCharCode(0x3002)}` })]);
    expect(run.render().status).toBe(0);
    const text = readFileSync(join(run.out, 'chapters', 'review.md'), 'utf-8');
    expect(text).toContain(`Situation: ${han.repeat(3)}${String.fromCharCode(0xff08)}\`src/forms/order-form.js:7\`; \`src/forms/order-form.js:8\`${String.fromCharCode(0xff09, 0x3002)}`);
    const checked = run.check('review');
    expect(checked.status, checked.stdout).toBe(0);
  });

  it('a run whose fixed text is in a script without spaces gets full-width punctuation on every line, and passes check', () => {
    const han = (...codes) => String.fromCharCode(...codes);
    const run = ready([goodItem()]);
    const uiPath = join(run.out, 'ui.json');
    const ui = JSON.parse(readFileSync(SHIPPED_UI, 'utf-8'));
    const { strings } = ui;
    strings['chapter.review.title'] = han(0x8bbe, 0x8ba1, 0x95ee, 0x9898);
    strings['chapter.review.field.impact'] = han(0x5f71, 0x54cd);
    strings['chapter.review.field.features'] = han(0x529f, 0x80fd);
    writeFileSync(uiPath, `${JSON.stringify(ui, null, 2)}\n`);
    expect(run.render().status).toBe(0);
    const text = readFileSync(join(run.out, 'chapters', 'review.md'), 'utf-8');
    const impactLine = text.split('\n').find((line) => line.startsWith(han(0x5f71, 0x54cd)));
    expect(impactLine).toBe(`${han(0x5f71, 0x54cd, 0xff1a)}Medium${han(0xff1b, 0x529f, 0x80fd, 0xff1a)}Orders (F1)${han(0x3001)}Archive (F2)${han(0xff08)}\`src/forms/order-form.js:7\`; \`src/forms/order-form.js:8\`${han(0xff09, 0x3002)}`);
    const checked = run.check('review');
    expect(checked.status, checked.stdout).toBe(0);
  });

  it('a counts table row without a citation is exempt only under the counts heading', () => {
    const run = ready([]);
    run.render();
    const path = join(run.out, 'chapters', 'review.md');
    writeFileSync(path, `${readFileSync(path, 'utf-8')}\n## Other\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n`);
    const checked = run.check('review');
    expect(checked.status).toBe(1);
    expect(checked.stdout).toMatch(/a fact without a citation: \| 1 \| 2 \|/);
  });
});
