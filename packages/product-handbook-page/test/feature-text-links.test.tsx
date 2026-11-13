// @vitest-environment happy-dom
// Feature names in the running text link to their pages (openspec change handbook-page-reachability, step 1), through the real
// Markdown parser: a table cell, code, a link, a heading and a mermaid fence are left alone, the chapter's own id too, the table of
// contents keeps its ids, and the domain page links every feature of its features table.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppView } from '../src/App';
import { parseHash } from '../src/lib/route';
import type { PageData } from '../src/lib/types';
import { cleanup, mount, settle } from './dom';
import { domainData } from './domains-fixture';
import { d } from './page-fixture';

const mermaid = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn(), parse: vi.fn() }));
vi.mock('mermaid', () => ({ default: mermaid }));

beforeEach(() => {
  mermaid.initialize.mockReset();
  mermaid.render.mockReset();
  mermaid.parse.mockReset();
  mermaid.parse.mockImplementation(async (source: string) => { if (source.includes('BROKEN')) throw new Error('Parse error on line 2'); return { diagramType: 'flowchart' }; });
  mermaid.render.mockImplementation(async (id: string) => ({ svg: `<svg data-id="${id}"></svg>` }));
});
afterEach(cleanup);

const OPEN = String.fromCharCode(0xff08);
const CLOSE = String.fromCharCode(0xff09);

const withF1 = (body: string): PageData => {
  const data = domainData();
  const text = `# ${d('Platform core')}\n\n${body}`;
  return { ...data, chapters: data.chapters.map((one) => (one.id === 'F1' ? { id: 'F1', texts: { product: text, technical: text } } : one)) };
};
const open = async (data: PageData, hash: string): Promise<HTMLElement> => {
  const host = mount(<AppView data={data} route={parseHash(hash)} />);
  await settle();
  await settle();
  return host;
};
const anchors = (host: HTMLElement): [string, string | null, string | null][] => Array.from(host.querySelectorAll('.prose a[data-feature]')).map((a) => [a.textContent ?? '', a.getAttribute('href'), a.getAttribute('data-feature')]);

describe('feature links in the text', () => {
  it('links the title before an ASCII or full-width reference, in the current view, and drops the reference', async () => {
    // One tilde per paragraph: two of them would be strikethrough.
    const body = `Hands over to ${d('Order entry')} (F2)\n\nand ${d('Invoicing')} ${OPEN}F3${CLOSE}.\n`;
    const host = await open(withF1(body), '#/technical/chapter/F1');
    expect(anchors(host)).toEqual([[d('Order entry'), '#/technical/chapter/F2', 'F2'], [d('Invoicing'), '#/technical/chapter/F3', 'F3']]);
    expect(host.querySelector('.prose')?.textContent).not.toContain('F2');
    expect(host.querySelector('.prose')?.textContent).not.toContain('F3');
  });

  it('links only the id when the title is not right before it, keeping the parentheses', async () => {
    const host = await open(withF1('The approval step (F2) runs.\n'), '#/product/chapter/F1');
    expect(anchors(host)).toEqual([['F2', '#/product/chapter/F2', 'F2']]);
    expect(host.querySelector('.prose p')?.textContent).toBe('The approval step (F2) runs.');
  });

  it('leaves an unknown id, the chapter own id, code, a link, a heading and a mermaid fence as they were', async () => {
    const body = [
      `Unknown (F99) and own ${d('Platform core')} (F1).`,
      '`Order entry (F2)`',
      `[${d('Order entry')} (F2)](https://example.test/x)`,
      `## ${d('Order entry')} (F2)`,
      '```mermaid\nstateDiagram-v2\n  Draft\n  Draft --> Done : "Order entry (F2)"\n```',
      '',
    ].join('\n\n');
    const host = await open(withF1(body), '#/product/chapter/F1');
    expect(anchors(host)).toEqual([]);
    expect(host.querySelector('.prose p')?.textContent).toContain('(F99)');
    expect(host.querySelector('#h-0')?.textContent).toBe(`${d('Order entry')} (F2)`);
    expect(host.querySelector('.prose code')?.textContent).toBe('Order entry (F2)');
    expect(mermaid.render.mock.calls[0][1]).toContain('"Order entry (F2)"');
  });

  it('links in a table cell, and the table of contents ids and the diagram ids do not change', async () => {
    const plain = withF1(`## ${d('First')}\n\ntext\n\n## ${d('Second')}\n\n\`\`\`mermaid\nstateDiagram-v2\n  Draft\n  [*] --> Draft\n\`\`\`\n`);
    const linked = withF1(`## ${d('First')}\n\n${d('Order entry')} (F2)\n\n## ${d('Second')}\n\n| Feature |\n| --- |\n| ${d('Invoicing')} (F3) |\n\n\`\`\`mermaid\nstateDiagram-v2\n  Draft\n  [*] --> Draft\n\`\`\`\n`);
    const idsOf = (host: HTMLElement): string[] => Array.from(host.querySelectorAll('[id]')).map((el) => el.id);
    const before = await open(plain, '#/product/chapter/F1');
    const plainIds = idsOf(before);
    const plainDiagrams = mermaid.render.mock.calls.map((call) => call[0]);
    cleanup();
    mermaid.render.mockClear();
    const after = await open(linked, '#/product/chapter/F1');
    expect(anchors(after).map((one) => one[2])).toEqual(['F2', 'F3']);
    expect(after.querySelector('td a[data-feature="F3"]')).not.toBeNull();
    expect(idsOf(after)).toEqual(plainIds);
    expect(plainIds.some((id) => /^h-\d+$/.test(id))).toBe(true);
    expect(plainDiagrams).toHaveLength(1);
    expect(mermaid.render.mock.calls.map((call) => call[0])).toEqual(plainDiagrams);
  });

  it('the domain page links every feature of its features table', async () => {
    const data = domainData();
    const table = `| Feature |\n| --- |\n| ${d('Platform core')} (F1) |\n| ${d('Order entry')} (F2) |\n`;
    const withBody: PageData = { ...data, domains: { ...data.domains, list: data.domains.state === 'ok' ? data.domains.list.map((one) => (one.id === 'd1' ? { ...one, features: ['F1', 'F2'], body: { product: table, technical: table } } : one)) : [] } };
    const host = await open(withBody, '#/product/domain/d1');
    expect(anchors(host).map((one) => one[2])).toEqual(['F1', 'F2']);
  });
});
