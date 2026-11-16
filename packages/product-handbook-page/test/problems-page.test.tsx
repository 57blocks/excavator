// @vitest-environment happy-dom
// Task 3.1 and 3.2 of openspec change handbook-page-structure: the route of the problems page, its table and order, its filters (also from
// the address), its counts, its expanded rows, the lines for the state of each source, its remedies tab, and the chapters that are no
// longer reference pages. Rows are written by hand with fixed texts so every expectation is exact.
import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { App, AppView, documentTitle, placeOf } from '../src/App';
import { referencesOf, groupsOf } from '../src/lib/groups';
import { makeLinks } from '../src/lib/links';
import { switchTarget, viewOf } from '../src/lib/navigation';
import { pagesOf } from '../src/lib/pages';
import { parseHash, routeHash } from '../src/lib/route';

import { sortRows } from '../src/lib/problems';
import { searchResults } from '../src/lib/search';
import type { Outline, PageData, ProblemRow, ProblemsData } from '../src/lib/types';
import { cleanup, mount, choose, typeInto } from './dom';
import { domainData } from './domains-fixture';
import { BOTH, MARK, NO_PROBLEMS, chapter, d, marked, outlineOf, pageData } from './page-fixture';

afterEach(() => { cleanup(); window.history.replaceState(null, '', '#'); });
beforeEach(() => { window.history.replaceState(null, '', '#'); });

const row = (id: string, over: Partial<ProblemRow> = {}): ProblemRow => ({
  id, type: 'defect', level: 'P1', group: 'security', features: ['F1'], summary: d(`summary ${id}`),
  texts: { product: d(`product text ${id}`), technical: `${d(`technical text ${id}`)} \`src/a.js:3-5\`` },
  source: { chapter: 'defects', line: 4 }, remedy: null, ...over,
});
const design = (id: string, over: Partial<ProblemRow> = {}): ProblemRow => row(id, {
  type: 'design', level: 'high', group: 'duplication', summary: d(`design ${id}`),
  texts: { product: { situation: d(`situation ${id}`), consequence: d(`consequence ${id}`) }, technical: { situation: d(`tech situation ${id}`), consequence: d(`tech consequence ${id}`) } },
  cites: ['src/x.js:10-12', 'src/y.js:2'], source: { chapter: 'review', line: 6 }, ...over,
});
const open = (id: string, over: Partial<ProblemRow> = {}): ProblemRow => row(id, {
  type: 'open', level: null, group: null, features: ['system'], summary: d(`question ${id}`), texts: { product: d(`open text ${id}`), technical: d(`open technical ${id}`) }, source: { chapter: 'system', line: 9 }, ...over,
});

const ROWS: ProblemRow[] = [
  row('d1', { level: 'P2' }),
  row('d2', { level: 'P0', features: ['F1', 'F2'], remedy: { chapter: 'remedies', heading: 1 } }),
  row('d3', { level: 'P1', features: ['F2'] }),
  design('r1', { level: 'low' }),
  design('r2', { level: 'high', features: ['F2'], remedy: { chapter: 'remedies', heading: 0 } }),
  open('q1'),
  open('q2', { features: ['F2'] }),
];

const problems = (over: Partial<ProblemsData> = {}): ProblemsData => ({
  sources: { defects: { state: 'ok', count: 3 }, design: { state: 'ok', count: 2 }, open: { state: 'ok', count: 2, unmatched: [] } }, rows: ROWS, remedies: 'remedies', ...over,
});

const outlineWith = (blocks: string[]): Outline => {
  const base = outlineOf();
  return { ...base, parts: [...base.parts, { title: d('Problems part'), blocks: blocks.map((block) => ({ block, kind: 'chapter' as const, title: d(`title of ${block}`) })) }] };
};
const REMEDIES = `# ${d('Remedies')}\n\n## ${d('Security')}\n\n${d('fix secrets')}\n\n## ${d('Duplication')}\n\n${d('merge them')}\n`;
const data = (over: { problems?: ProblemsData; views?: ('product' | 'technical')[]; remedies?: boolean } = {}): PageData => {
  const views = over.views ?? BOTH;
  return pageData({
    views,
    problems: over.problems ?? problems(),
    outline: outlineWith(['defects', 'review', 'remedies']),
    chapters: [chapter('system', 'System chapter', views), chapter('F1', 'Orders', views), chapter('F2', 'Reminders', views), chapter('defects', 'Defects', views), chapter('review', 'Review', views),
      ...(over.remedies === false ? [] : [{ id: 'remedies', texts: Object.fromEntries(views.map((view) => [view, REMEDIES])) }])],
  });
};

const render = (page: PageData, hash: string): string => renderToStaticMarkup(<AppView data={page} route={parseHash(hash)} />);
const decode = (text: string): string => text.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const fixed = (key: string): string => `${MARK}${marked[key].slice(MARK.length)}`;
const ids = (html: string): string[] => Array.from(html.matchAll(/data-problem="([^"]+)"/g)).map((found) => found[1]);
const t = (key: string, values: Record<string, string | number> = {}): string => (marked[key] as string).replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole));
/** The text of the counts of one type, whitespace collapsed. */
const counts = (html: string, type: string): string => {
  const start = html.indexOf(`data-source="${type}"`, html.indexOf('data-part="problem-counts"'));
  return decode(html.slice(html.indexOf('>', start) + 1, html.indexOf('</ul>', start)).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
};

describe('the route', () => {
  it('parses the page, its tab and its filters, with and without the view prefix, and builds them back in a fixed key order', () => {
    expect(parseHash('#/problems')).toEqual({ name: 'problems', tab: 'list', filters: {} });
    expect(parseHash('#/problems/remedies')).toEqual({ name: 'problems', tab: 'remedies', filters: {} });
    expect(parseHash('#/technical/problems?q=a%20b&level=P0&type=defect&feature=F7&domain=d1')).toEqual({
      name: 'problems', tab: 'list', filters: { q: 'a b', level: 'P0', type: 'defect', feature: 'F7', domain: 'd1' }, view: 'technical',
    });
    const body = { name: 'problems' as const, tab: 'remedies' as const, filters: { q: 'a b/c?', domain: 'd1', level: 'P0', type: 'defect', feature: 'F7' } };
    expect(routeHash(body, null)).toBe('#/problems/remedies?domain=d1&feature=F7&type=defect&level=P0&q=a%20b%2Fc%3F');
    expect(routeHash(body, 'product')).toBe('#/product/problems/remedies?domain=d1&feature=F7&type=defect&level=P0&q=a%20b%2Fc%3F');
    for (const hash of ['#/problems', '#/technical/problems/remedies?feature=F7', '#/problems?q=x%26y%3Dz']) {
      const parsed = parseHash(hash);
      expect(routeHash(parsed as never, 'view' in parsed && parsed.view !== undefined ? parsed.view : null)).toBe(hash);
    }
  });

  it('ignores an unknown key, an empty value, an undecodable one and a second value, and writes no empty value', () => {
    expect(parseHash('#/problems?x=1&domain=&feature=%E0%A4%A&type=defect&type=design&level')).toEqual({ name: 'problems', tab: 'list', filters: { type: 'defect' } });
    expect(routeHash({ name: 'problems', tab: 'list', filters: { domain: '', q: undefined } }, null)).toBe('#/problems');
  });

  it('makes a query on any other route, and a deeper problems path, not found', () => {
    for (const hash of ['#/?domain=d1', '#/chapter/F1?x=1', '#/history?q=a', '#/domain/d1?q=a', '#/problems/remedies/x', '#/problems/other']) expect(parseHash(hash).name, hash).toBe('not-found');
  });

  it('makes the link with and without the view, and keeps tab and filters when the view is switched', () => {
    expect(makeLinks(null).problems()).toBe('#/problems');
    expect(makeLinks('technical').problems({ feature: 'F7' }, 'remedies')).toBe('#/technical/problems/remedies?feature=F7');
    const page = data();
    const route = parseHash('#/product/problems/remedies?level=P0');
    expect(viewOf(page, route, 'c')).toBe('product');
    expect(viewOf(page, parseHash('#/technical/problems'), 'c')).toBe('technical');
    expect(viewOf(data({ views: ['product'] }), parseHash('#/technical/problems'), 'c')).toBeNull();
    expect(switchTarget(page, route, 'technical', 'c')).toBe('#/technical/problems/remedies?level=P0');
  });

  it('titles the document with the fixed text', () => {
    expect(documentTitle(data(), parseHash('#/product/problems'))).toBe(`${t('page.problems.title')} - ${d('Handbook')}`);
  });
});

describe('the table and its order', () => {
  it('lists defects, then design problems, then open questions, each by level and then by original order', () => {
    expect(ids(render(data(), '#/product/problems'))).toEqual(['d2', 'd3', 'd1', 'r2', 'r1', 'q1', 'q2']);
    expect(sortRows([row('a', { level: 'P1' }), design('b', { level: 'high' }), row('c', { level: 'P1' }), row('e', { level: 'P0' })]).map((one) => one.id)).toEqual(['e', 'a', 'c', 'b']);
  });

  it('shows the summary, the first feature with a count of the others, and the type with its level', () => {
    const html = decode(render(data(), '#/product/problems'));
    const first = html.slice(html.indexOf('data-problem="d2"'), html.indexOf('data-problem="d3"'));
    expect(first).toContain(d('summary d2'));
    expect(first).toContain(`${d('Orders')}<span class="prob-more">${t('page.problems.moreFeatures', { count: 1 })}</span>`);
    expect(first).toContain(`${t('page.problems.type.defect')}<span class="prob-level" data-level="P0">P0</span>`);
    expect(first).toContain('aria-expanded="false"');
    const impact = html.slice(html.indexOf('data-problem="r2"'), html.indexOf('data-problem="r1"'));
    expect(impact).toContain(`data-level="high">${t('chapter.review.impact.high')}</span>`);
    const system = html.slice(html.indexOf('data-problem="q1"'), html.indexOf('data-problem="q2"'));
    expect(system).toContain(t('page.nav.system'));
    expect(system).not.toContain('prob-level');
  });

  it('shows the fixed text when no row passes the filters', () => {
    const html = render(data(), '#/problems?feature=F9');
    expect(decode(html)).toContain(t('page.problems.noRows'));
    expect(ids(html)).toEqual([]);
  });
});

describe('the filters opened from the address', () => {
  const at = (hash: string): string[] => ids(render(data(), hash));
  it('each filter alone', () => {
    expect(at('#/problems?type=design')).toEqual(['r2', 'r1']);
    expect(at('#/problems?level=P0')).toEqual(['d2']);
    expect(at('#/problems?level=low')).toEqual(['r1']);
    expect(at('#/problems?feature=system')).toEqual(['q1']);
    expect(at('#/problems?q=text%20d3')).toEqual(['d3']);
    expect(at('#/problems?q=TECH%20SITUATION%20R2')).toEqual([]);
    expect(at('#/technical/problems?q=TECH%20SITUATION%20R2')).toEqual(['r2']);
    expect(at('#/problems?q=consequence%20r1')).toEqual(['r1']);
    expect(at('#/problems?q=SUMMARY%20D1')).toEqual(['d1']);
  });

  it('a domain matches a row with any feature in it, and the system is in no domain', () => {
    const page = pageData({ domains: domainData().domains, problems: problems(), outline: domainData().outline, chapters: domainData().chapters });
    const groups = groupsOf(page);
    const only = groups.find((group) => group.features.some((item) => item.block === 'F1'));
    expect(only).toBeDefined();
    const html = render(page, `#/product/problems?domain=${only?.id}`);
    expect(ids(html)).toContain('d2');
    expect(ids(html)).not.toContain('q1');
  });

  it('a defect of two features is visible under either one', () => {
    expect(at('#/problems?feature=F1&type=defect')).toEqual(['d2', 'd1']);
    expect(at('#/problems?feature=F2&type=defect')).toEqual(['d2', 'd3']);
  });

  it('a value the data does not know matches nothing and is shown as written', () => {
    const html = render(data(), '#/problems?type=nothing');
    expect(ids(html)).toEqual([]);
  });

  it('the counts follow the filters: defects by P level, design problems by impact, open questions in total', () => {
    const all = render(data(), '#/problems');
    expect(counts(all, 'defect')).toBe(`${t('page.problems.type.defect')} P0 1 P1 1 P2 1`);
    expect(counts(all, 'design')).toBe(`${t('page.problems.type.design')} ${t('chapter.review.impact.high')} 1 ${t('chapter.review.impact.medium')} 0 ${t('chapter.review.impact.low')} 1`);
    expect(counts(all, 'open')).toBe(`${t('page.problems.type.open')} 2`);
    const filtered = render(data(), '#/problems?feature=F2');
    expect(counts(filtered, 'defect')).toBe(`${t('page.problems.type.defect')} P0 1 P1 1 P2 0`);
    expect(counts(filtered, 'open')).toBe(`${t('page.problems.type.open')} 1`);
    expect(decode(filtered)).toContain(t('page.problems.status', { shown: 4, total: 7 }));
  });
});

describe('the lines for the state of each source', () => {
  const sources = (defects: string, designState: string, openState: string, unmatched: string[] = []) => problems({
    rows: [],
    sources: {
      defects: { state: defects as 'ok', count: defects === 'ok' ? 0 : null },
      design: { state: designState as 'ok', count: designState === 'ok' ? 0 : null },
      open: { state: openState as 'ok', count: openState === 'ok' ? 0 : null, unmatched },
    },
  });
  it('writes one line for each source that is not usable, with the count as its state word, not 0', () => {
    const html = decode(render(data({ problems: sources('missing', 'failed', 'changed') }), '#/problems'));
    expect(html).toContain(t('page.problems.state.missing', { source: t('page.problems.type.defect') }));
    expect(html).toContain(t('page.problems.state.failed', { source: t('page.problems.type.design') }));
    expect(html).toContain(t('page.problems.state.changed', { source: t('page.problems.type.open') }));
    expect(counts(html, 'defect')).toBe(`${t('page.problems.type.defect')} ${t('page.problems.count.missing')}`);
    expect(counts(html, 'design')).toBe(`${t('page.problems.type.design')} ${t('page.problems.count.failed')}`);
    expect(counts(html, 'open')).toBe(`${t('page.problems.type.open')} ${t('page.problems.count.changed')}`);
  });

  it('writes no state line when every source is usable', () => {
    expect(render(data(), '#/problems')).not.toContain('prob-state');
  });

  it('writes the unmatched line with the number of chapters and the fixed heading, and never a bare 0', () => {
    const html = decode(render(data({ problems: sources('ok', 'ok', 'ok', ['F1', 'F2']) }), '#/problems'));
    expect(html).toContain(t('page.problems.unmatched', { count: 2, heading: t('chapter.openQuestions') }));
    expect(counts(html, 'open')).toBe(`${t('page.problems.type.open')} 0 ${t('page.problems.count.incomplete')}`);
  });
});

describe('the expanded rows', () => {
  const expanded = async (page: PageData, hash: string, id: string): Promise<HTMLElement> => {
    window.history.replaceState(null, '', hash);
    const host = mount(<AppView data={page} route={parseHash(hash)} />);
    const button = host.querySelector(`[data-problem="${id}"] button`) as HTMLElement;
    act(() => button.click());
    return host.querySelector(`[data-problem="${id}"]`) as HTMLElement;
  };

  it('a defect shows its text in the view, the category as written, every feature as a link and the remedy link', async () => {
    const product = await expanded(data(), '#/product/problems', 'd2');
    expect(product.querySelector('button')?.getAttribute('aria-expanded')).toBe('true');
    expect(product.textContent).toContain(d('product text d2'));
    expect(product.textContent).not.toContain('technical text');
    expect(product.querySelector('[data-field="group"]')?.textContent).toContain(`${t('page.problems.field.category')} security`);
    expect(Array.from(product.querySelectorAll('[data-field="features"] a')).map((a) => [a.textContent, a.getAttribute('href')])).toEqual([[d('Orders'), '#/product/chapter/F1'], [d('Reminders'), '#/product/chapter/F2']]);
    expect(product.querySelector('[data-part="remedy-link"]')?.getAttribute('href')).toBe('#/product/problems/remedies');
    cleanup();
    const technical = await expanded(data(), '#/technical/problems', 'd2');
    expect(technical.textContent).toContain(d('technical text d2'));
    expect(technical.querySelector('[data-part="citation"]')?.getAttribute('title')).toBe('src/a.js:3-5');
  });

  it('a defect without a remedy says so; an open question shows neither the remedy nor the line', async () => {
    const none = await expanded(data(), '#/product/problems', 'd1');
    expect(none.querySelector('[data-part="remedy-link"]')).toBeNull();
    expect(none.querySelector('[data-field="remedy"]')?.textContent).toBe(t('page.problems.noRemedy'));
    cleanup();
    const question = await expanded(data(), '#/product/problems', 'q1');
    expect(question.querySelector('[data-field="remedy"]')).toBeNull();
    expect(question.querySelector('[data-field="group"]')).toBeNull();
    expect(question.textContent).toContain(d('open text q1'));
    expect(question.querySelector('[data-field="features"] a')?.textContent).toBe(t('page.nav.system'));
  });

  it('a design problem shows situation and consequence with their labels and the dimension; cites only in the technical view', async () => {
    const product = await expanded(data(), '#/product/problems', 'r2');
    expect(product.textContent).toContain(`${t('chapter.review.field.situation')}${d('situation r2')}`);
    expect(product.textContent).toContain(`${t('chapter.review.field.consequence')}${d('consequence r2')}`);
    expect(product.querySelector('[data-field="group"]')?.textContent).toContain(t('chapter.review.dimension.duplication'));
    expect(product.querySelector('[data-part="problem-cites"]')).toBeNull();
    expect(product.querySelector('[data-part="remedy-link"]')).not.toBeNull();
    cleanup();
    const technical = await expanded(data(), '#/technical/problems', 'r2');
    expect(technical.textContent).toContain(d('tech situation r2'));
    expect(Array.from(technical.querySelectorAll('[data-part="problem-cites"] [data-part="citation"]')).map((cite) => cite.getAttribute('title'))).toEqual(['src/x.js:10-12', 'src/y.js:2']);
  });

  it('toggles a row open and closed in place', async () => {
    const one = await expanded(data(), '#/product/problems', 'd1');
    expect(one.querySelector('[data-part="problem-detail"]')).not.toBeNull();
    act(() => (one.querySelector('button') as HTMLElement).click());
    expect(one.querySelector('[data-part="problem-detail"]')).toBeNull();
  });
});

describe('the filter controls write the address', () => {
  it('a text and a select change the rows and the fragment, and a level of another type clears the type', async () => {
    window.history.replaceState(null, '', '#/product/problems?type=design');
    const host = mount(<AppView data={data()} route={parseHash('#/product/problems?type=design')} />);
    expect(Array.from(host.querySelectorAll('[data-problem]')).map((one) => one.getAttribute('data-problem'))).toEqual(['r2', 'r1']);
    await choose(host, t('page.problems.filter.level'), 'P0');
    expect(window.location.hash).toBe('#/product/problems?level=P0');
    expect(Array.from(host.querySelectorAll('[data-problem]')).map((one) => one.getAttribute('data-problem'))).toEqual(['d2']);
    typeInto(host.querySelector('input[type="search"]') as HTMLInputElement, 'summary d');
    expect(window.location.hash).toBe('#/product/problems?level=P0&q=summary%20d');
  });
});

describe('the route follows the filters', () => {
  // A browser fires no hashchange for history.replaceState, so an address written that way never reaches the route and the view
  // switch keeps the old filters. happy-dom fires one anyway, so the test also holds that the page does not write the address so.
  it('a filter change reaches the route: written without replaceState, the view switch carries it, no scroll to the top', async () => {
    window.history.replaceState(null, '', '#/product/problems');
    const scrolls: number[] = [];
    const replaced: unknown[] = [];
    const originalScroll = window.scrollTo;
    const originalReplace = window.history.replaceState.bind(window.history);
    window.scrollTo = ((x: number) => { scrolls.push(x); }) as typeof window.scrollTo;
    try {
      const host = mount(<App data={data()} />);
      const before = scrolls.length;
      window.history.replaceState = ((...args: Parameters<History['replaceState']>) => { replaced.push(args[2]); originalReplace(...args); }) as History['replaceState'];
      await choose(host, t('page.problems.filter.type'), t('page.problems.type.design'));
      await act(async () => { await new Promise((done) => { setTimeout(done, 0); }); });
      expect(replaced).toEqual([]);
      expect(window.location.hash).toBe('#/product/problems?type=design');
      expect(host.querySelector('[data-view-link="technical"]')?.getAttribute('href')).toBe('#/technical/problems?type=design');
      expect(scrolls.length).toBe(before);
    } finally {
      window.scrollTo = originalScroll;
      window.history.replaceState = originalReplace;
    }
  });

  it('places a problems route without its filters, and every other route as it is', () => {
    expect(placeOf(parseHash('#/problems?type=design'))).toBe(placeOf(parseHash('#/problems?level=P0')));
    expect(placeOf(parseHash('#/problems'))).not.toBe(placeOf(parseHash('#/problems/remedies')));
    expect(placeOf(parseHash('#/chapter/F1'))).not.toBe(placeOf(parseHash('#/chapter/F2')));
  });
});

describe('the remedies tab', () => {
  it('shows the remedies chapter with the tab selected and the list tab link carrying the filters', () => {
    const html = render(data(), '#/product/problems/remedies?level=P0');
    expect(html).toContain('data-chapter="remedies"');
    expect(html).toContain(d('fix secrets'));
    expect(html).not.toContain('data-problem=');
    expect(html).toContain('aria-selected="true" data-tab="remedies"');
    expect(html).toContain('href="#/product/problems?level=P0"');
  });

  it('numbers the headings of the chapter so a remedy link can jump to one', () => {
    window.history.replaceState(null, '', '#/product/problems/remedies');
    const host = mount(<AppView data={data()} route={parseHash('#/product/problems/remedies')} />);
    expect(host.querySelector('[data-chapter="remedies"] #h-1')?.textContent).toBe(d('Duplication'));
  });

  it('says there is no remedies chapter when the data has none', () => {
    for (const page of [data({ problems: problems({ remedies: null }), remedies: false }), data({ remedies: false })]) {
      const html = decode(render(page, '#/problems/remedies'));
      expect(html).toContain(t('page.problems.noRemediesChapter'));
      expect(html).not.toContain('data-chapter="remedies"');
    }
  });
});

describe('the chapters that are not reference pages any more', () => {
  const page = data();
  const flat = (): string[] => referencesOf(page, 'product', 'c', 's').flatMap((group) => group.items.map((item) => item.block));
  it('leaves defects, review and remedies out of the pages and the references, and keeps the others', () => {
    for (const view of ['product', 'technical'] as const) {
      expect(pagesOf(page, view, 'c').map((item) => item.block)).toEqual(view === 'technical' ? ['system', 'F1', 'F2', 'data', 'dictionaries', 'history', 'coverage'] : ['system', 'F1', 'F2', 'history', 'coverage']);
    }
    // The feature chapters are in the groups, not in the references.
    expect(flat()).toEqual(['system', 'history', 'coverage']);
    expect(render(page, '#/chapter/defects')).toContain(fixed('page.notFound.heading'));
  });

  it('sends a search result of the remedies chapter to the remedies tab, and the others where they were', () => {
    const items = [
      { kind: 'chapter' as const, title: 'Remedies', chapter: 'remedies', domain: null, heading: null, level: null },
      { kind: 'heading' as const, title: 'Duplication', chapter: 'remedies', domain: null, heading: 1, level: 2 as const },
    ];
    const results = searchResults({ query: 'dup', groups: [], items, references: [], referencesLabel: 'r', domainsLabel: 'd', systemTitle: 's' });
    expect(results.map((result) => result.target)).toEqual([{ kind: 'heading', chapter: 'remedies', heading: 1 }]);
  });
});

describe('the search dialog', () => {
  it('goes to the remedies tab of the problems page for a remedies heading, and still to the chapter for another one', () => {
    const page = { ...data(), search: [
      { kind: 'chapter' as const, title: 'Remedies', chapter: 'remedies', domain: null, heading: null, level: null },
      { kind: 'heading' as const, title: 'Duplication of work', chapter: 'remedies', domain: null, heading: 1, level: 2 as const },
      { kind: 'chapter' as const, title: 'Orders', chapter: 'F1', domain: null, heading: null, level: null },
      { kind: 'heading' as const, title: 'Duplication in orders', chapter: 'F1', domain: null, heading: 0, level: 2 as const },
    ] };
    const host = mount(<AppView data={page} route={parseHash('#/product/problems')} />);
    const choose = (title: string): void => {
      act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true })); });
      typeInto(document.querySelector('[role="dialog"] input') as HTMLInputElement, title);
      const option = Array.from(document.querySelectorAll('[role="option"]')).find((one) => one.querySelector('.search-title')?.textContent === title) as HTMLElement;
      act(() => option.click());
    };
    choose('Duplication of work');
    expect(window.location.hash).toBe('#/product/problems/remedies');
    choose('Duplication in orders');
    expect(window.location.hash).toBe('#/product/chapter/F1');
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe('the NO_PROBLEMS page', () => {
  it('shows no row and counts of 0 for a page with no problem rows', () => {
    const html = render(pageData(), '#/problems');
    expect(ids(html)).toEqual([]);
    expect(counts(html, 'defect')).toBe(`${t('page.problems.type.defect')} P0 0 P1 0 P2 0`);
    expect(NO_PROBLEMS.rows).toEqual([]);
  });
});

