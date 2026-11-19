// Regression: the numbers of the design problems include the items of comparison batches. The review chapter is
// rendered from the domain batches and the comparison batches, so the numbering must load both.
import { afterEach, describe, expect, it } from 'vitest';

import { diskChapters, itemNumbers, readMapOrNull } from '../../../skills/excavator-product-handbook/lib/item-numbers.mjs';
import { loadStateV2 } from '../../../skills/excavator-product-handbook/lib/state-v2.mjs';
import { loadUi } from '../../../skills/excavator-product-handbook/lib/ui.mjs';
import { runHandbook } from './helpers.mjs';
import { FORM } from './md-run-fixture.mjs';
import { goodItem, reviewRun, writeCompare } from './review-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

describe('numbers of a run with a comparison batch', () => {
  it('numbers the item of a comparison batch, in state ok, and prints it in remedies-inputs', () => {
    const run = reviewRun(cleanups);
    run.facts();
    writeCompare(run, [{ id: 'X1', source: 'dict', features: ['F1', 'F2'], batch: 'c-data-1' }]);
    run.writeBatch('b1', []);
    run.writeBatch('b2', []);
    run.writeBatch('c-data-1', [goodItem({ title: 'Two dictionaries differ', candidates: ['X1'], cites: [`${FORM}:7`, `${FORM}:8`] })]);
    const rendered = run.render();
    expect(rendered.status, rendered.stdout).toBe(0);
    expect(run.check('review').status).toBe(0);

    const state = loadStateV2(run.out).state;
    const numbers = itemNumbers({ outDir: run.out, map: readMapOrNull(run.out), chapters: diskChapters(run.out, ['defects', 'review', 'processes'], state), strings: loadUi(run.out).strings });
    expect(numbers.design.state).toBe('ok');
    expect(numbers.design.items.map((item) => `${item.id} ${item.title}`)).toEqual(['R1 Two dictionaries differ']);

    const inputs = runHandbook(['remedies-inputs', run.out]).lines;
    expect(inputs).toContain('DESIGN R1 medium duplication F1,F2 Two dictionaries differ');
  });
});
