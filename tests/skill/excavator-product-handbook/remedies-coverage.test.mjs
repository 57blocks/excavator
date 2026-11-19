// openspec change handbook-process-review, task 1.4 (design D11): the high-impact design problems and the P0 defects that no
// list item of the remedies chapter names are listed by the script in a generated section at the end of the remedies chapter,
// in both views of handbook.md and in the page data; the chapter file is not changed.
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { cite } from './md-run-fixture.mjs';
import { numberedRun } from './numbers-fixture.mjs';
import { STUB, dataOf, html, runPage } from './page-md-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});
const stub = mkdtempSync(join(tmpdir(), 'xhb-coverage-'));
const template = join(stub, 'template.html');
writeFileSync(template, STUB);
afterAll(() => rmSync(stub, { recursive: true, force: true }));

const FIX_CITES = { D1: '5', D2: '6' };
const UNIFY_CITES = { R1: '7', R2: '6' };
const citesOf = (ids, table) => ids.split(', ').map((id) => cite(table[id])).join('; ');

/** A remedies chapter naming `fixes` (D ids of the fix list) and `unify` (R ids of the simplify list); every category has an item. */
const remedies = ({ fixes, unify }) => `# Remedies

## Measures across processes

None.

## Defect fixes

- **security** Move the secret out [D1] (${cite('5')}).
- **display** Speed up the archive [D3] (${cite('8')}).

## To simplify and unify

${unify === null ? 'None.' : `1. **Unify the rule** Close an order in one place [${unify}] (${citesOf(unify, UNIFY_CITES)}).`}

## To fix

1. **Fix** Fix these [${fixes}] (${citesOf(fixes, FIX_CITES)}).
`;

function assembled(run, text) {
  run.write('remedies', text);
  expect(run.check('remedies').status).toBe(0);
  expect(run.assemble('--views', 'product,technical').status).toBe(0);
  return { product: run.read('handbook.md'), technical: run.read('handbook-technical.md') };
}

describe('the section of problems no measure addresses', () => {
  it('lists the P0 defects and the high design problems no item names, defects first, in both views and on the page', () => {
    const run = numberedRun(cleanups);
    const text = remedies({ fixes: 'D1', unify: 'R1' });
    const books = assembled(run, text);
    for (const book of Object.values(books)) {
      expect(book).toContain('### Problems no measure addresses\n\n- D2 Hidden button\n- R2 Sending takes many steps\n');
      expect(book).not.toContain('Every high-impact design problem');
    }
    expect(run.read('chapters/remedies.md')).toBe(text);
    expect(runPage(run, { template }).status).toBe(0);
    const chapter = dataOf(html(run)).chapters.find((entry) => entry.id === 'remedies');
    expect(chapter.texts.product).toMatch(/\n## Problems no measure addresses\n\n- D2 Hidden button\n- R2 Sending takes many steps$/);
  });

  it('says that none is left when every one is named', () => {
    const run = numberedRun(cleanups);
    const books = assembled(run, remedies({ fixes: 'D1, D2', unify: 'R2' }));
    expect(books.product).toContain('### Problems no measure addresses\n\nEvery high-impact design problem and every P0 defect is addressed by a measure.\n');
    expect(books.product).not.toContain('- D2 ');
  });

  it('without the design problems chapter lists only the defects and says why', () => {
    const run = numberedRun(cleanups, { review: false });
    const none = remedies({ fixes: 'D1', unify: null });
    const books = assembled(run, none);
    expect(books.product).toContain('### Problems no measure addresses\n\n- D2 Hidden button\n\nThe design problems are not written, so only the defects are listed.\n');
  });

  it('writes nothing when the remedies chapter is missing', () => {
    const run = numberedRun(cleanups);
    expect(run.assemble('--views', 'product,technical').status).toBe(0);
    expect(readFileSync(join(run.out, 'handbook.md'), 'utf-8')).not.toContain('Problems no measure addresses');
  });
});

describe('the check tells the writer which items no measure names', () => {
  it('prints the two Not named lines for a passing chapter and still passes', () => {
    const run = numberedRun(cleanups);
    run.write('remedies', remedies({ fixes: 'D1', unify: 'R1' }));
    const result = run.check('remedies');
    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).toContain('chapters/remedies.md: passed\n  Not named: 1 high design problems: R2\n  Not named: 1 P0 defects: D2\n');
    expect(result.stdout.match(/Not named:/g)).toHaveLength(2);
  });

  it('prints no Not named line when every item is named', () => {
    const run = numberedRun(cleanups);
    run.write('remedies', remedies({ fixes: 'D1, D2', unify: 'R2' }));
    const result = run.check('remedies');
    expect(result.status, result.stdout).toBe(0);
    expect(result.stdout).not.toContain('Not named:');
  });
});
