// Design D1 of openspec change handbook-feature-page: a feature chapter's level-2 headings are the fixed nine, in the
// fixed order, enforced by `check` while a chapter is written. A chapter already recorded as passed is never linted
// again by assemble or page, so a run written under the old wording still assembles and pages.
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { chapterText, newMdRun } from './md-run-fixture.mjs';
import { STUB, html, runPage } from './page-md-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});
const stubDir = mkdtempSync(join(tmpdir(), 'xhb-fixed-'));
const stubPath = join(stubDir, 'template.html');
writeFileSync(stubPath, STUB);
afterAll(() => rmSync(stubDir, { recursive: true, force: true }));

const ORDER = 'Overview, Pages, Operations, Rules, States, Notifications and automatic behavior, Hand-overs, Open questions, Problems';
const make = (chapters = {}) => {
  const run = newMdRun(chapters, { check: false });
  cleanups.push(run.cleanup);
  return run;
};
const checked = (text, name = 'F1') => {
  const run = make();
  run.write(name, text);
  return { run, result: run.check(name) };
};

describe('feature chapter headings', () => {
  it('accepts the fixed headings in order, with any of the first seven left out', () => {
    expect(checked(chapterText()).result.status).toBe(0);
    const full = chapterText().replace('## Operations', '## Overview\n\nOrders are placed by clerks (`src/forms/order-form.js:5`).\n\n## Pages\n\n- The order form (`src/forms/order-form.js:5`)\n\n## Operations')
      .replace('## Open questions', '## Rules\n\n- A draft is kept (`src/forms/order-form.js:10`)\n\n## Open questions');
    const outcome = checked(full);
    expect(outcome.result.status, outcome.result.stdout).toBe(0);
  });

  it('refuses a near-synonym and names it', () => {
    const { result } = checked(chapterText().replace('## Operations', '## Screens'));
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('a level-2 heading that is not one of the fixed headings: Screens');
  });

  it('refuses a heading out of order and prints the order', () => {
    const text = chapterText().replace('## Open questions', '## Rules\n\n- A draft is kept (`src/forms/order-form.js:10`)\n\n## Overview\n\nOrders are placed (`src/forms/order-form.js:5`).\n\n## Open questions');
    const { result } = checked(text);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(`the level-2 heading "Overview" is out of order; the order is: ${ORDER}`);
  });

  it('does not count level-3 headings or a heading inside a fence', () => {
    const text = chapterText().replace('## Open questions', '### Placing an order\n\n```text\n## Not a heading\n```\n\n## Open questions');
    expect(checked(text).result.status).toBe(0);
  });

  it('leaves the system chapter and the cross chapters free', () => {
    const odd = chapterText('System').replace('## Operations', '## How the parts connect');
    expect(checked(odd, 'system').result.status).toBe(0);
    expect(checked(odd, 'topics').result.status).toBe(0);
  });
});

describe('a run recorded under the old headings', () => {
  it('still assembles and pages: only check lints, assemble and page read the record', () => {
    const run = make({ system: chapterText('System') });
    run.write('F1', chapterText('Orders'));
    expect(run.check('system', 'F1').status).toBe(0);
    // The chapter was recorded as passed; now its file carries the old wording, as a run written before this change does.
    const old = chapterText('Orders').replace('## Operations', '## Placing an order');
    run.write('F1', old);
    const state = JSON.parse(run.read('state.json'));
    state.chapters.F1.sha256 = createHash('sha256').update(old).digest('hex');
    writeFileSync(join(run.out, 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
    expect(run.check('F1').status).toBe(1);
    const assembled = run.assemble();
    expect(assembled.status, assembled.stdout + assembled.stderr).toBe(0);
    expect(run.read('handbook.md')).toContain('Placing an order');
    const paged = runPage(run, { template: stubPath });
    expect(paged.status, paged.stdout + paged.stderr).toBe(0);
    expect(html(run)).toContain('Placing an order');
  });
});
