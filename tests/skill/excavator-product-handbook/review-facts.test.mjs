// openspec change handbook-design-review, task 2.1: `review facts` counts what each feature chapter holds
// (operations, steps, states, transitions, server-side steps, hand-overs) with the run's fixed headings, names a
// section it does not recognize, lists the pairs of features that cite overlapping lines of one file, and writes
// the batch list that the writers' prompts and `review render` share.
import { afterEach, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { chapterText, cite } from './md-run-fixture.mjs';
import { SHARED_LIMIT, sharedCodePairs } from '../../../skills/excavator-product-handbook/lib/review-facts.mjs';
import { FEATURE_CHAPTERS, reviewRun } from './review-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

describe('review facts', () => {
  it('counts operations, steps, states, transitions, server-side steps and hand-overs of a feature chapter', () => {
    const run = reviewRun(cleanups);
    const result = run.facts();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const f1 = run.readFacts().features.F1;
    expect(f1).toMatchObject({ chapter: true, operations: 2, steps: [4, 1], states: 3, transitions: 3, serverSteps: 1, handovers: 1, uncounted: [] });
    expect(run.readFacts().features.F2).toMatchObject({ operations: 1, steps: [2], states: 0, transitions: 0, serverSteps: 0, handovers: 0 });
    expect(result.lines).toContain('FEATURE\tF1\tOrders\tbatch=b1\toperations=2\tsteps=4,1\tstates=3\ttransitions=3\tserverSteps=1\thandovers=1');
  });

  it('a chapter with an old heading is not counted for that section and the heading is named', () => {
    const old = FEATURE_CHAPTERS.F2.replace('## Operations', '## Actions');
    const run = reviewRun(cleanups, { extra: { F2: old } });
    const result = run.facts();
    expect(result.status).toBe(0);
    const f2 = run.readFacts().features.F2;
    expect(f2.operations).toBe(0);
    expect(f2.steps).toEqual([]);
    expect(f2.uncounted).toEqual(['Actions']);
    expect(result.lines.find((line) => line.startsWith('FEATURE\tF2'))).toContain('not counted: Actions');
  });

  it('steps outside an operation heading are named, not counted', () => {
    const loose = FEATURE_CHAPTERS.F2.replace('### Archive an order\n\n', '');
    const run = reviewRun(cleanups, { extra: { F2: loose } });
    run.facts();
    const f2 = run.readFacts().features.F2;
    expect(f2.operations).toBe(0);
    expect(f2.uncounted).toEqual(['Operations: 2 list items outside a level-3 operation heading']);
  });

  it('lists one pair for two features that cite overlapping lines, with the intersecting range, and none for disjoint lines', () => {
    const run = reviewRun(cleanups);
    run.facts();
    const { pairs } = run.readFacts();
    expect(pairs.find((pair) => pair.features.join() === 'F1,F5')).toMatchObject({ files: [{ file: 'src/roles.js', ranges: [[2, 2]] }], scope: 'across', batches: ['b1', 'b2'] });
    expect(pairs.find((pair) => pair.features.join() === 'F1,F4')).toMatchObject({ files: [{ file: 'src/menu.js', ranges: [[4, 4]] }] });
    expect(pairs.some((pair) => pair.features.includes('F2') && pair.features.includes('F3'))).toBe(false);
    expect(pairs.length).toBe(2);
  });

  it('a file cited by more than 3 features makes no pair, is counted as shared, and is listed in the JSON only', () => {
    const run = reviewRun(cleanups);
    const result = run.facts();
    const { shared, pairs } = run.readFacts();
    expect(shared).toEqual({ limit: 3, files: 1, list: [{ file: 'src/forms/order-form.js', features: 5 }] });
    expect(pairs.every((pair) => pair.files.every((entry) => entry.file !== 'src/forms/order-form.js'))).toBe(true);
    expect(result.lines).toContain('Shared files (cited by more than 3 features, left out of the pairs): 1');
    expect(result.stdout).not.toContain('order-form.js\t');
    expect(result.lines.filter((line) => line.startsWith('PAIR'))).toEqual(['PAIR\tacross\tF1,F4\tsrc/menu.js:4', 'PAIR\tacross\tF1,F5\tsrc/roles.js:2']);
  });

  it('two features that share two files give one PAIR line with both files', () => {
    const both = FEATURE_CHAPTERS.F5.replace('`src/roles.js:2-3`', '`src/roles.js:2-3`; `src/menu.js:4-5`');
    const run = reviewRun(cleanups, { extra: { F5: both } });
    const result = run.facts();
    const lines = result.lines.filter((line) => line.startsWith('PAIR\tacross\tF1,F5'));
    expect(lines).toEqual(['PAIR\tacross\tF1,F5\tsrc/menu.js:4; src/roles.js:2']);
    expect(run.readFacts().pairs.find((pair) => pair.features.join() === 'F1,F5').files.map((entry) => entry.file)).toEqual(['src/menu.js', 'src/roles.js']);
  });

  it('a pair inside one batch is within; the batch name limits the printed pairs', () => {
    const run = reviewRun(cleanups);
    const all = run.facts();
    expect(all.lines.filter((line) => line.startsWith('PAIR')).length).toBeGreaterThan(0);
    const b1 = run.facts('b1');
    const pairLines = b1.lines.filter((line) => line.startsWith('PAIR'));
    expect(pairLines.every((line) => /\bF1\b|\bF2\b/.test(line.split('\t')[2]))).toBe(true);
    expect(b1.lines.filter((line) => line.startsWith('FEATURE')).length).toBe(5);
    const same = run.readFacts().pairs.filter((pair) => pair.scope === 'within');
    expect(same.every((pair) => pair.batches[0] === pair.batches[1])).toBe(true);
    expect(run.facts('b9').status).toBe(1);
  });

  it('batches follow the areas of the map, then cross, and are written to the facts file', () => {
    const run = reviewRun(cleanups);
    const result = run.facts();
    const { batches, source } = run.readFacts();
    expect(source).toBe('areas');
    expect(batches).toEqual([
      { id: 'b1', name: 'Order handling', features: ['F1', 'F2'] },
      { id: 'b2', name: 'Automatic work', features: ['F3', 'F4', 'F5'] },
      { id: 'cross', name: 'cross', features: [] },
    ]);
    expect(result.lines.slice(0, 4)).toEqual(['Batches: 2 (source: areas), then cross', 'BATCH\tb1\tOrder handling\tF1,F2', 'BATCH\tb2\tAutomatic work\tF3,F4,F5', 'BATCH\tcross\tcross\t']);
  });

  it('batches follow domains.json when the domains chapter passed', () => {
    const text = `${chapterText('Domains')}\n## Archive\n\n- Archived orders stay readable (${cite('9')}).\n`;
    const run = reviewRun(cleanups, { extra: { domains: text } });
    run.writeJson(join(run.out, 'domains.json'), { domains: [{ name: 'Operations', features: ['F1', 'F3'] }, { name: 'Archive', features: ['F2', 'F4', 'F5'] }], handovers: [] });
    run.check('domains');
    run.facts();
    const { batches, source } = run.readFacts();
    expect(source).toBe('domains');
    expect(batches.map((batch) => [batch.id, batch.name, batch.features])).toEqual([['b1', 'Operations', ['F1', 'F3']], ['b2', 'Archive', ['F2', 'F4', 'F5']], ['cross', 'cross', []]]);
  });

  it('a domains chapter that did not pass is not used', () => {
    const run = reviewRun(cleanups, { extra: { domains: chapterText('Domains').replace('(`src/forms/order-form.js:5`)', '') } });
    writeFileSync(join(run.out, 'domains.json'), '{"domains":[{"name":"X","features":["F1"]}],"handovers":[]}');
    run.check('domains');
    run.check('domains');
    run.facts();
    expect(run.readFacts().source).toBe('areas');
  });

  it('says there is no map, and writes nothing', () => {
    const run = reviewRun(cleanups);
    writeFileSync(join(run.out, 'map.json'), '{}');
    const result = run.facts();
    expect(result.status).toBe(1);
    expect(result.lines).toEqual(['map.json is missing or has no features; write and check the map first']);
  });

  it('a feature without a chapter is listed as missing', () => {
    const run = reviewRun(cleanups);
    writeFileSync(join(run.out, 'chapters', 'F3.md'), '');
    const empty = run.facts();
    expect(empty.status).toBe(0);
    const f3 = run.readFacts().features.F3;
    expect(f3.operations).toBe(0);
  });
});

describe('sharedCodePairs: the shared-code limit', () => {
  const cite = (file, a, b = a) => ({ file, a, b });
  const order = ['F1', 'F2', 'F3', 'F4'];

  it('the limit is 3: a file cited by exactly 3 features makes pairs, by 4 makes none and is counted', () => {
    expect(SHARED_LIMIT).toBe(3);
    const three = new Map([['F1', [cite('a.js', 1, 5)]], ['F2', [cite('a.js', 2, 6)]], ['F3', [cite('a.js', 3, 4)]]]);
    const found = sharedCodePairs(three, order);
    expect(found.shared).toEqual([]);
    expect(found.pairs.map((pair) => pair.features.join())).toEqual(['F1,F2', 'F1,F3', 'F2,F3']);
    const four = new Map([...three, ['F4', [cite('a.js', 1, 9)]]]);
    expect(sharedCodePairs(four, order)).toEqual({ pairs: [], shared: [{ file: 'a.js', features: 4 }] });
  });

  it('counts the features that cite the file at all, even in disjoint ranges', () => {
    const disjoint = new Map([['F1', [cite('a.js', 1)]], ['F2', [cite('a.js', 10)]], ['F3', [cite('a.js', 20)]], ['F4', [cite('a.js', 30)], ]]);
    expect(sharedCodePairs(disjoint, order).shared).toEqual([{ file: 'a.js', features: 4 }]);
  });

  it('one pair for two features with every file they share, ranges merged', () => {
    const map = new Map([['F1', [cite('a.js', 1, 3), cite('b.js', 5), cite('a.js', 3, 6)]], ['F2', [cite('a.js', 2, 4), cite('b.js', 5)]]]);
    expect(sharedCodePairs(map, order).pairs).toEqual([{ features: ['F1', 'F2'], files: [{ file: 'a.js', ranges: [[2, 4]] }, { file: 'b.js', ranges: [[5, 5]] }] }]);
  });
});
