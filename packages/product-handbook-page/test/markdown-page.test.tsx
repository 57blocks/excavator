// @vitest-environment happy-dom
// O4 of openspec change handbook-skill-first, the content half: a chapter's Markdown is the page. A table is a table with its
// cells, a list is a list, a mermaid fence is drawn by mermaid, one that cannot be drawn shows its source and the fixed note
// without breaking the page, a citation in inline code is a chip with the file and the lines (and other inline code stays code),
// and raw HTML in a chapter is not rendered. Mermaid itself is mocked: the page's use of it is under test, not its drawing.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppView } from '../src/App';
import { parseHash } from '../src/lib/route';
import type { PageData, View } from '../src/lib/types';
import { cleanup, mount, settle } from './dom';
import { MARK, d, marked, pageData, shipped } from './page-fixture';

const mermaid = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn() }));
vi.mock('mermaid', () => ({ default: mermaid }));

beforeEach(() => {
  mermaid.initialize.mockReset();
  mermaid.render.mockReset();
  mermaid.render.mockImplementation(async (id: string, source: string) => {
    if (source.includes('BROKEN')) throw new Error('Parse error on line 2');
    return { svg: `<svg data-id="${id}"><text>${source.split('\n')[0]}</text></svg>` };
  });
});
afterEach(cleanup);

const CHAPTER = (extra: string): string => `# ${d('Orders')}\n\n${d('Intro words.')}\n\n${extra}`;
const withText = (text: Partial<Record<View, string>>): PageData => pageData({ chapters: [{ id: 'F1', texts: text }, { id: 'system', texts: { product: `# ${d('S')}\n`, technical: `# ${d('S')}\n` } }, { id: 'F2', texts: { product: `# ${d('R')}\n`, technical: `# ${d('R')}\n` } }] });
const show = (data: PageData, hash: string): HTMLElement => mount(<AppView data={data} route={parseHash(hash)} />);
const settled = async (data: PageData, hash: string): Promise<HTMLElement> => {
  const host = show(data, hash);
  await settle();
  await settle();
  return host;
};

const TABLE = `| ${d('Role')} | ${d('Can do')} |\n| --- | --- |\n| ${d('Clerk')} | ${d('Creates an order')} |\n| ${d('Approver')} | ${d('Sends it')} |\n`;

describe('tables and lists', () => {
  it('a Markdown table is a table with its head and cells, inside a box that scrolls', async () => {
    const host = await settled(withText({ product: CHAPTER(TABLE), technical: CHAPTER(TABLE) }), '#/product/chapter/F1');
    const table = host.querySelector('.prose table') as HTMLTableElement;
    expect(table).not.toBeNull();
    expect(Array.from(table.querySelectorAll('thead th')).map((cell) => cell.textContent)).toEqual([d('Role'), d('Can do')]);
    expect(Array.from(table.querySelectorAll('tbody tr')).map((row) => Array.from(row.children).map((cell) => cell.textContent))).toEqual([[d('Clerk'), d('Creates an order')], [d('Approver'), d('Sends it')]]);
    expect(table.parentElement?.classList.contains('table-scroll')).toBe(true);
  });

  it('a list is a list: bullets and numbers, with nested items', async () => {
    const text = CHAPTER(`- ${d('first')}\n- ${d('second')}\n  - ${d('inner')}\n\n1. ${d('one')}\n2. ${d('two')}\n`);
    const host = await settled(withText({ product: text, technical: text }), '#/product/chapter/F1');
    expect(Array.from(host.querySelectorAll('.prose > ul > li')).map((item) => item.firstChild?.textContent?.trim())).toEqual([d('first'), d('second')]);
    expect(host.querySelectorAll('.prose ul ul li')).toHaveLength(1);
    expect(Array.from(host.querySelectorAll('.prose ol > li')).map((item) => item.textContent)).toEqual([d('one'), d('two')]);
  });

  it('the chapter heading is the heading of the page', async () => {
    const host = await settled(withText({ product: CHAPTER(''), technical: CHAPTER('') }), '#/product/chapter/F1');
    expect(host.querySelectorAll('h1')).toHaveLength(1);
    expect(host.querySelector('h1')?.textContent).toBe(d('Orders'));
  });
});

describe('diagrams', () => {
  const flow = '```mermaid\nflowchart TD\n  A --> B\n```\n';
  const state = '```mermaid\nstateDiagram-v2\n  [*] --> Draft\n```\n';

  it('a flowchart and a state diagram are handed to mermaid and the drawing is shown', async () => {
    const text = CHAPTER(`${flow}\n${state}`);
    const host = await settled(withText({ product: text, technical: text }), '#/product/chapter/F1');
    expect(mermaid.render).toHaveBeenCalledTimes(2);
    expect(mermaid.render.mock.calls.map((call) => String(call[1]).split('\n')[0])).toEqual(['flowchart TD', 'stateDiagram-v2']);
    const drawn = host.querySelectorAll('[data-diagram="done"] svg');
    expect(drawn).toHaveLength(2);
    expect(host.querySelector('pre')).toBeNull();
  });

  it('a fence that cannot be drawn shows its source as text with the fixed note, and the rest of the page stays', async () => {
    const text = CHAPTER(`\`\`\`mermaid\nflowchart TD\n  A[BROKEN --> \n\`\`\`\n\n${d('After the diagram.')}\n`);
    const host = await settled(withText({ product: text, technical: text }), '#/product/chapter/F1');
    const failed = host.querySelector('[data-diagram="failed"]') as HTMLElement;
    expect(failed).not.toBeNull();
    expect(failed.querySelector('pre code')?.textContent).toBe('flowchart TD\n  A[BROKEN --> ');
    expect(failed.textContent).toContain(`${MARK}${shipped.strings['page.diagram.failed']}`);
    expect(host.textContent).toContain(d('Intro words.'));
    expect(host.textContent).toContain(d('After the diagram.'));
    expect(host.querySelector('.rail')).not.toBeNull();
  });

  it('a good diagram next to a broken one still draws', async () => {
    const text = CHAPTER(`\`\`\`mermaid\nflowchart TD\n  BROKEN\n\`\`\`\n\n${flow}`);
    const host = await settled(withText({ product: text, technical: text }), '#/product/chapter/F1');
    expect(host.querySelectorAll('[data-diagram="failed"]')).toHaveLength(1);
    expect(host.querySelectorAll('[data-diagram="done"]')).toHaveLength(1);
  });

  it('a fence that is not mermaid is plain code', async () => {
    const text = CHAPTER('```sql\nselect 1;\n```\n');
    const host = await settled(withText({ product: text, technical: text }), '#/product/chapter/F1');
    expect(host.querySelector('pre code')?.textContent).toBe('select 1;');
    expect(mermaid.render).not.toHaveBeenCalled();
  });
});

describe('citations', () => {
  const technical = CHAPTER(`${d('The clerk fills in the field')} \`src/forms/order-form.js:5\` ${d('and')} \`src/a.js:10-14\` ${d('but')} \`not a citation\` ${d('nor')} \`value:x\`.\n`);
  const product = CHAPTER(`${d('The clerk fills in the field')}.\n`);
  const data = withText({ product, technical });

  it('the technical view shows a citation as a chip with the file and the lines, and other inline code as code', async () => {
    const host = await settled(data, '#/technical/chapter/F1');
    const chips = Array.from(host.querySelectorAll('.cite'));
    expect(chips.map((chip) => [chip.querySelector('.cite-file')?.textContent, chip.querySelector('.cite-lines')?.textContent])).toEqual([['src/forms/order-form.js', ':5'], ['src/a.js', ':10-14']]);
    const plain = Array.from(host.querySelectorAll('.prose code:not(.cite)')).map((code) => code.textContent);
    expect(plain).toEqual(['not a citation', 'value:x']);
  });

  it('the product view has none: its text carries no citation, so the page shows no chip and no file', async () => {
    const host = await settled(data, '#/product/chapter/F1');
    expect(host.querySelector('.cite')).toBeNull();
    expect(host.textContent).not.toContain('order-form.js');
    expect(host.textContent).not.toMatch(/\.js:\d/);
  });
});

describe('what a chapter cannot do', () => {
  it('raw HTML in a chapter is not rendered as elements', async () => {
    const text = CHAPTER(`<script>window.__xv = 1</script>\n\n<img src="x" onerror="window.__xv = 2">\n\n${d('plain')}\n`);
    const host = await settled(withText({ product: text, technical: text }), '#/product/chapter/F1');
    expect(host.querySelector('.prose script')).toBeNull();
    expect(host.querySelector('.prose img')).toBeNull();
    expect((window as unknown as { __xv?: number }).__xv).toBeUndefined();
    expect(host.textContent).toContain(d('plain'));
  });

  it('an image is its alt text, and an external link opens in a new window without a referrer', async () => {
    const text = CHAPTER(`![${d('alt words')}](https://example.test/a.png)\n\n[${d('link')}](https://example.test/page)\n`);
    const host = await settled(withText({ product: text, technical: text }), '#/product/chapter/F1');
    expect(host.querySelector('.prose img')).toBeNull();
    expect(host.querySelector('.img-alt')?.textContent).toBe(`[${d('alt words')}]`);
    const link = host.querySelector('.prose a') as HTMLAnchorElement;
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('a chapter that is not in the data, or a view the page was not built with, is the not-found page', async () => {
    const data = withText({ product: CHAPTER(''), technical: CHAPTER('') });
    expect((await settled(data, '#/product/chapter/nope')).querySelector('[data-view="not-found"]')).not.toBeNull();
    expect((await settled(pageData({ views: ['product'] }), '#/technical/chapter/F1')).querySelector('[data-view="not-found"]')).not.toBeNull();
    expect(marked['page.notFound.heading']).toContain(MARK);
  });
});

describe('chapter table styles', () => {
  it('a cell of a chapter table has a minimum width, so a short column is not squeezed to one character per line', () => {
    const css = readFileSync(join(__dirname, '../src/index.css'), 'utf-8');
    expect(css).toMatch(/\.prose th, \.prose td \{[^}]*min-width: 5em;/);
  });
});
