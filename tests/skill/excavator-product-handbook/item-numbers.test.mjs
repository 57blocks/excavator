// openspec change handbook-process-review, task 1.1 (design D2): defects are D1..Dn in the order of the defects chapter,
// design problems are R1..Rn in the order of the rendered design-problems chapter, and check, assemble and the page data
// all read them from one place, so a number means the same item everywhere.
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { numberDefects } from '../../../skills/excavator-product-handbook/lib/chapter-render.mjs';
import { runHandbook } from './helpers.mjs';
import { STUB, dataOf, html, runPage } from './page-md-fixture.mjs';
import { ITEMS, numberedRun, renderReview } from './numbers-fixture.mjs';
import { FORM, cite } from './md-run-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});
const stub = mkdtempSync(join(tmpdir(), 'xhb-numbers-'));
const template = join(stub, 'template.html');
writeFileSync(template, STUB);
afterAll(() => rmSync(stub, { recursive: true, force: true }));

describe('numbers: one source', () => {
  it('the review chapter writes R<n> in each level-3 heading, in the order of the list', () => {
    const run = numberedRun(cleanups);
    const text = run.read('chapters/review.md');
    expect([...text.matchAll(/^### (R\d+) (.+)$/gm)].map((m) => `${m[1]} ${m[2]}`)).toEqual(['R1 Two places end an order', 'R2 Sending takes many steps', 'R3 A reminder cannot be stopped']);
  });

  it('check, assemble and the page data give the same numbers to the same items', () => {
    const run = numberedRun(cleanups);
    // check: a remedies chapter naming D3 with D3's own citation passes, with D2's citation it does not
    const chapter = (cites) => `# Remedies

## Measures across processes

None.

## Defect fixes

- **security** Move the secret out [D1] (${cite('5')}).
- **display** Show the button and speed up the archive [D2, D3] (${cite(cites)}).

## To simplify and unify

1. **Unify the rule** Close an order in one place [R1] (${cite('7')}; ${cite('8')}).

## To fix

1. **Fix** Show the late archive [D3] (${cite(cites)}).
`;
    run.write('remedies', chapter('8'));
    expect(run.check('remedies').status, run.check('remedies').stdout).toBe(0);
    run.write('remedies', chapter('9'));
    const wrong = run.check('remedies');
    expect(wrong.status).toBe(1);
    expect(wrong.stdout).toContain(`the citation \`${FORM}:9\` is not one of the citations of D2, D3`);
    // assemble: D<n> stands before the bold short title of the n-th defect; the file is unchanged
    const before = readFileSync(join(run.out, 'chapters', 'defects.md'), 'utf-8');
    run.write('remedies', chapter('8'));
    run.check('remedies');
    expect(run.assemble('--views', 'product,technical').status).toBe(0);
    const book = run.read('handbook.md');
    expect(book).toContain('- **security** D1 **Secret in code** A secret is stored in the code, Orders (F1).');
    expect(book).toContain('- **display** D2 **Hidden button**');
    expect(book).toContain('- **display** D3 **Late archive**');
    expect(run.read('chapters/defects.md')).toBe(before);
    expect(run.read('handbook-technical.md')).toContain(`- **display** D3 **Late archive** The archive page lags, Archive (F2) (${cite('8')}).`);
    // page data: row d3 is that defect and row r2 is the item headed R2
    expect(runPage(run, { template }).status).toBe(0);
    const rows = dataOf(html(run)).problems.rows;
    const d3 = rows.find((row) => row.id === 'd3');
    expect(d3.summary).toBe('Late archive');
    const r2 = rows.find((row) => row.id === 'r2');
    expect(r2.summary).toBe('Sending takes many steps');
    expect(run.read('chapters/review.md').split('\n')[r2.source.line - 1]).toBe('### R2 Sending takes many steps');
    // and the same lines through the CLI table
    expect(runHandbook(['remedies-inputs', run.out]).lines).toContain('DEFECT D3 P1 display F2 Late archive');
  });

  it('after one design problem is removed and the chapter rendered again the R numbers are contiguous', () => {
    const run = numberedRun(cleanups);
    renderReview(run, { b1: [ITEMS.b1[0]], b2: ITEMS.b2 });
    const lines = runHandbook(['remedies-inputs', run.out]).lines.filter((line) => line.startsWith('DESIGN'));
    expect(lines).toEqual(['DESIGN R1 medium duplication F1,F2 Two places end an order', 'DESIGN R2 low dead-end F3 A reminder cannot be stopped']);
  });

  it('numberDefects puts the number after the bold category of an item without a short title and moves no line', () => {
    const text = '# Defects\n\n## P0\n\n- **security** A secret is stored, Orders (F1).\n- **display** **Hidden** A button.\n';
    const items = [{ n: 1, line: 5, item: { title: null } }, { n: 2, line: 6, item: { title: 'Hidden' } }];
    expect(numberDefects(text, items)).toBe('# Defects\n\n## P0\n\n- **security** D1 A secret is stored, Orders (F1).\n- **display** D2 **Hidden** A button.\n');
  });
});
