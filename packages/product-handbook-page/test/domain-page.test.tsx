// @vitest-environment happy-dom
// The domain page and the hand-overs on a feature page (openspec change handbook-page-domain-map, task 4.3): the two columns
// grouped by the other domain, the fixed text of an empty column, the cites in the technical view only, the section of the domains
// chapter under them, previous and next; the strip on a feature page, which holds no heading and moves no heading number.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppView } from '../src/App';
import { splitHead } from '../src/lib/head-split';
import { parseHash } from '../src/lib/route';
import type { PageData } from '../src/lib/types';
import { cleanup, mount, settle } from './dom';
import { domainData } from './domains-fixture';
import { d, marked } from './page-fixture';

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

const page = (hash: string, data: PageData = domainData()): HTMLElement => mount(<AppView data={data} route={parseHash(hash)} />);
const column = (host: HTMLElement, kind: 'in' | 'out'): HTMLElement => host.querySelector(`[data-column="${kind}"]`) as HTMLElement;
const groups = (el: HTMLElement): [string | null, string[]][] => Array.from(el.querySelectorAll('li[data-other]')).map((li) => [li.getAttribute('data-other'), Array.from(li.querySelectorAll('.ho')).map((one) => one.textContent ?? '')]);

describe('a domain page', () => {
  it('has the breadcrumbs, the name with a 16px mark, the intro as inline Markdown lead and the two columns with counts', () => {
    const host = page('#/product/domain/d1');
    expect(Array.from(host.querySelectorAll('.crumbs a')).map((one) => one.getAttribute('href'))).toEqual(['#/product']);
    expect(host.querySelector('.crumbs')?.textContent).toContain(d('Platform'));
    expect(host.querySelector('h1')?.textContent).toBe(d('Platform'));
    expect(host.querySelector('h1 .mark')).not.toBeNull();
    const lead = host.querySelector('.dom-lede') as HTMLElement;
    expect(lead.querySelector('strong')?.textContent).toBe('base');
    expect(lead.querySelector('p')).toBeNull();
    expect(column(host, 'in').querySelector('h2')?.textContent).toBe(`${marked['page.handover.in']}0`);
    expect(column(host, 'out').querySelector('h2')?.textContent).toBe(`${marked['page.handover.out']}2`);
    expect(column(host, 'in').classList.contains('dir-in')).toBe(true);
    expect(column(host, 'out').classList.contains('dir-out')).toBe(true);
  });

  it('groups each column by the domain at the other end, in order, each with its hand-over texts and a link to that domain', () => {
    const host = page('#/product/domain/d3');
    expect(groups(column(host, 'in')).map(([other]) => other)).toEqual(['d1', 'd2']);
    expect(groups(column(host, 'out')).map(([other]) => other)).toEqual(['d2', 'd4']);
    expect(column(host, 'in').querySelector('[data-other="d2"] a')?.getAttribute('href')).toBe('#/product/domain/d2');
    expect(groups(column(host, 'in'))[1][1]).toEqual([`${d('Order entry')} asks for an invoice.`.replace(' asks', ' asks')]);
    expect(column(host, 'out').querySelector('[data-other="d4"] .ho a[data-feature]')?.getAttribute('href')).toBe('#/product/chapter/F4');
    expect(column(host, 'in').querySelector('h2')?.textContent).toBe(`${marked['page.handover.in']}2`);
  });

  it('groups several hand-overs between the same two domains under one entry', () => {
    const data = domainData();
    data.domains = { ...data.domains, handovers: [...data.domains.handovers, { from: 'd1', to: 'd2', what: d('A second hand-over.'), features: [], cites: ['src/f.js:1-1'] }] };
    const host = page('#/product/domain/d2', data);
    const first = groups(column(host, 'in'))[0];
    expect(first[0]).toBe('d1');
    expect(first[1]).toHaveLength(2);
    expect(first[1][1]).toBe(d('A second hand-over.'));
  });

  it('says in fixed text that a column is empty', () => {
    const host = page('#/product/domain/d1');
    expect(column(host, 'in').querySelector('.empty')?.textContent).toBe(marked['page.domain.noneIn']);
    expect(column(host, 'out').querySelector('.empty')).toBeNull();
    const support = page('#/product/domain/d4');
    expect(column(support, 'out').querySelector('.empty')?.textContent).toBe(marked['page.domain.noneOut']);
  });

  it('shows the cites after each hand-over in the technical view and not in the product view', () => {
    const technical = page('#/technical/domain/d3');
    expect(Array.from(column(technical, 'in').querySelectorAll('.ho-cites code')).map((one) => one.textContent)).toEqual(['src/b.js:4-9', 'src/c.js:2-2']);
    expect(technical.querySelector('.dom-lede')?.textContent).toBe(d('Bills customers (code).'));
    expect(page('#/product/domain/d3').querySelector('.ho-cites')).toBeNull();
  });

  it('shows the body of the domain section by view under the columns, and nothing when there is none', () => {
    const host = page('#/product/domain/d1');
    const body = host.querySelector('.dom-body') as HTMLElement;
    expect(body.querySelector('h3')?.textContent).toBe(d('Notes'));
    expect(body.textContent).toContain(d('Body of the platform.'));
    expect(body.querySelector('.cite')).toBeNull();
    expect(page('#/technical/domain/d1').querySelector('.dom-body .cite')).not.toBeNull();
    expect(page('#/product/domain/d2').querySelector('.dom-body')).toBeNull();
  });

  it('ends with the previous and the next domain, and has only one of them at an end', () => {
    const middle = page('#/product/domain/d2');
    const nav = middle.querySelector('[data-part="domain-nav"]') as HTMLElement;
    expect(nav.getAttribute('aria-label')).toBe(marked['page.domain.nav']);
    expect(nav.querySelector('[data-side="previous"]')?.getAttribute('href')).toBe('#/product/domain/d1');
    expect(nav.querySelector('[data-side="next"]')?.getAttribute('href')).toBe('#/product/domain/d3');
    expect(nav.querySelector('[data-side="previous"]')?.textContent).toBe(`${marked['page.domain.previous']}${d('Platform')}`);
    const first = page('#/product/domain/d1').querySelector('[data-part="domain-nav"]') as HTMLElement;
    expect(first.querySelector('[data-side="previous"]')).toBeNull();
    expect(first.querySelector('[data-side="next"]')).not.toBeNull();
    expect(page('#/product/domain/d4').querySelector('[data-side="next"]')).toBeNull();
  });

  it('lists the features of the group as links and has no columns when there is no usable list', () => {
    const host = page('#/product/domain/d1', domainData({ domains: { state: 'failed', list: [], handovers: [] } }));
    expect(host.querySelector('[data-column]')).toBeNull();
    expect(Array.from(host.querySelectorAll('.plain-list a')).map((one) => one.getAttribute('href'))).toEqual(['#/product/chapter/F1', '#/product/chapter/F2', '#/product/chapter/F3', '#/product/chapter/F4']);
  });
});

describe('the strip on a feature page', () => {
  const strip = (host: HTMLElement): HTMLElement | null => host.querySelector('[data-part="handover-strip"]');
  const rows = (host: HTMLElement): [string | null, string | undefined][] => Array.from(strip(host)?.querySelectorAll('li') ?? []).map((li) => [li.getAttribute('data-direction'), li.querySelector('.strip-dir')?.textContent?.replace(/\s+/g, ' ')]);

  it('lists the hand-overs that name the chapter, handed over or received from the point of view of its domain, and "from to" when it is neither end', () => {
    const host = page('#/product/chapter/F2');
    expect(rows(host)).toEqual([
      ['in', `${marked['page.handover.in']} ${d('Platform')}`],
      ['out', `${marked['page.handover.out']} ${d('Billing')}`],
      ['between', `${d('Billing')} ${marked['page.handover.between']} ${d('Support')}`],
    ]);
    expect(strip(host)?.getAttribute('aria-label')).toBe(marked['page.strip.heading']);
    expect(strip(host)?.querySelector('li[data-direction="in"] a[href="#/product/domain/d1"]')).not.toBeNull();
    expect(strip(host)?.querySelector('li[data-direction="between"] a[href="#/product/domain/d4"]')).not.toBeNull();
    expect(rows(page('#/product/chapter/F1'))).toEqual([['out', `${marked['page.handover.out']} ${d('Orders')}`]]);
    expect(rows(page('#/product/chapter/F4'))).toEqual([['in', `${marked['page.handover.in']} ${d('Billing')}`]]);
  });

  it('shows the cites in the technical view only', () => {
    expect(page('#/product/chapter/F3').querySelector('[data-part="handover-strip"] .ho-cites')).toBeNull();
    const technical = page('#/technical/chapter/F3');
    expect(Array.from(technical.querySelectorAll('[data-part="handover-strip"] .ho-cites code')).map((one) => one.textContent)).toEqual(['src/b.js:4-9']);
  });

  it('is after the head (the heading and its notice) and before the rest, between rules, with no box', () => {
    const article = page('#/product/chapter/F2').querySelector('article') as HTMLElement;
    expect(Array.from(article.children).map((one) => one.className)).toEqual(['prose', 'strip', 'prose']);
    expect(article.children[0].querySelector('h1')).not.toBeNull();
    expect(article.children[0].querySelector('p.note')).not.toBeNull();
    expect(article.children[2].querySelector('h2')).not.toBeNull();
    expect(article.children[1].querySelector('h1, h2, h3, h4, h5, h6')).toBeNull();
  });

  it('keeps the heading numbers: the first level-2 heading of the chapter is still h-0, with the strip in the page', () => {
    const host = page('#/product/chapter/F2');
    expect(Array.from(host.querySelectorAll('.prose h2')).map((one) => [one.id, one.textContent])).toEqual([['h-0', d('Order entry first')], ['h-1', d('Order entry second')]]);
    expect(host.querySelector('.toc')).not.toBeNull();
    expect(Array.from(host.querySelectorAll('.toc button')).map((one) => one.getAttribute('data-target'))).toEqual(['h-0', 'h-1']);
  });

  it('has none for a chapter no hand-over names, and none without a usable list', () => {
    expect(strip(page('#/product/chapter/system'))).toBeNull();
    const data = domainData({ domains: { state: 'changed', list: [], handovers: [] } });
    expect(strip(page('#/product/chapter/F2', data))).toBeNull();
    expect(page('#/product/chapter/F2', data).querySelectorAll('article > .prose')).toHaveLength(1);
  });

  it('keeps a diagram of the chapter under the same id as without the strip', async () => {
    const text = `# ${d('Order entry')}\n\n${marked['chapter.notVerified']}\n\n## ${d('Flow')}\n\n\`\`\`mermaid\nstateDiagram-v2\n  Draft\n  [*] --> Draft\n\`\`\`\n`;
    const data = domainData();
    data.chapters = data.chapters.map((chapter) => (chapter.id === 'F2' ? { id: 'F2', texts: { product: text, technical: text } } : chapter));
    const withStrip = page('#/product/chapter/F2', data);
    await settle();
    await settle();
    expect(withStrip.querySelector('[data-part="handover-strip"]')).not.toBeNull();
    expect(withStrip.querySelector('svg[data-id]')?.getAttribute('data-id')).toBe('xv-diagram-F2-0');
    cleanup();
    const without = page('#/product/chapter/F2', { ...data, domains: { state: 'missing', list: [], handovers: [] } });
    await settle();
    await settle();
    expect(without.querySelector('svg[data-id]')?.getAttribute('data-id')).toBe('xv-diagram-F2-0');
  });
});

describe('splitHead', () => {
  const notice = '@@Not verified.';
  it('cuts after the heading and the notice paragraphs that follow it', () => {
    const text = `# Title\n\n${notice}\n\n@@Not passed 3.\n\nBody.\n\n## Next\n`;
    const { head, rest } = splitHead(text, [notice, '@@Not passed']);
    expect(head).toBe(`# Title\n\n${notice}\n\n@@Not passed 3.`);
    expect(rest.trim()).toBe('Body.\n\n## Next');
    expect(`${head}\n${rest}`).toBe(text);
  });

  it('cuts right after the heading when no notice follows, and gives an empty head for a text with no level-1 heading', () => {
    expect(splitHead('# Title\n\nBody.\n', [notice])).toEqual({ head: '# Title', rest: '\nBody.\n' });
    expect(splitHead('Body.\n\n# Later\n', [notice])).toEqual({ head: '', rest: 'Body.\n\n# Later\n' });
    expect(splitHead('# Only', [notice])).toEqual({ head: '# Only', rest: '' });
  });
});
