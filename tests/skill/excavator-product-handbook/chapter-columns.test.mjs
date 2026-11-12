// A chapter table column whose every data cell is empty once the citations are removed is not shown in the product view (handbook.md and
// the page blocks); the technical view of handbook.md keeps it, with its citations. A column with any text stays.
import { afterEach, describe, expect, it } from 'vitest';

import { chapterPageBlocks, productChapter } from '../../../skills/excavator-product-handbook/lib/chapter-output.mjs';
import { renderChapter } from '../../../skills/excavator-product-handbook/lib/chapter-render.mjs';
import { GOOD_ARCH_CHAPTER, archRun } from './architecture-fixture.mjs';

const CITE = '`src/roles.js:1`';
const CHAPTER = `# Roles

| Role | Can do | Evidence |
| --- | --- | --- |
| Clerk | Creates an order | ${CITE} |
| Approver | Approves an order | ${CITE} |

<!-- no-diagram: none -->
`;
const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

describe('empty chapter table columns', () => {
  it('are dropped in the product text, header and separator with them', () => {
    const text = productChapter(CHAPTER);
    expect(text).toContain('| Role | Can do |');
    expect(text).toContain('| --- | --- |');
    expect(text).toContain('| Clerk | Creates an order |');
    expect(text).not.toContain('Evidence');
    expect(text).not.toContain('src/roles.js');
  });

  it('are dropped in the page blocks', () => {
    const table = chapterPageBlocks(CHAPTER).find((block) => block.kind === 'table');
    expect(table.header).toEqual(['Role', 'Can do']);
    expect(table.rows).toEqual([['Clerk', 'Creates an order'], ['Approver', 'Approves an order']]);
  });

  it('stay in the technical text, which is the chapter as written', () => {
    const text = renderChapter(CHAPTER, []);
    expect(text).toContain('| Role | Can do | Evidence |');
    expect(text).toContain(CITE);
  });

  it('stay when one cell has text, and a table with no empty column is as it was', () => {
    const mixed = CHAPTER.replace(`| Approver | Approves an order | ${CITE} |`, `| Approver | Approves an order | Reviewed ${CITE} |`);
    expect(productChapter(mixed)).toContain('| Role | Can do | Evidence |');
    expect(productChapter(mixed)).toContain('| Approver | Approves an order | Reviewed |');
  });

  it('stay in the technical view of the architecture chapter in handbook-technical.md', () => {
    const run = archRun({ write: false });
    cleanups.push(run.cleanup);
    run.writeDomains();
    run.writeArch();
    run.writeChapter(GOOD_ARCH_CHAPTER.replace('<!-- no-diagram', `| Application | Role | Evidence |\n| --- | --- | --- |\n| Web | Browser client | \`apps/web/package.json:1\` |\n\n<!-- no-diagram`));
    expect(run.strict('check-architecture').status).toBe(0);
    expect(run.strict('assemble', '--views', 'product,technical').status).toBe(0);
    const technical = require_read(run, 'handbook-technical.md');
    expect(technical).toContain('| Application | Role | Evidence |');
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
function require_read(run, name) {
  return readFileSync(join(run.out, name), 'utf-8');
}
