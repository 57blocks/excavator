// @vitest-environment happy-dom
// Task 4.2 of openspec change handbook-page-structure: the side list of a feature page lists every group (all open), each feature with its problem count. Rows are written by hand.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
const tabs = (host: HTMLElement): HTMLElement[] => Array.from(host.querySelectorAll<HTMLElement>('[role="tab"]'));
const selected = (host: HTMLElement): string => tabs(host).find((tab) => tab.getAttribute('aria-selected') === 'true')?.textContent ?? '';
const panelOf = (host: HTMLElement, label: string): HTMLElement => {
  const tab = tabs(host).find((one) => one.textContent?.startsWith(label)) as HTMLElement;
  return host.querySelector(`#${CSS.escape(tab.getAttribute('aria-controls') as string)}`) as HTMLElement;
};
const issues = (host: HTMLElement): HTMLElement => panelOf(host, marked['page.feature.issues']);
const block = (host: HTMLElement): HTMLElement => host.querySelector('[data-part="feature-problems"]') as HTMLElement;
const squash = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const topIds = (host: HTMLElement): string[] => Array.from(block(host).querySelectorAll('[data-top-problem]')).map((one) => one.getAttribute('data-top-problem') as string);
const fold = (host: HTMLElement, id: string): HTMLDetailsElement => host.querySelector(`details[data-problem="${id}"]`) as HTMLDetailsElement;
const headings = (panel: HTMLElement): string[] => Array.from(panel.querySelectorAll('h2.sub')).map((one) => one.textContent ?? '');

describe('the side list of a feature page', () => {
  const ROWS = [row('a', { features: ['F2'] }), row('b', { features: ['F1', 'F2'] }), design('c', { features: ['F1'] }), open('q', { features: ['system'] })];
  const side = (host: HTMLElement): HTMLElement => host.querySelector('.side') as HTMLElement;
  const groups = (host: HTMLElement): HTMLDetailsElement[] => Array.from(side(host).querySelectorAll<HTMLDetailsElement>('details.side-group'));

  it('lists every group, all of them open, the groups\' features in each', async () => {
    const host = await show(data(ROWS));
    expect(groups(host).map((one) => [one.getAttribute('data-group'), one.open])).toEqual([['d1', true], ['d2', true], ['d3', true], ['d4', true]]);
    expect(groups(host).map((one) => one.querySelector('summary')?.textContent)).toEqual([d('Platform'), d('Orders'), d('Billing'), d('Support')]);
    expect(groups(host).map((one) => Array.from(one.querySelectorAll('a')).map((link) => link.getAttribute('data-page')))).toEqual([['chapter:F1'], ['chapter:F2'], ['chapter:F3'], ['chapter:F4']]);
    expect(side(host).getAttribute('aria-label')).toBe(marked['page.nav.domains']);
    expect(side(host).querySelector('a[href*="/domain/"]')).toBeNull();
    expect(side(host).querySelector('[aria-current="page"]')?.getAttribute('data-page')).toBe('chapter:F2');
    expect(side(host).querySelectorAll('[aria-current="page"]')).toHaveLength(1);
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
    expect(third.querySelector('a')?.getAttribute('href')).toBe('#/product/chapter/F3');
    act(() => root.render(<AppView data={page} route={parseHash('#/product/chapter/F1')} />));
    await settle();
    expect(groups(host).map((one) => one.open)).toEqual([true, true, false, true]);
    expect(side(host).querySelector('[aria-current="page"]')?.getAttribute('data-page')).toBe('chapter:F1');
    click(groups(host)[2].querySelector('summary') as HTMLElement);
    expect(groups(host)[2].open).toBe(true);
    act(() => root.unmount());
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

  it('keeps the phone behaviour: the whole list is behind a details whose summary is the current group, open on a wide screen only', () => {
    const saved = window.matchMedia;
    const media = (wide: boolean) => ((query: string) => ({ matches: wide && query.includes('min-width'), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    try {
      window.matchMedia = media(true);
      const wide = renderToStaticMarkup(<AppView data={data(ROWS)} route={parseHash('#/product/chapter/F2')} />);
      expect(wide).toMatch(/<nav class="side"[^>]*><details open=""><summary><span class="mark"[^>]*><\/span>d~Orders<\/summary>/);
      window.matchMedia = media(false);
      const narrow = renderToStaticMarkup(<AppView data={data(ROWS)} route={parseHash('#/product/chapter/F2')} />);
      expect(narrow).toMatch(/<nav class="side"[^>]*><details><summary>/);
    } finally {
      window.matchMedia = saved;
    }
  });

  it('leaves the references side list as it was: no groups, no counts, the references named by the nav', async () => {
    const host = await show(data(ROWS), '#/product/chapter/system');
    expect(side(host).getAttribute('data-side')).toBe('references');
    expect(side(host).getAttribute('aria-label')).toBe(marked['page.nav.references']);
    expect(side(host).querySelector('.side-group')).toBeNull();
    expect(side(host).querySelector('[data-part="problem-count"]')).toBeNull();
    expect(side(host).querySelector('h2.side-name')?.textContent).toBe(marked['page.nav.references']);
  });
});
