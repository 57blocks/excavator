// openspec change handbook-design-review, task 4.2: the check records with a passed remedies chapter a digest of the
// defects and design-problems chapters it read, and `remedies-state` calls a passed chapter stale when either changed,
// or when the design problems appeared after a chapter that never read them (the way the domains chapter's digest works).
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { runHandbook } from './helpers.mjs';
import { DEFECTS_ONE, chapterText, newMdRun, remediesText } from './md-run-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

function make(chapters) {
  const run = newMdRun(chapters);
  cleanups.push(run.cleanup);
  run.state = () => runHandbook(['remedies-state', run.out]).lines;
  run.record = () => JSON.parse(readFileSync(join(run.out, 'state.json'), 'utf-8')).chapters.remedies;
  return run;
}

describe('remedies inputs', () => {
  it('records the digest with a passed remedies chapter, and none with a failed one', () => {
    const run = make({ defects: DEFECTS_ONE, remedies: remediesText() });
    expect(run.record()).toMatchObject({ status: 'passed' });
    expect(run.record().inputs).toMatch(/^[0-9a-f]{64}$/);
    const bad = make({ defects: DEFECTS_ONE, remedies: remediesText().replace('`src/forms/order-form.js:5`', '`src/forms/order-form.js:99`') });
    expect(bad.record().status).toBe('failed');
    expect(bad.record().inputs).toBeUndefined();
  });

  it('reports the state, and is not stale while neither chapter changed', () => {
    const run = make({ defects: DEFECTS_ONE, remedies: remediesText() });
    expect(run.state()).toEqual(['STATUS=passed', 'ATTEMPTS=1', 'FILE=yes', 'STALE=no']);
    const none = make({ defects: DEFECTS_ONE });
    expect(none.state()).toEqual(['STATUS=none', 'ATTEMPTS=0', 'FILE=no', 'STALE=no']);
  });

  it('is stale when the design problems are written after a passed remedies chapter, and stays so until it is written again', () => {
    const run = make({ defects: DEFECTS_ONE, remedies: remediesText() });
    const before = run.record().inputs;
    run.write('review', chapterText('Design problems'));
    run.check('review');
    expect(run.state()[3]).toBe('STALE=yes');
    run.write('remedies', remediesText(' Soon.'));
    expect(run.check('remedies').status).toBe(0);
    expect(run.record().inputs).not.toBe(before);
    expect(run.state()[3]).toBe('STALE=no');
  });

  it('a stale chapter written again starts at attempt 1, so a failed rewrite still gets its second attempt', () => {
    const run = make({ defects: DEFECTS_ONE, remedies: remediesText() });
    run.write('review', chapterText('Design problems'));
    run.check('review');
    run.write('remedies', remediesText().replace('`src/forms/order-form.js:5`', '`src/forms/order-form.js:99`'));
    expect(run.check('remedies').status).toBe(1);
    expect(run.record()).toMatchObject({ status: 'failed', attempts: 1 });
    run.write('remedies', remediesText().replace('`src/forms/order-form.js:5`', '`src/forms/order-form.js:98`'));
    run.check('remedies');
    expect(run.record()).toMatchObject({ status: 'failed', attempts: 2 });
  });

  it('is stale when the defects chapter or the review chapter changes', () => {
    const run = make({ defects: DEFECTS_ONE, review: chapterText('Design problems'), remedies: remediesText() });
    expect(run.state()[3]).toBe('STALE=no');
    run.write('review', `${chapterText('Design problems')}\nAnother (\`src/forms/order-form.js:7\`).\n`);
    expect(run.state()[3]).toBe('STALE=yes');
    const second = make({ defects: DEFECTS_ONE, remedies: remediesText() });
    second.write('defects', `${DEFECTS_ONE}\nAnother (\`src/forms/order-form.js:7\`).\n`);
    expect(second.state()[3]).toBe('STALE=yes');
  });

  it('a passed record with no digest is stale only when a review chapter exists', () => {
    const run = make({ defects: DEFECTS_ONE, remedies: remediesText() });
    const path = join(run.out, 'state.json');
    const state = JSON.parse(readFileSync(path, 'utf-8'));
    delete state.chapters.remedies.inputs;
    run.writeJson(path, state);
    expect(run.state()[3]).toBe('STALE=no');
    run.write('review', chapterText('Design problems'));
    expect(run.state()[3]).toBe('STALE=yes');
  });

  it('refuses a state.json of another format', () => {
    const run = make({ defects: DEFECTS_ONE });
    run.writeJson(join(run.out, 'state.json'), { format: 'excavator-product-handbook-state/1', chapters: {} });
    const result = runHandbook(['remedies-state', run.out]);
    expect(result.status).toBe(1);
  });
});
