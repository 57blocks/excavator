// @vitest-environment happy-dom
// Tasks 4.2 and 8.1 of openspec change handbook-page-structure: the left list in its domain state lists every domain (all open, its
// name a link to its page), each feature with its problem count; it is not shown below 900px and has no fold of its own. Rows are written by hand.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';

import { AppView } from '../src/App';
import { jumpToHeading } from '../src/lib/heading-jump';
import { rowsOfFeature } from '../src/lib/problems';
import { parseHash } from '../src/lib/route';
import { fill } from '../src/lib/text';
import type { PageData, ProblemRow, ProblemsData } from '../src/lib/types';
import { cleanup, mount, settle } from './dom';
import { domainData } from './domains-fixture';
import { NO_PROBLEMS, d, marked } from './page-fixture';

afterEach(() => { cleanup(); window.history.replaceState(null, '', '#'); });
beforeEach(() => { window.history.replaceState(null, '', '#'); });

const S = (key: string, values: Record<string, string | number> = {}): string => fill(marked[key], values);

const row = (id: string, over: Partial<ProblemRow> = {}): ProblemRow => ({
  id, type: 'defect', level: 'P1', group: 'security', features: ['F2'], summary: d(`summary ${id}`),
  texts: { product: d(`product text ${id}`), technical: d(`technical text ${id}`) },
  source: { chapter: 'defects', line: 4 }, remedy: null, ...over,
});
const design = (id: string, over: Partial<ProblemRow> = {}): ProblemRow => row(id, {
  type: 'design', level: 'high', group: 'duplication', summary: d(`design ${id}`),
  texts: { product: { situation: d(`situation ${id}`), consequence: d(`consequence ${id}`) }, technical: { situation: d(`tech situation ${id}`), consequence: d(`tech consequence ${id}`) } },
  cites: ['src/x.js:10-12'], source: { chapter: 'review', line: 6 }, ...over,
});
const open = (id: string, over: Partial<ProblemRow> = {}): ProblemRow => row(id, {
  type: 'open', level: null, group: null, summary: d(`question ${id}`), texts: { product: d(`open text ${id}`), technical: d(`open technical ${id}`) }, source: { chapter: 'F2', line: 9 }, ...over,
});

const problems = (rows: ProblemRow[], over: Partial<ProblemsData> = {}): ProblemsData => ({
  sources: { defects: { state: 'ok', count: null }, design: { state: 'ok', count: null }, open: { state: 'ok', count: null, unmatched: [] } }, rows, remedies: null, ...over,
});
const sourcesOf = (defects: 'ok' | 'missing' | 'failed' | 'changed', designState: 'ok' | 'missing' | 'failed' | 'changed', openState: 'ok' | 'missing' | 'failed' | 'changed', unmatched: string[] = []): ProblemsData['sources'] => ({
  defects: { state: defects, count: null }, design: { state: designState, count: null }, open: { state: openState, count: null, unmatched },
});

const text = (...sections: string[]): string => [`# ${d('Order entry')}`, '', marked['chapter.notVerified'], '', ...sections].join('\n');
const withText = (data: PageData, body: string, id = 'F2'): PageData => ({ ...data, chapters: data.chapters.map((one) => (one.id === id ? { id, texts: { product: body, technical: body } } : one)) });
const data = (rows: ProblemRow[], over: Partial<ProblemsData> = {}, body?: string): PageData => {
  const page = domainData({ problems: problems(rows, over) });
  return body === undefined ? page : withText(page, body);
};

const show = async (page: PageData, hash = '#/product/chapter/F2'): Promise<HTMLElement> => {
  const host = mount(<AppView data={page} route={parseHash(hash)} />);
  await settle();
  await settle();
  return host;
};
const click = (el: Element): void => { act(() => (el as HTMLElement).click()); };
const block = (host: HTMLElement): HTMLElement => host.querySelector('[data-part="feature-problems"]') as HTMLElement;
const squash = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const topIds = (host: HTMLElement): string[] => Array.from(block(host).querySelectorAll('[data-top-problem]')).map((one) => one.getAttribute('data-top-problem') as string);
const fold = (host: HTMLElement, id: string): HTMLDetailsElement => host.querySelector(`details[data-problem="${id}"]`) as HTMLDetailsElement;
const headings = (panel: HTMLElement): string[] => Array.from(panel.querySelectorAll('h2.sub')).map((one) => one.textContent ?? '');

describe('the domain list at the left', () => {
  const ROWS = [row('a', { features: ['F2'] }), row('b', { features: ['F1', 'F2'] }), design('c', { features: ['F1'] }), open('q', { features: ['system'] })];
  const side = (host: HTMLElement): HTMLElement => host.querySelector('.side') as HTMLElement;
  const groups = (host: HTMLElement): HTMLDetailsElement[] => Array.from(side(host).querySelectorAll<HTMLDetailsElement>('details.side-group'));

  it('lists every group, all of them open, the groups\' features in each', async () => {
    const host = await show(data(ROWS));
    expect(groups(host).map((one) => [one.getAttribute('data-group'), one.open])).toEqual([['d1', true], ['d2', true], ['d3', true], ['d4', true]]);
    expect(groups(host).map((one) => one.querySelector('summary')?.textContent)).toEqual([d('Platform'), d('Orders'), d('Billing'), d('Support')]);
    expect(groups(host).map((one) => Array.from(one.querySelectorAll('ul a')).map((link) => link.getAttribute('data-page')))).toEqual([['chapter:F1'], ['chapter:F2'], ['chapter:F3'], ['chapter:F4']]);
    expect(side(host).getAttribute('aria-label')).toBe(marked['page.nav.domains']);
    expect(Array.from(side(host).querySelectorAll('a[data-group-link]')).map((link) => [link.getAttribute('href'), link.textContent])).toEqual([['#/product/domain/d1', d('Platform')], ['#/product/domain/d2', d('Orders')], ['#/product/domain/d3', d('Billing')], ['#/product/domain/d4', d('Support')]]);
    expect(side(host).querySelector('[aria-current="page"]')?.getAttribute('data-page')).toBe('chapter:F2');
    expect(side(host).querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    expect(side(host).getAttribute('data-side')).toBe('domain');
  });

  it('starts with a link back to the overview, drawn with a chevron in the stylesheet, and has no heading of the old references list', async () => {
    const host = await show(data(ROWS));
    const back = side(host).firstElementChild?.firstElementChild as HTMLElement;
    expect(back.getAttribute('data-part')).toBe('side-back');
    expect(back.getAttribute('href')).toBe('#/product');
    expect(back.textContent).toBe(marked['page.nav.overview']);
    expect(side(host).querySelector('h2.side-name')).toBeNull();
    expect(readFileSync(join(__dirname, '../src/index.css'), 'utf-8')).toMatch(/\.side-back::before \{[^}]*border-left: 1\.5px solid currentColor;/);
  });

  it('marks the domain itself on its page, with its link in the summary, and no feature', async () => {
    const host = await show(data(ROWS), '#/product/domain/d2');
    expect(side(host).querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    const current = side(host).querySelector('[aria-current="page"]') as HTMLElement;
    expect(current.getAttribute('data-group-link')).toBe('d2');
    expect(current.parentElement?.tagName).toBe('SUMMARY');
    expect(groups(host).every((one) => one.open)).toBe(true);
  });

  it('lets the reader close a group, and a re-render does not reopen it', async () => {
    const page = data(ROWS);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<AppView data={page} route={parseHash('#/product/chapter/F2')} />));
    await settle();
    const third = groups(host)[2];
    click(third.querySelector('summary') as HTMLElement);
    expect(third.open).toBe(false);
    expect(groups(host).map((one) => one.open)).toEqual([true, true, false, true]);
    expect(third.querySelector('ul a')?.getAttribute('href')).toBe('#/product/chapter/F3');
    act(() => root.render(<AppView data={page} route={parseHash('#/product/chapter/F1')} />));
    await settle();
    expect(groups(host).map((one) => one.open)).toEqual([true, true, false, true]);
    expect(side(host).querySelector('[aria-current="page"]')?.getAttribute('data-page')).toBe('chapter:F1');
    click(groups(host)[2].querySelector('summary') as HTMLElement);
    expect(groups(host)[2].open).toBe(true);
    act(() => root.unmount());
  });

  /** Gives the list box a 400px window at y=100 and each element of the list its stubbed top (scrolled by the box), 20px high. */
  const lay = (host: HTMLElement, tops: Map<Element, number>): void => {
    const box = side(host);
    const rect = (top: number, height: number): DOMRect => ({ top, bottom: top + height, height, left: 0, right: 240, width: 240, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
    box.getBoundingClientRect = () => rect(100, 400);
    for (const [el, top] of tops) (el as HTMLElement).getBoundingClientRect = () => rect(top - box.scrollTop, 20);
  };
  const rerender = async (page: PageData, hash: string, before: (host: HTMLElement) => void): Promise<HTMLElement> => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(<AppView data={page} route={parseHash('#/product/domain/d1')} />));
    await settle();
    before(host);
    act(() => root.render(<AppView data={page} route={parseHash(hash)} />));
    await settle();
    return host;
  };

  it('puts the domain of a domain page at the top of the list, so that its features show below it', async () => {
    const host = await rerender(data(ROWS), '#/product/domain/d3', (one) => lay(one, new Map([[groups(one)[2], 450]])));
    expect(side(host).querySelector('[aria-current="page"]')?.getAttribute('data-group-link')).toBe('d3');
    expect(side(host).scrollTop).toBe(350);
  });

  it('keeps the back link at the top of the list box and puts the domain just below it, not under it', async () => {
    const css = readFileSync(join(__dirname, '../src/index.css'), 'utf-8');
    expect(css).toMatch(/\.side \.side-back \{ position: sticky; top: 0;[^}]*margin: 0;[^}]*background: var\(--bg\);/);
    const host = await rerender(data(ROWS), '#/product/domain/d3', (one) => {
      lay(one, new Map([[groups(one)[2], 450]]));
      const back = side(one).querySelector('.side-back') as HTMLElement;
      back.getBoundingClientRect = () => ({ top: 100, bottom: 136, height: 36, left: 0, right: 240, width: 240, x: 0, y: 100, toJSON: () => ({}) }) as DOMRect;
    });
    expect(side(host).scrollTop).toBe(314);
  });

  it('scrolls only just enough to show the feature of a feature page', async () => {
    const host = await rerender(data(ROWS), '#/product/chapter/F3', (one) => lay(one, new Map([[side(one).querySelector('a[data-page="chapter:F3"]') as Element, 600]])));
    expect(side(host).querySelector('[aria-current="page"]')?.getAttribute('data-page')).toBe('chapter:F3');
    expect(side(host).scrollTop).toBe(120);
  });

  it('does not touch the scroll position where there is no layout', async () => {
    const host = await show(data(ROWS));
    expect(side(host).scrollTop).toBe(0);
  });

  it('gives every feature its count, 0 included, equal to the rows of the problems table that name it', async () => {
    const host = await show(data(ROWS));
    for (const link of Array.from(side(host).querySelectorAll('a[data-page]'))) {
      const id = (link.getAttribute('data-page') as string).replace('chapter:', '');
      expect(link.querySelector('[data-part="problem-count"]')?.textContent, id).toBe(String(rowsOfFeature(ROWS, id).length));
    }
    expect(Array.from(side(host).querySelectorAll('[data-part="problem-count"]')).map((one) => one.textContent)).toEqual(['2', '2', '0', '0']);
  });

  it('has no fold of its own, and the stylesheet does not show it below 900px (the menu holds the same list)', async () => {
    const host = await show(data(ROWS));
    expect(Array.from(side(host).children).some((child) => child.tagName === 'DETAILS')).toBe(false);
    const css = readFileSync(join(__dirname, '../src/index.css'), 'utf-8');
    const phone = css.slice(css.indexOf('/* Phone:'));
    expect(phone).toMatch(/^\/\* Phone[^\n]*\n@media \(max-width: 900px\) \{/);
    expect(phone.slice(0, phone.indexOf('\n}\n'))).toMatch(/\.side \{ display: none; \}/);
    expect(phone).toMatch(/\.frame \{ display: block;/);
    const frameRule = css.match(/\.frame \{([^}]*)\}/)?.[1] ?? '';
    expect(frameRule).toMatch(/display: grid; grid-template-columns: var\(--side-w\) minmax\(0, 1fr\);/);
    expect(frameRule).not.toContain('max-width');
    expect(css).toMatch(/--side-w: 240px;/);
    expect(css).toMatch(/--rail-w: 240px;/);
    expect(css).toMatch(/\.read-main \{[^}]*max-width: var\(--read\);[^}]*justify-self: center;/);
    expect(css).toMatch(/\.read \{ display: grid; grid-template-columns: minmax\(0, 1fr\) var\(--rail-w\);/);
    const rail = css.slice(css.indexOf('@media (max-width: 1279px) {'));
    expect(rail.slice(0, rail.indexOf('\n}\n'))).toMatch(/\.toc, \.feature-nav \{ display: none; \}/);
    expect(css).not.toContain('max-width: 1180px');
    expect(css).toMatch(/\.side \{ position: sticky;/);
  });

  it('is not this list on a reference page: no domains, no counts, no old references heading', async () => {
    const host = await show(data(ROWS), '#/product/chapter/system');
    expect(side(host).getAttribute('data-side')).toBe('global');
    expect(side(host).getAttribute('aria-label')).toBe(marked['page.nav.label']);
    expect(side(host).querySelector('.side-group')).toBeNull();
    expect(side(host).querySelector('[data-part="problem-count"]')).toBeNull();
    expect(side(host).querySelector('h2.side-name')).toBeNull();
  });
});
