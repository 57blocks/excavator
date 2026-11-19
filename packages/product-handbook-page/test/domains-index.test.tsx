// @vitest-environment happy-dom
// The domains chapter page (openspec change handbook-page-structure, task 10.4): with a usable list of domains it is an index
// (colour mark, name linked to the domain page, intro; no features, hand-overs or chapter body); without one it is the chapter
// as written. The search sends a heading inside one domain's section to that domain's page.
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { AppView } from '../src/App';
import type { Group } from '../src/lib/groups';
import { searchResults } from '../src/lib/search';
import { parseHash } from '../src/lib/route';
import type { PageData, SearchItem } from '../src/lib/types';
import { cleanup, mount } from './dom';
import { domainData } from './domains-fixture';
import { d } from './page-fixture';

afterEach(() => { cleanup(); window.location.hash = ''; });

const CHAPTER_BODY = `## ${d('Platform')}\n\n${d('Chapter section of the platform.')} (F1)\n\n### ${d('Platform detail')}\n\ntext\n\n## ${d('Orders')}\n\n${d('Chapter section of the orders.')}\n\n## ${d('Unrelated')}\n\ntext\n`;

/** The domain fixture with a domains chapter in the outline and its text. */
function withChapter(extra: Partial<PageData> = {}): PageData {
  const data = domainData(extra);
  const outline = { ...data.outline, parts: [...data.outline.parts, { title: d('Across'), blocks: [{ block: 'domains', kind: 'chapter' as const, title: d('Domains chapter') }] }] };
  const texts = Object.fromEntries(['product', 'technical'].map((view) => [view, `# ${d('Domains chapter')}\n\n${CHAPTER_BODY}`]));
  return { ...data, outline, chapters: [...data.chapters, { id: 'domains', texts }] };
}

const show = (data: PageData, hash = '#/product/chapter/domains'): HTMLElement => mount(<AppView data={data} route={parseHash(hash)} />);

describe('the domains chapter with a usable list of domains', () => {
  it('lists the domains in order with mark, linked name and intro, and nothing of the chapter', () => {
    const host = show(withChapter());
    const page = host.querySelector('[data-part="domains-index"]') as HTMLElement;
    expect(page.querySelector('h1')?.textContent).toBe(d('Domains chapter'));
    const rows = Array.from(page.querySelectorAll('ul.dom-index > li'));
    expect(rows.map((row) => row.getAttribute('data-domain'))).toEqual(['d1', 'd2', 'd3', 'd4']);
    expect(rows.map((row) => [row.querySelector('a')?.getAttribute('href'), row.querySelector('a')?.textContent])).toEqual([
      ['#/product/domain/d1', d('Platform')], ['#/product/domain/d2', d('Orders')], ['#/product/domain/d3', d('Billing')], ['#/product/domain/d4', d('Support')],
    ]);
    for (const row of rows) { expect(row.querySelectorAll('a')).toHaveLength(1); expect(row.querySelector('a .mark')).not.toBeNull(); }
    expect(rows[0].querySelector('.dom-index-intro strong')?.textContent).toBe('base');
    expect(rows[1].querySelector('.dom-index-intro')?.textContent).toBe(d('Takes orders.'));
    expect(page.querySelector('.ho, a[data-feature], [data-part="handover-strip"], .strip')).toBeNull();
    expect(page.textContent).not.toContain('Chapter section');
    expect(page.textContent).not.toContain(d('Platform detail'));
    expect(host.querySelector('.read')?.getAttribute('data-toc')).toBe('none');
    expect(host.querySelector('.toc')).toBeNull();
    expect(host.querySelector('.crumbs')).not.toBeNull();
  });

  it('shows no intro line for a domain with an empty intro, and the technical view shows the technical intro', () => {
    const data = withChapter();
    const list = data.domains.list.map((domain) => (domain.id === 'd3' ? { ...domain, intro: {} } : domain));
    const host = show({ ...data, domains: { ...data.domains, list } });
    expect(host.querySelector('li[data-domain="d3"] .dom-index-intro')).toBeNull();
    expect(host.querySelector('li[data-domain="d4"] .dom-index-intro')).not.toBeNull();
    cleanup();
    const technical = show(withChapter(), '#/technical/chapter/domains');
    expect(technical.querySelector('li[data-domain="d2"] .dom-index-intro')?.textContent).toBe(d('Takes orders (code).'));
  });
});

describe('the domains chapter without a usable list of domains', () => {
  it('shows the chapter text as written', () => {
    const host = show(withChapter({ domains: { state: 'missing', list: [], handovers: [] } }));
    expect(host.querySelector('[data-part="domains-index"]')).toBeNull();
    expect(host.querySelector('[data-chapter="domains"]')?.textContent).toContain(d('Chapter section of the platform.'));
    expect(host.querySelector('[data-chapter="domains"] h1')?.textContent).toBe(d('Domains chapter'));
  });
});

describe('search results in the domains chapter', () => {
  const data = withChapter();
  const groups = [{ id: 'd1', name: d('Platform'), features: [] }, { id: 'd2', name: d('Orders'), features: [] }] as unknown as Group[];
  const heading = (title: string, at: number, level: 2 | 3): SearchItem => ({ kind: 'heading', title, chapter: 'domains', domain: null, heading: at, level });
  const items: SearchItem[] = [
    { kind: 'chapter', title: d('Domains chapter'), chapter: 'domains', domain: null, heading: null, level: null },
    heading(d('Platform'), 0, 2), heading(d('Platform detail'), 1, 3), heading(d('Orders'), 2, 2), heading(d('Unrelated'), 3, 2), heading(d('Unrelated detail'), 4, 3),
  ];
  const run = (domainsIndex: boolean) => searchResults({ query: 'detail', groups, items, references: [], domainsLabel: 'domains', systemTitle: 'sys', domainsIndex });

  it('open the domain page for a heading in a domain section and the index for the rest', () => {
    expect(run(true).map((one) => [one.title, JSON.stringify(one.target)])).toEqual([
      [d('Platform detail'), JSON.stringify({ kind: 'domain', id: 'd1' })],
      [d('Unrelated detail'), JSON.stringify({ kind: 'heading', chapter: 'domains', heading: 4 })],
    ]);
    const unrelated = searchResults({ query: 'unrelated', groups, items, references: [], domainsLabel: 'd', systemTitle: 's', domainsIndex: true });
    expect(unrelated.map((one) => one.target.kind)).toEqual(['heading', 'heading']);
    const chapter = searchResults({ query: 'chapter', groups, items, references: [], domainsLabel: 'd', systemTitle: 's', domainsIndex: true });
    expect(chapter.map((one) => JSON.stringify(one.target))).toEqual([JSON.stringify({ kind: 'chapter', id: 'domains' })]);
  });

  it('keep the heading targets when the page lists no domains', () => {
    expect(run(false).map((one) => one.target.kind)).toEqual(['heading', 'heading']);
  });

  it('goes to the domain page when the result is chosen in the dialog', () => {
    mount(<AppView data={{ ...data, search: [...data.search, ...items] }} route={parseHash('#/product')} />);
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true })); });
    const box = document.querySelector('[role="dialog"] input') as HTMLInputElement;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set as (value: string) => void;
    act(() => { set.call(box, d('Platform detail')); box.dispatchEvent(new Event('input', { bubbles: true })); });
    const option = document.querySelector('[role="option"][data-result="heading:domains:1"]') as HTMLElement;
    expect(option).not.toBeNull();
    act(() => option.click());
    expect(window.location.hash).toBe('#/product/domain/d1');
  });
});
