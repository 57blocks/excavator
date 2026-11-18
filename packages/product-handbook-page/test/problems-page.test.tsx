// @vitest-environment happy-dom
// Task 3.1 and 3.2 of openspec change handbook-page-structure: the route of the problems page, its table and order, its filters (also from
// the address), its counts, its expanded rows, the lines for the state of each source, the improvement suggestions page, and the chapters that are no
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

import { groupRows, sortRows } from '../src/lib/problems';
import { searchResults } from '../src/lib/search';
import type { Outline, PageData, ProblemRow, ProblemsData } from '../src/lib/types';
import { cleanup, mount, choose, moveAndConfirm, openWithKeyboard, optionTexts, selectByLabel, typeInto } from './dom';
import { domainData } from './domains-fixture';
import { BOTH, MARK, NO_PROBLEMS, chapter, d, marked, outlineOf, pageData } from './page-fixture';

afterEach(() => { cleanup(); window.history.replaceState(null, '', '#'); });
beforeEach(() => { window.history.replaceState(null, '', '#'); });

const row = (id: string, over: Partial<ProblemRow> = {}): ProblemRow => ({
  id, type: 'defect', level: 'P1', group: 'security', features: ['F1'], summary: d(`summary ${id}`),
  texts: { product: d(`product text ${id}`), technical: `${d(`technical text ${id}`)} \`src/a.js:3-5\`` },
  source: { chapter: 'defects', line: 4 }, remedies: [], ...over,
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
  row('d2', { level: 'P0', features: ['F1', 'F2'], remedies: [{ heading: d('Security'), anchor: 'h-1' }] }),
  row('d3', { level: 'P1', features: ['F2'] }),
  design('r1', { level: 'low' }),
  design('r2', { level: 'high', features: ['F2'], remedies: [{ heading: d('Duplication'), anchor: 'h-0' }] }),
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
  it('parses the page and its filters, with and without the view prefix, and builds them back in a fixed key order', () => {
    expect(parseHash('#/problems')).toEqual({ name: 'problems', filters: {} });
    expect(parseHash('#/technical/problems?q=a%20b&level=P0&type=defect&feature=F7&domain=d1')).toEqual({
      name: 'problems', filters: { q: 'a b', level: 'P0', type: 'defect', feature: 'F7', domain: 'd1' }, view: 'technical',
    });
    const body = { name: 'problems' as const, filters: { q: 'a b/c?', domain: 'd1', level: 'P0', type: 'defect', feature: 'F7' } };
    expect(routeHash(body, null)).toBe('#/problems?domain=d1&feature=F7&type=defect&level=P0&q=a%20b%2Fc%3F');
    expect(routeHash(body, 'product')).toBe('#/product/problems?domain=d1&feature=F7&type=defect&level=P0&q=a%20b%2Fc%3F');
    for (const hash of ['#/problems', '#/problems?feature=F7', '#/remedies', '#/technical/remedies', '#/problems?q=x%26y%3Dz']) {
      const parsed = parseHash(hash);
      expect(routeHash(parsed as never, 'view' in parsed && parsed.view !== undefined ? parsed.view : null)).toBe(hash);
    }
  });

  it('ignores an unknown key, an empty value, an undecodable one and a second value, and writes no empty value', () => {
    expect(parseHash('#/problems?x=1&domain=&feature=%E0%A4%A&type=defect&type=design&level')).toEqual({ name: 'problems', filters: { type: 'defect' } });
    expect(routeHash({ name: 'problems', filters: { domain: '', q: undefined } }, null)).toBe('#/problems');
  });

  it('parses the remedies route, with and without the view, and the old problems/remedies address to it (its query ignored)', () => {
    expect(parseHash('#/remedies')).toEqual({ name: 'remedies' });
    expect(parseHash('#/product/remedies')).toEqual({ name: 'remedies', view: 'product' });
    for (const hash of ['#/problems/remedies', '#/problems/remedies?level=P0&q=x', '#/technical/problems/remedies?feature=F7']) {
      const parsed = parseHash(hash);
      expect(parsed.name, hash).toBe('remedies');
      expect(Object.keys(parsed).filter((key) => key !== 'view' && key !== 'name'), hash).toEqual([]);
    }
    expect(parseHash('#/technical/problems/remedies').view).toBe('technical');
    expect(routeHash({ name: 'remedies' }, null)).toBe('#/remedies');
    expect(routeHash({ name: 'remedies' }, 'product')).toBe('#/product/remedies');
    expect(routeHash(parseHash('#/problems/remedies?level=P0') as never, null)).toBe('#/remedies');
    expect(routeHash({ name: 'problems', filters: { level: 'P0' } }, 'technical')).not.toContain('remedies');
    expect(parseHash('#/remedies?x=1').name).toBe('not-found');
  });

  it('makes a query on any other route, and a deeper problems path, not found', () => {
    for (const hash of ['#/?domain=d1', '#/chapter/F1?x=1', '#/history?q=a', '#/domain/d1?q=a', '#/problems/remedies/x', '#/problems/other', '#/remedies/x']) expect(parseHash(hash).name, hash).toBe('not-found');
  });

  it('makes the links with and without the view, and keeps the filters when the view is switched', () => {
    expect(makeLinks(null).problems()).toBe('#/problems');
    expect(makeLinks(null).remedies).toBe('#/remedies');
    expect(makeLinks('technical').remedies).toBe('#/technical/remedies');
    expect(makeLinks('technical').problems({ feature: 'F7' })).toBe('#/technical/problems?feature=F7');
    const page = data();
    const route = parseHash('#/product/problems?level=P0');
    expect(viewOf(page, route, 'c')).toBe('product');
    expect(viewOf(page, parseHash('#/remedies'), 'c')).toBe('product');
    expect(viewOf(page, parseHash('#/technical/remedies'), 'c')).toBe('technical');
    expect(switchTarget(page, parseHash('#/product/remedies'), 'technical', 'c')).toBe('#/technical/remedies');
    expect(viewOf(page, parseHash('#/technical/problems'), 'c')).toBe('technical');
    expect(viewOf(data({ views: ['product'] }), parseHash('#/technical/problems'), 'c')).toBeNull();
    expect(switchTarget(page, route, 'technical', 'c')).toBe('#/technical/problems?level=P0');
  });

  it('titles the document with the fixed text', () => {
    expect(documentTitle(data(), parseHash('#/product/problems'))).toBe(`${t('page.problems.title')} - ${d('Handbook')}`);
    expect(documentTitle(data(), parseHash('#/product/remedies'))).toBe(`${t('page.nav.remedies')} - ${d('Handbook')}`);
  });
});

describe('the table and its order', () => {
  it('lists defects, then design problems, then open questions, each by level and then by original order, within each group', () => {
    // The features of these rows are in no domain of the page: one group, every row shown.
    expect(ids(render(data(), '#/product/problems?feature=F2'))).toEqual(['d2', 'd3', 'r2', 'q2']);
    expect(ids(render(data(), '#/product/problems'))).toEqual(['q1', 'd2', 'd3', 'd1']);
    expect(sortRows([row('a', { level: 'P1' }), design('b', { level: 'high' }), row('c', { level: 'P1' }), row('e', { level: 'P0' })]).map((one) => one.id)).toEqual(['e', 'a', 'c', 'b']);
  });

  it('shows the summary, the first feature with a count of the others, and the type with its level', () => {
    const html = decode(render(data(), '#/product/problems?row=r1'));
    const rowOf = (id: string): string => { const start = html.indexOf(`data-problem="${id}"`); return html.slice(start, html.indexOf('</button>', start)); };
    const first = rowOf('d2');
    expect(first).toContain(d('summary d2'));
    expect(first).toContain(`${d('Orders')}<span class="prob-more">${t('page.problems.moreFeatures', { count: 1 })}</span>`);
    expect(first).toContain(`${t('page.problems.type.defect')}<span class="prob-level" data-level="P0">P0</span>`);
    expect(first).toContain('aria-expanded="false"');
    const impact = rowOf('r2');
    expect(impact).toContain(`data-level="high">${t('chapter.review.impact.high')}</span>`);
    const system = rowOf('q1');
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

  it('the domain filter has a system-level choice, shown by its label, that keeps the rows that name the system chapter', () => {
    const page = pageData({ domains: domainData().domains, problems: problems(), outline: domainData().outline, chapters: domainData().chapters });
    const html = render(page, '#/product/problems?domain=system');
    expect(ids(html)).toEqual(['q1']);
    // The select shows the chosen value by its label, not by the value written in the address.
    const domainField = (text: string): string => text.slice(text.indexOf('data-filter="domain"'), text.indexOf('data-filter="feature"'));
    expect(domainField(html)).toContain(marked['page.problems.filter.systemLevel']);
    expect(domainField(render(page, '#/product/problems'))).not.toContain(marked['page.problems.filter.systemLevel']);
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
    // A row past the first rows of its group is behind the row that unfolds the group.
    for (const more of Array.from(host.querySelectorAll<HTMLButtonElement>('[data-part="problem-group-more"]'))) act(() => more.click());
    const button = host.querySelector(`[data-problem="${id}"] button`) as HTMLElement;
    act(() => button.click());
    return host.querySelector(`[data-problem="${id}"]`) as HTMLElement;
  };

  it('a defect shows its text in the view, the category as written, every feature as a link and the remedy link', async () => {
    const product = await expanded(data(), '#/product/problems', 'd2');
    expect(product.querySelector('button')?.getAttribute('aria-expanded')).toBe('true');
    expect(product.textContent).toContain(d('product text d2'));
    expect(product.textContent).not.toContain('technical text');
    expect(product.querySelector('[data-field="group"]')?.textContent).toContain(`${t('page.problems.field.category')} ${t('page.defects.category.security')}`);
    expect(Array.from(product.querySelectorAll('[data-field="features"] a')).map((a) => [a.textContent, a.getAttribute('href')])).toEqual([[d('Orders'), '#/product/chapter/F1'], [d('Reminders'), '#/product/chapter/F2']]);
    expect(product.querySelector('[data-part="remedy-link"]')?.getAttribute('href')).toBe('#/product/remedies');
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
  it('the system level is the first choice of the domain filter, right after all, and choosing it writes the address', async () => {
    window.history.replaceState(null, '', '#/product/problems');
    const page = pageData({ domains: domainData().domains, problems: problems(), outline: domainData().outline, chapters: domainData().chapters });
    const host = mount(<AppView data={page} route={parseHash('#/product/problems')} />);
    await openWithKeyboard(selectByLabel(host, t('page.problems.filter.domain')));
    const options = optionTexts();
    expect(options.slice(0, 2)).toEqual([t('page.problems.filter.all'), t('page.problems.filter.systemLevel')]);
    expect(options.filter((option) => option === t('page.problems.filter.systemLevel'))).toHaveLength(1);
    await moveAndConfirm(1);
    expect(window.location.hash).toBe('#/product/problems?domain=system');
  });

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
    expect(placeOf(parseHash('#/problems'))).not.toBe(placeOf(parseHash('#/remedies')));
    expect(placeOf(parseHash('#/chapter/F1'))).not.toBe(placeOf(parseHash('#/chapter/F2')));
  });
});

describe('the problems page has no tabs', () => {
  it('has no tablist and no tabpanel, and keeps its notices, counts, filters and list', () => {
    const host = mount(<AppView data={data()} route={parseHash('#/product/problems')} />);
    expect(host.querySelector('[role="tablist"], [role="tab"], [role="tabpanel"], .ptabs')).toBeNull();
    expect(host.querySelector('.problems-page')?.getAttribute('data-tab')).toBeNull();
    expect(host.querySelector('[data-part="problem-counts"]')).not.toBeNull();
    expect(host.querySelector('[data-part="problem-filters"]')).not.toBeNull();
    expect(host.querySelector('[data-part="problem-table"]')).not.toBeNull();
  });
});

describe('the improvement suggestions page', () => {
  const mounted = (page: PageData, hash: string): HTMLElement => {
    window.history.replaceState(null, '', hash);
    return mount(<AppView data={page} route={parseHash(hash)} />);
  };

  it('has the fixed title once, no title of the chapter, the sections of the chapter and the table of contents', () => {
    const host = mounted(data(), '#/product/remedies');
    const page = host.querySelector('[data-view="remedies"]') as HTMLElement;
    expect(page).not.toBeNull();
    expect(Array.from(page.querySelectorAll('h1')).map((h) => h.textContent)).toEqual([t('page.nav.remedies')]);
    expect(page.textContent).not.toContain(d('Remedies'));
    expect(page.querySelector('[data-chapter="remedies"]')).not.toBeNull();
    expect(page.textContent).toContain(d('fix secrets'));
    expect(page.querySelector('[data-chapter="remedies"] #h-0')?.textContent).toBe(d('Security'));
    expect(page.querySelector('[data-chapter="remedies"] #h-1')?.textContent).toBe(d('Duplication'));
    expect(Array.from(page.querySelectorAll('.crumbs a, .crumbs span:not(.sep)')).map((e) => e.textContent)).toEqual([t('page.nav.overview'), t('page.nav.remedies')]);
    const toc = page.querySelector('.toc, [data-part="toc"], nav.toc');
    expect(toc, 'a table of contents').not.toBeNull();
    expect(toc?.textContent).toContain(d('Duplication'));
    expect(page.querySelector('[data-part="prev-next"], .prevnext, nav[aria-label="Previous and next"]')).toBeNull();
    expect(page.getAttribute('data-toc')).toBe('yes');
  });

  it('is in every view, and marks its entry in the global left list', () => {
    for (const view of ['product', 'technical'] as const) {
      const host = mounted(data(), `#/${view}/remedies`);
      expect(host.querySelector('[data-view="remedies"]')).not.toBeNull();
      expect(host.querySelector('.side [aria-current="page"]')?.getAttribute('data-nav')).toBe('remedies');
      expect(host.querySelector('.frame')?.getAttribute('data-side')).toBe('global');
      cleanup();
    }
  });

  it('answers the old problems/remedies address too', () => {
    expect(render(data(), '#/product/problems/remedies?level=P0')).toContain('data-view="remedies"');
  });

  it('says there is no chapter of improvement suggestions when the data has none, and shows no table of contents', () => {
    for (const page of [data({ problems: problems({ remedies: null }), remedies: false }), data({ remedies: false })]) {
      const html = decode(render(page, '#/remedies'));
      expect(html).toContain('data-part="no-remedies"');
      expect(html).toContain(t('page.problems.noRemediesChapter'));
      expect(html).toContain(`<h1 class="page-title">${t('page.nav.remedies')}</h1>`);
      expect(html).not.toContain('data-chapter="remedies"');
      expect(html).toContain('data-toc="none"');
    }
  });

  it('is reached from a row remedy link of the problems page, and opens at that section', async () => {
    window.history.replaceState(null, '', '#/product/problems');
    const scrolled: string[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function scrollIntoViewStub(this: Element) { scrolled.push(this.id); } as typeof Element.prototype.scrollIntoView;
    try {
      const host = mount(<App data={data()} />);
      act(() => (host.querySelector('[data-problem="d2"] button') as HTMLElement).click());
      const link = host.querySelector('[data-problem="d2"] [data-part="remedy-link"]') as HTMLAnchorElement;
      expect(link.getAttribute('href')).toBe('#/product/remedies');
      act(() => link.click());
      // A click on an anchor navigates in a browser; happy-dom does not, so follow the link the way the browser would.
      await act(async () => { window.location.hash = link.getAttribute('href') as string; await new Promise((done) => { setTimeout(done, 50); }); });
      expect(host.querySelector('[data-view="remedies"]')).not.toBeNull();
      expect(host.querySelector('[data-view="problems"]')).toBeNull();
      expect(scrolled).toContain('h-1');
      expect(document.activeElement?.id).toBe('h-1');
    } finally {
      Element.prototype.scrollIntoView = original;
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

  it('keeps a search result of the remedies chapter, and the others where they were', () => {
    const items = [
      { kind: 'chapter' as const, title: 'Remedies', chapter: 'remedies', domain: null, heading: null, level: null },
      { kind: 'heading' as const, title: 'Duplication', chapter: 'remedies', domain: null, heading: 1, level: 2 as const },
    ];
    const results = searchResults({ query: 'dup', groups: [], items, references: [], domainsLabel: 'd', systemTitle: 's' });
    expect(results.map((result) => result.target)).toEqual([{ kind: 'heading', chapter: 'remedies', heading: 1 }]);
  });
});

describe('the search dialog', () => {
  it('goes to the improvement suggestions page for a remedies heading, and still to the chapter for another one', () => {
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
    expect(window.location.hash).toBe('#/product/remedies');
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


describe('the colours of the levels', () => {
  it('gives each of the three levels its own text colour and tint, the same for a defect level and a design impact, on badges and count chips, in both themes', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const css = readFileSync(join(__dirname, '../src/index.css'), 'utf-8');
    const tiers: [string, string][] = [['P0', 'high'], ['P1', 'medium'], ['P2', 'low']];
    tiers.forEach(([defect, impact], at) => {
      const n = at + 1;
      expect(css).toContain(`:is(.lvl, .prob-level, .stat-chip):is([data-level="${defect}"], [data-level="${impact}"]) { color: var(--lv${n}); background: var(--lv${n}-bg); }`);
      expect(css.match(new RegExp(`--lv${n}: #[0-9A-F]{6};`, 'g'))).toHaveLength(2);
      expect(css.match(new RegExp(`--lv${n}-bg: rgba\\(`, 'g'))).toHaveLength(2);
    });
    const values = [1, 2, 3].map((n) => css.match(new RegExp(`--lv${n}: (#[0-9A-F]{6});`))?.[1]);
    expect(new Set(values).size).toBe(3);
  });
});

describe('the list in groups', () => {
  const GROUPED: ProblemRow[] = [
    row('x1', { level: 'P0' }), row('x2', { level: 'P0' }), row('x3', { level: 'P1' }), row('x4', { level: 'P2' }), design('x5', { level: 'low' }),
    row('a1', { level: 'P1', features: ['F1', 'F2'] }),
    row('s1', { level: 'P2', features: ['system'] }), row('s2', { level: 'P2', features: ['system', 'F1'] }), open('s3'), open('s4'),
    row('o1', { level: 'P2', features: ['F9'] }),
    row('b1', { level: 'P1', features: ['F2'] }),
  ];
  const page = (): PageData => pageData({ domains: domainData().domains, outline: domainData().outline, chapters: domainData().chapters, problems: problems({ rows: GROUPED }) });
  const groupsIn = (host: HTMLElement): string[] => Array.from(host.querySelectorAll('[data-part="problem-group"]')).map((one) => one.getAttribute('data-group') ?? '');
  const rowsOf = (host: HTMLElement, key: string): string[] => Array.from(host.querySelectorAll(`[data-group="${key}"] [data-problem]`)).map((one) => one.getAttribute('data-problem') ?? '');
  const more = (host: HTMLElement, key: string): HTMLButtonElement | null => host.querySelector(`[data-group="${key}"] [data-part="problem-group-more"]`);

  it('puts each row in exactly one group: the system level, across domains, each domain in its order, then outside every domain', () => {
    const grouped = groupRows(sortRows(GROUPED), groupsOf(page()));
    expect(grouped.map((group) => group.key)).toEqual(['system', 'across', 'd1', 'd2', 'outside']);
    expect(grouped.flatMap((group) => group.rows.map((one) => one.id)).sort()).toEqual(GROUPED.map((one) => one.id).sort());
    expect(grouped.find((group) => group.key === 'system')?.rows.map((one) => one.id)).toEqual(['s1', 's2', 's3', 's4']);
    expect(grouped.find((group) => group.key === 'd1')?.name).toBe(domainData().domains.list[0].name);
  });

  it('heads each group with its name, its count, its P0 count and a note for the groups that are not a domain, and shows its first three rows', () => {
    const host = mount(<AppView data={page()} route={parseHash('#/product/problems')} />);
    expect(groupsIn(host)).toEqual(['system', 'across', 'd1', 'd2', 'outside']);
    const head = (key: string): HTMLElement => host.querySelector(`[data-group="${key}"] [data-part="problem-group-head"]`) as HTMLElement;
    expect(head('system').textContent).toContain(t('page.problems.filter.systemLevel'));
    expect(head('system').textContent).toContain(t('page.problems.groupNote.system'));
    expect(head('across').textContent).toContain(t('page.problems.group.across'));
    expect(head('outside').textContent).toContain(t('page.problems.group.outside'));
    expect(head('d1').textContent).toContain(domainData().domains.list[0].name);
    expect(head('d1').textContent).toContain(t('page.processes.problemCount', { count: 5 }));
    expect(head('d1').querySelector('[data-level="P0"]')?.textContent).toBe(`P0 2`);
    expect(head('system').querySelector('[data-level="P0"]')).toBeNull();
    expect(rowsOf(host, 'd1')).toEqual(['x1', 'x2', 'x3']);
    expect(more(host, 'd1')?.textContent).toBe(t('page.problems.moreRows', { count: 2 }));
    expect(more(host, 'across')).toBeNull();
    act(() => more(host, 'd1')?.click());
    expect(rowsOf(host, 'd1')).toEqual(['x1', 'x2', 'x3', 'x4', 'x5']);
    expect(more(host, 'd1')).toBeNull();
  });

  it('shows every row when the filters leave one group, and unfolds the group of the row the address names', () => {
    const one = mount(<AppView data={page()} route={parseHash('#/product/problems?domain=system')} />);
    expect(groupsIn(one)).toEqual(['system']);
    expect(rowsOf(one, 'system')).toEqual(['s1', 's2', 's3', 's4']);
    expect(more(one, 'system')).toBeNull();
    cleanup();
    const named = mount(<AppView data={page()} route={parseHash('#/product/problems?row=x5')} />);
    expect(rowsOf(named, 'd1')).toEqual(['x1', 'x2', 'x3', 'x4', 'x5']);
    expect(named.querySelector('[data-problem="x5"] .prob-head')?.getAttribute('aria-expanded')).toBe('true');
    expect(rowsOf(named, 'd2')).toEqual(['b1']);
  });
});
