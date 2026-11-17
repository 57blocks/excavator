// @vitest-environment happy-dom
// The shell of the page (openspec change handbook-page-domain-map, tasks 3.1 to 3.3): the routes, the groups (one per domain
// when the checked list is usable, one per outline part otherwise), the references, the top bar (brand, search, view switch), the
// left list in its two states and the phone menu, the breadcrumbs, previous and next, the view switch, the table of contents and the notices.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';

import { AppView, documentTitle } from '../src/App';
import { flatReferences, groupsOf, referencesOf } from '../src/lib/groups';
import { contextOf, neighbours, switchTarget, viewOf } from '../src/lib/navigation';
import { bodyOf, pageOf, pagesOf } from '../src/lib/pages';
import { parseHash, routeHash } from '../src/lib/route';
import { NEUTRAL, STRATA, domainColours } from '../src/lib/strata';
import { activeIndex, spyLimit, wantsToc } from '../src/lib/toc';
import type { Outline, PageData } from '../src/lib/types';
import { cleanup, mount } from './dom';
import { BOTH, MARK, chapter, d, marked, pageData } from './page-fixture';

afterEach(cleanup);

const COVERAGE = marked['page.nav.coverage'];
const SYSTEM = marked['page.nav.system'];
const render = (data: PageData, hash: string): string => renderToStaticMarkup(<AppView data={data} route={parseHash(hash)} />);
const between = (html: string, from: string, to: string): string => html.slice(html.indexOf(from), html.indexOf(to, html.indexOf(from)));
const side = (html: string): string => between(html, '<nav class="side"', '</nav>');
const frameOf = (html: string): string => /<div class="frame" data-side="([a-z]+)"/.exec(html)?.[1] ?? '';
const hrefs = (html: string): string[] => Array.from(html.matchAll(/<a [^>]*href="([^"]*)"/g), (match) => match[1]);
const texts = (html: string): string[] => Array.from(html.matchAll(/<a [^>]*>(?:<[^>]*>)*([^<]*)(?:<small>[^<]*<\/small>)?<\/a>/g), (match) => match[1]);

/** Two domains in an order that is not the outline's, over the fixture's two features. */
const OK_DOMAINS: PageData['domains'] = {
  state: 'ok',
  list: [
    { id: 'd1', name: d('Support'), features: ['F2'], intro: {}, body: {} },
    { id: 'd2', name: d('Sales'), features: ['F1'], intro: {}, body: {} },
  ],
  handovers: [],
};
const withDomains = (extra: Partial<PageData> = {}): PageData => ({ ...pageData(), domains: OK_DOMAINS, ...extra });

describe('routes', () => {
  it('parses the home page, a domain, a chapter and the pages, with and without the view, and builds them back', () => {
    expect(parseHash('#/')).toEqual({ name: 'home' });
    expect(parseHash('#/domain/d2')).toEqual({ name: 'domain', id: 'd2' });
    expect(parseHash('#/technical/domain/d%202')).toEqual({ name: 'domain', id: 'd 2', view: 'technical' });
    expect(parseHash('#/chapter/F1')).toEqual({ name: 'chapter', id: 'F1' });
    expect(parseHash('#/technical/chapter/F%201')).toEqual({ name: 'chapter', id: 'F 1', view: 'technical' });
    expect(parseHash('#/product/coverage')).toEqual({ name: 'coverage', view: 'product' });
    expect(parseHash('#/history')).toEqual({ name: 'history' });
    expect(parseHash('#/chapter').name).toBe('not-found');
    expect(parseHash('#/domain').name).toBe('not-found');
    expect(parseHash('#/domain/d1/x').name).toBe('not-found');
    expect(parseHash('#/feature/F1').name).toBe('not-found');
    expect(routeHash({ name: 'chapter', id: 'F 1' }, 'product')).toBe('#/product/chapter/F%201');
    expect(routeHash({ name: 'domain', id: 'd1' }, 'technical')).toBe('#/technical/domain/d1');
    expect(routeHash({ name: 'domain', id: 'd1' }, null)).toBe('#/domain/d1');
    expect(routeHash({ name: 'home' }, null)).toBe('#/');
  });

  it('parses the architecture page with and without the view and builds it back', () => {
    expect(parseHash('#/architecture')).toEqual({ name: 'architecture' });
    expect(parseHash('#/technical/architecture')).toEqual({ name: 'architecture', view: 'technical' });
    expect(parseHash('#/technical/architecture/x').name).toBe('not-found');
    expect(parseHash('#/technical/architecture?q=1').name).toBe('not-found');
    expect(routeHash({ name: 'architecture' }, 'technical')).toBe('#/technical/architecture');
    expect(routeHash({ name: 'architecture' }, null)).toBe('#/architecture');
    for (const hash of ['#/architecture', '#/technical/architecture', '#/product/architecture']) {
      const route = parseHash(hash);
      expect(parseHash(routeHash(bodyOf(route), route.view ?? null))).toEqual(route);
    }
  });
});

describe('the groups', () => {
  it('are one per domain, in the domain order, with the feature chapters in the domain order, when the list is usable', () => {
    const groups = groupsOf(withDomains());
    expect(groups.map((group) => [group.id, group.name, group.features.map((item) => item.block)])).toEqual([
      ['d1', d('Support'), ['F2']],
      ['d2', d('Sales'), ['F1']],
    ]);
    expect(groups[0].features[0].title).toBe(d('Reminders'));
  });

  it('keep only the chapters the page has', () => {
    const data = withDomains({ domains: { ...OK_DOMAINS, list: [{ ...OK_DOMAINS.list[0], features: ['F9', 'F2'] }] } });
    expect(groupsOf(data)[0].features.map((item) => item.block)).toEqual(['F2']);
  });

  it('are one per outline part that holds a feature chapter, named by the part, when there is no usable list', () => {
    for (const state of ['missing', 'failed', 'changed'] as const) {
      const groups = groupsOf(pageData({ domains: { state, list: [], handovers: [] } }));
      expect(groups.map((group) => [group.id, group.name, group.features.map((item) => item.block)]), state).toEqual([['d1', d('Features'), ['F1', 'F2']]]);
    }
  });

  it('count d1, d2, ... over the parts that have features only', () => {
    const outline: Outline = {
      source: 'outline', problems: [], unplaced: [],
      parts: [
        { title: d('Intro'), blocks: [{ block: 'system', kind: 'chapter', title: d('System chapter') }] },
        { title: d('First'), blocks: [{ block: 'F1', kind: 'chapter', title: d('Orders') }] },
        { title: d('Second'), blocks: [{ block: 'F2', kind: 'chapter', title: d('Reminders') }, { block: 'history', kind: 'history', title: marked['md.history.heading'] }] },
      ],
    };
    expect(groupsOf(pageData({ outline })).map((group) => [group.id, group.name])).toEqual([['d1', d('First')], ['d2', d('Second')]]);
  });
});

describe('the references', () => {
  const keys = (data: PageData, view: 'product' | 'technical'): string[] => flatReferences(referencesOf(data, view, COVERAGE, SYSTEM)).map((item) => item.key);

  it('are every block that is not a feature chapter, in outline order, the coverage page last; data and dictionaries in the technical view only', () => {
    expect(keys(pageData(), 'technical')).toEqual(['chapter:system', 'data', 'dictionaries', 'history', 'coverage']);
    expect(keys(pageData(), 'product')).toEqual(['chapter:system', 'history', 'coverage']);
  });

  it('take a feature chapter that is in no group, so that nothing is unreachable', () => {
    const data = withDomains({ domains: { ...OK_DOMAINS, list: [OK_DOMAINS.list[1]] } });
    expect(keys(data, 'product')).toEqual(['chapter:system', 'chapter:F2', 'history', 'coverage']);
    expect(groupsOf(data).flatMap((group) => group.features.map((item) => item.block))).toEqual(['F1']);
  });

  it('follow a written outline', () => {
    const outline: Outline = { source: 'outline', problems: [], parts: [{ title: d('Z'), blocks: [{ block: 'topics', kind: 'chapter', title: d('Topics') }, { block: 'F1', kind: 'chapter', title: d('Orders') }, { block: 'roles', kind: 'chapter', title: d('Roles') }] }], unplaced: [] };
    expect(keys(pageData({ outline }), 'product')).toEqual(['chapter:topics', 'chapter:roles', 'coverage']);
  });
});

describe('the top bar', () => {
  it('holds the menu button, the brand (the system name only), the search button and the view switch, and nothing else', () => {
    const html = render(withDomains(), '#/technical/chapter/F1');
    const bar = between(html, '<header', '</header>');
    expect(bar).toContain(`<a class="brand" href="#/technical"><b>${d('System chapter')}</b></a>`);
    expect(bar).not.toContain(d('Technical handbook'));
    expect(bar).toContain(`aria-label="${marked['page.search.open']}"`);
    expect(bar).toContain(`<span>${marked['page.search.open']}</span><kbd`);
    expect(marked['page.search.open']).toBe(`${MARK}Search`);
    const order = ['class="menu-btn"', 'class="brand"', 'class="search-btn"', 'data-part="view-switch"'].map((part) => bar.indexOf(part));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // The bar's links are the brand and the two views; its buttons are the menu and the search.
    expect(hrefs(bar)).toEqual(['#/technical', '#/product/chapter/F1', '#/technical/chapter/F1']);
    expect(Array.from(bar.matchAll(/<button/g))).toHaveLength(2);
    expect(bar).not.toContain('data-nav=');
    expect(bar).not.toContain('class="nav"');
    expect(bar).not.toContain('class="pop');
    expect(bar).not.toContain(marked['page.nav.problems']);
    expect(bar).not.toContain(marked['page.nav.overview']);
  });

  it('names the brand by the view title when there is no system chapter, and has no second line', () => {
    const outline: Outline = { source: 'outline', problems: [], parts: [{ title: d('Features'), blocks: [{ block: 'F1', kind: 'chapter', title: d('Orders') }] }], unplaced: [] };
    const html = render(pageData({ outline }), '#/product');
    expect(between(html, '<a class="brand"', '</a>')).toBe(`<a class="brand" href="#/product"><b>${d('Handbook')}</b>`);
  });

  it('has no search wording of the old long form, and the dialog says Search too', () => {
    expect(marked['page.search.placeholder']).toBe(`${MARK}Search`);
  });

  it('has a skip link to the main region, and the page has the main region', () => {
    const html = render(pageData(), '#/product');
    expect(html).toContain(`<a class="skip" href="#main">${marked['page.skip']}</a>`);
    expect(html).toContain('<main id="main" tabindex="-1">');
  });

  it('calls the search callback from the search button', () => {
    const calls: number[] = [];
    const host = mount(<AppView data={pageData()} route={parseHash('#/product')} onSearch={() => calls.push(1)} />);
    act(() => (host.querySelector('.search-btn') as HTMLElement).click());
    expect(calls).toEqual([1]);
  });
});

describe('the phone menu', () => {
  const open = (data: PageData, hash: string): { host: HTMLElement; menu: HTMLElement; button: HTMLElement } => {
    const host = mount(<AppView data={data} route={parseHash(hash)} />);
    const button = host.querySelector<HTMLElement>('.menu-btn') as HTMLElement;
    act(() => button.click());
    return { host, menu: host.querySelector('#menu') as HTMLElement, button };
  };
  const links = (root: Element): (string | null)[] => Array.from(root.querySelectorAll('a')).map((link) => link.getAttribute('href'));

  it('is behind a button, closed at the start; it closes on Escape and on a click on a link', () => {
    const host = mount(<AppView data={withDomains()} route={parseHash('#/technical/chapter/F1')} />);
    const button = host.querySelector<HTMLElement>('.menu-btn') as HTMLElement;
    expect(host.querySelector('#menu')).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    act(() => button.click());
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelector('#menu')).not.toBeNull();
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(host.querySelector('#menu')).toBeNull();
    act(() => button.click());
    act(() => (host.querySelector('#menu a') as HTMLElement).click());
    expect(host.querySelector('#menu')).toBeNull();
  });

  it('shows the list of the current state: the global list on a page that is not a domain page, with the improvement suggestions entry before the architecture entry in the technical view', () => {
    const data = { ...withDomains(), architecture: { technical: 'Text.' } };
    const { menu } = open(data, '#/technical/data');
    expect(menu.getAttribute('data-side')).toBe('global');
    expect(links(menu)).toEqual(['#/technical', '#/technical/problems', '#/technical/remedies', '#/technical/architecture', '#/technical/chapter/system', '#/technical/data', '#/technical/dictionaries', '#/technical/history', '#/technical/coverage']);
    expect(menu.querySelector('a[aria-current="page"]')?.getAttribute('href')).toBe('#/technical/data');
    expect(menu.querySelector('.side-group')).toBeNull();
  });

  it('shows the domain list on a domain page and on a feature page: the way back, every domain open with its features', () => {
    for (const hash of ['#/technical/domain/d1', '#/technical/chapter/F2']) {
      const { menu } = open(withDomains(), hash);
      expect(menu.getAttribute('data-side'), hash).toBe('domain');
      expect(links(menu), hash).toEqual(['#/technical', '#/technical/domain/d1', '#/technical/chapter/F2', '#/technical/domain/d2', '#/technical/chapter/F1']);
      expect(Array.from(menu.querySelectorAll('details.side-group')).every((one) => (one as HTMLDetailsElement).open), hash).toBe(true);
      expect(menu.querySelector('a[data-part="side-back"]')?.getAttribute('href'), hash).toBe('#/technical');
    }
    expect(open(withDomains(), '#/technical/domain/d1').menu.querySelector('a[aria-current="page"]')?.getAttribute('data-group-link')).toBe('d1');
    expect(open(withDomains(), '#/technical/chapter/F2').menu.querySelector('a[aria-current="page"]')?.getAttribute('data-page')).toBe('chapter:F2');
  });
});

describe('the left list', () => {
  const ARCH = { technical: 'Architecture text.' };
  const withArch = (extra: Partial<PageData> = {}): PageData => withDomains({ architecture: ARCH, ...extra });
  const keys = (html: string): string[] => Array.from(side(html).matchAll(/<a [^>]*href="([^"]*)"/g), (match) => match[1]);
  const currents = (html: string): string[] => Array.from(side(html).matchAll(/<a [^>]*href="([^"]*)"[^>]*aria-current="page"/g), (match) => match[1]);

  it('is in the frame next to main on every route, with its state on the nav and on the frame', () => {
    for (const [hash, mode] of [['#/product', 'global'], ['#/product/problems', 'global'], ['#/product/remedies', 'global'], ['#/technical/architecture', 'global'], ['#/technical/chapter/system', 'global'], ['#/product/coverage', 'global'], ['#/product/nowhere', 'global'], ['#/product/domain/d1', 'domain'], ['#/product/chapter/F1', 'domain']] as const) {
      const html = render(withArch(), hash);
      expect(html, hash).toContain(`<nav class="side"`);
      expect(side(html), hash).toContain(`data-side="${mode}"`);
      expect(frameOf(html), hash).toBe(mode);
      expect(html.indexOf('<nav class="side"'), hash).toBeLessThan(html.indexOf('<main'));
      expect(html.indexOf('<div class="frame"'), hash).toBeLessThan(html.indexOf('<nav class="side"'));
    }
  });

  it('is global on the home page: Overview, Problems, Improvement suggestions, then the reference pages by their groups, no domains and no features', () => {
    const html = render(withDomains(), '#/product');
    expect(keys(html)).toEqual(['#/product', '#/product/problems', '#/product/remedies', '#/product/chapter/system', '#/product/history', '#/product/coverage']);
    expect(currents(html)).toEqual(['#/product']);
    expect(texts(side(html)).slice(0, 3)).toEqual([marked['page.nav.overview'], marked['page.nav.problems'], marked['page.nav.remedies']]);
    expect(side(html)).not.toContain('/domain/');
    expect(side(html)).not.toContain('side-group');
    expect(side(html)).not.toContain('/chapter/F');
    expect(side(html)).not.toContain(marked['page.nav.architecture']);
  });

  it('marks the problems page, the architecture page and a reference page in the global state, and lists the architecture before the references', () => {
    expect(currents(render(withArch(), '#/technical/problems'))).toEqual(['#/technical/problems']);
    const architecture = render(withArch(), '#/technical/architecture');
    expect(keys(architecture)).toEqual(['#/technical', '#/technical/problems', '#/technical/remedies', '#/technical/architecture', '#/technical/chapter/system', '#/technical/data', '#/technical/dictionaries', '#/technical/history', '#/technical/coverage']);
    expect(currents(architecture)).toEqual(['#/technical/architecture']);
    expect(texts(side(architecture))[3]).toBe(marked['page.nav.architecture']);
    expect(currents(render(withArch(), '#/technical/remedies'))).toEqual(['#/technical/remedies']);
    const data = render(withArch(), '#/technical/data');
    expect(currents(data)).toEqual(['#/technical/data']);
    expect(side(data)).not.toContain('--c-fill');
    expect(currents(render(withArch(), '#/technical/coverage'))).toEqual(['#/technical/coverage']);
    expect(currents(render(withArch(), '#/technical/chapter/system'))).toEqual(['#/technical/chapter/system']);
  });

  it('has the architecture entry in the technical view only, and not when the architecture text is empty or missing', () => {
    expect(keys(render(withArch(), '#/product/problems'))).not.toContain('#/product/architecture');
    expect(side(render(withArch(), '#/product'))).not.toContain(marked['page.nav.architecture']);
    expect(side(render(withDomains({ architecture: { technical: '' } }), '#/technical'))).not.toContain(marked['page.nav.architecture']);
    expect(side(render(withDomains(), '#/technical'))).not.toContain(marked['page.nav.architecture']);
    expect(side(render(withArch(), '#/technical'))).toContain(`href="#/technical/architecture"`);
  });

  it('is global, without an entry marked, on the not-found page, and in a page with one view without the view in its addresses', () => {
    const missing = render(withArch(), '#/technical/chapter/nope');
    expect(frameOf(missing)).toBe('global');
    expect(currents(missing)).toEqual([]);
    expect(keys(render({ ...pageData({ views: ['technical'] }), architecture: ARCH }, '#/')).slice(0, 4)).toEqual(['#/', '#/problems', '#/remedies', '#/architecture']);
  });

  it('is global for a feature that is in no domain, and domain for one that is', () => {
    const data = withDomains({ domains: { ...OK_DOMAINS, list: [OK_DOMAINS.list[1]] } });
    expect(frameOf(render(data, '#/product/chapter/F2'))).toBe('global');
    expect(currents(render(data, '#/product/chapter/F2'))).toEqual(['#/product/chapter/F2']);
    expect(frameOf(render(data, '#/product/chapter/F1'))).toBe('domain');
  });

  it('is the domain list on a domain page: the way back, every domain a link to its page and open with its features, the current domain marked', () => {
    const html = render(withDomains(), '#/technical/domain/d2');
    const list = side(html);
    expect(list).toContain(`aria-label="${marked['page.nav.domains']}"`);
    expect(hrefs(list)).toEqual(['#/technical', '#/technical/domain/d1', '#/technical/chapter/F2', '#/technical/domain/d2', '#/technical/chapter/F1']);
    expect(list).toMatch(/<a class="side-back" data-part="side-back" href="#\/technical">/);
    expect(between(list, 'data-part="side-back"', '</a>')).toContain(marked['page.nav.overview']);
    expect(list).toMatch(/<details class="side-group" data-group="d1" open=""/);
    expect(list).toMatch(/<details class="side-group" data-group="d2" open=""/);
    expect(list).toContain(`--c-fill:${STRATA[0].fill}`);
    expect(list).toContain(`--c-fill:${STRATA[1].fill}`);
    expect(currents(html)).toEqual(['#/technical/domain/d2']);
    expect(list).toMatch(/<a [^>]*href="#\/technical\/domain\/d2"[^>]*data-group-link="d2"[^>]*aria-current="page"/);
    expect(list).not.toContain('data-nav=');
    expect(list).not.toContain('ref-group');
  });

  it('is the domain list on a feature page too, with the feature marked and not its domain', () => {
    const html = render(withDomains(), '#/technical/chapter/F2');
    expect(hrefs(side(html))).toEqual(['#/technical', '#/technical/domain/d1', '#/technical/chapter/F2', '#/technical/domain/d2', '#/technical/chapter/F1']);
    expect(currents(html)).toEqual(['#/technical/chapter/F2']);
  });

  it('has the breadcrumbs Overview / domain (a link to its page) / title for a feature, and Overview / title for the others', () => {
    const feature = between(render(withDomains(), '#/product/chapter/F1'), '<nav class="crumbs"', '</nav>');
    expect(hrefs(feature)).toEqual(['#/product', '#/product/domain/d2']);
    expect(texts(feature)).toEqual([marked['page.nav.overview'], d('Sales')]);
    expect(feature).toContain(`<span aria-current="page">${d('Orders')}</span>`);
    expect(feature).toContain(`aria-label="${marked['page.crumbs.label']}"`);
    const reference = between(render(withDomains(), '#/product/chapter/system'), '<nav class="crumbs"', '</nav>');
    expect(hrefs(reference)).toEqual(['#/product']);
    expect(texts(reference)).toEqual([marked['page.nav.overview']]);
    expect(reference).toContain(`<span aria-current="page">${SYSTEM}</span>`);
    expect(reference).not.toContain(`<span>`);
    const data = between(render(withDomains(), '#/technical/data'), '<nav class="crumbs"', '</nav>');
    expect(Array.from(data.matchAll(/<span[^>]*>([^<]*)<\/span>/g)).map((match) => match[1]).filter((text) => text !== '')).toEqual([marked['md.data.heading']]);
  });

  it('starts the breadcrumbs of a domain page and of the problems page with Overview, linking home', () => {
    const domain = between(render(withDomains(), '#/product/domain/d1'), '<nav class="crumbs"', '</nav>');
    expect(hrefs(domain)).toEqual(['#/product']);
    expect(texts(domain)).toEqual([marked['page.nav.overview']]);
    expect(domain).toContain(`<span aria-current="page">${d('Support')}</span>`);
    const problems = between(render(withDomains(), '#/product/problems'), '<nav class="crumbs"', '</nav>');
    expect(hrefs(problems)).toEqual(['#/product']);
    expect(texts(problems)).toEqual([marked['page.nav.overview']]);
  });

  it('follows the group order for previous and next of a feature, and the references order (the coverage page last) for the others', () => {
    const links = (html: string) => ({ previous: /data-side="previous" href="([^"]*)"/.exec(html)?.[1], next: /data-side="next" href="([^"]*)"/.exec(html)?.[1] });
    const data = pageData();
    expect(links(render(data, '#/technical/chapter/F1'))).toEqual({ previous: undefined, next: '#/technical/chapter/F2' });
    expect(links(render(data, '#/technical/chapter/F2'))).toEqual({ previous: '#/technical/chapter/F1', next: undefined });
    expect(links(render(data, '#/technical/chapter/system'))).toEqual({ previous: undefined, next: '#/technical/data' });
    expect(links(render(data, '#/technical/history'))).toEqual({ previous: '#/technical/dictionaries', next: '#/technical/coverage' });
    expect(links(render(data, '#/technical/coverage'))).toEqual({ previous: '#/technical/history', next: undefined });
    expect(links(render(data, '#/product/history'))).toEqual({ previous: '#/product/chapter/system', next: '#/product/coverage' });
    // Domains of two features each: one group, in the domain order, not the outline's.
    const grouped = withDomains({ domains: { state: 'ok', list: [{ id: 'd1', name: d('All'), features: ['F2', 'F1'], intro: {}, body: {} }], handovers: [] } });
    expect(links(render(grouped, '#/product/chapter/F2'))).toEqual({ previous: undefined, next: '#/product/chapter/F1' });
  });

  it('gives the wide pages (data, dictionaries, history) the full width and no table of contents', () => {
    expect(render(pageData(), '#/technical/history')).toContain('data-wide="true"');
    expect(render(pageData(), '#/technical/history')).toContain('data-toc="none"');
    expect(render(pageData(), '#/product/chapter/F1')).not.toContain('data-wide');
  });

  it('computes neighbours and the context from the list directly', () => {
    const data = withDomains();
    const context = contextOf(data, 'product', COVERAGE, SYSTEM, 'chapter:F1');
    expect(context.kind).toBe('group');
    expect(neighbours(context.items, 'chapter:F1')).toEqual({});
    expect(neighbours(context.items, 'nope')).toEqual({});
    expect(contextOf(data, 'product', COVERAGE, SYSTEM, 'history').kind).toBe('references');
  });
});

describe('the home and domain pages', () => {
  it('show the title on the home page, and the domain page with its features as links; a fallback domain shows its name and features', () => {
    const home = render(withDomains(), '#/product');
    expect(home).toContain(`<h1 class="vh">${d('System chapter')}</h1>`);
    expect(home).not.toContain('home-lead');
    expect(home).toContain('data-part="open-domains" href="#/product/domain/d1"');
    const domain = render(pageData(), '#/product/domain/d1');
    expect(domain).toContain('data-domain="d1"');
    expect(between(domain, 'data-part="domain-features"', '</section>')).toContain(marked['page.domain.features']);
    expect(hrefs(between(domain, 'data-part="domain-features"', '</section>'))).toEqual(['#/product/chapter/F1', '#/product/chapter/F2']);
    expect(render(withDomains(), '#/product/domain/zzz')).toContain('data-view="not-found"');
  });
});

describe('the view switch', () => {
  const to = (hash: string, view: 'product' | 'technical', data = pageData()): string => switchTarget(data, parseHash(hash), view, COVERAGE);

  it('keeps the chapter, the code health and the coverage page when the other view has them', () => {
    expect(to('#/technical/chapter/F2', 'product')).toBe('#/product/chapter/F2');
    expect(to('#/product/chapter/F1', 'technical')).toBe('#/technical/chapter/F1');
    expect(to('#/technical/history', 'product')).toBe('#/product/history');
    expect(to('#/product/coverage', 'technical')).toBe('#/technical/coverage');
  });

  it('keeps the home page and a domain page', () => {
    expect(to('#/technical', 'product')).toBe('#/product');
    expect(to('#/technical/domain/d1', 'product', withDomains())).toBe('#/product/domain/d1');
  });

  it('keeps the architecture page only in a view that has it: the technical view with an architecture text', () => {
    const data = withDomains({ architecture: { technical: 'Text.' } });
    expect(to('#/technical/architecture', 'product', data)).toBe('#/product');
    expect(to('#/technical/architecture', 'technical', data)).toBe('#/technical/architecture');
    expect(to('#/product/architecture', 'technical', data)).toBe('#/technical/architecture');
  });

  it('goes home when the other view does not have the page (the data page in the product view), or the address names no page', () => {
    expect(to('#/technical/data', 'product')).toBe('#/product');
    expect(to('#/technical/dictionaries', 'product')).toBe('#/product');
    expect(to('#/technical/chapter/nope', 'product')).toBe('#/product');
    expect(to('#/technical/domain/zzz', 'product', withDomains())).toBe('#/product');
  });

  it('puts the links of the switch in the bar, the current view marked, and the page keeps its place on the chapter', () => {
    const html = render(pageData(), '#/technical/chapter/F2');
    const link = (page: string, view: string) => new RegExp(`<a [^>]*href="([^"]*)"[^>]*data-view-link="${view}"([^>]*)>`).exec(page);
    expect(link(html, 'product')?.[1]).toBe('#/product/chapter/F2');
    expect(link(html, 'technical')?.[1]).toBe('#/technical/chapter/F2');
    expect(link(html, 'technical')?.[2]).toContain('aria-current="page"');
    expect(link(html, 'product')?.[2]).not.toContain('aria-current');
    expect(link(render(pageData(), '#/technical/data'), 'product')?.[1]).toBe('#/product');
  });

  it('a page with one view has no view in its addresses and no switch', () => {
    const html = render(pageData({ views: ['technical'] }), '#/chapter/F1');
    expect(side(html)).toContain('href="#/chapter/F1"');
    expect(html).not.toContain('data-part="view-switch"');
  });

  it('switches in the page: a click on the other view shows the same chapter in it', () => {
    const data = pageData({ chapters: [{ id: 'system', texts: { product: '# P\n', technical: '# T\n' } }, { id: 'F1', texts: { product: `# ${d('product text')}\n`, technical: `# ${d('technical text')}\n` } }, { id: 'F2', texts: { product: '# R\n', technical: '# R\n' } }] });
    const host = mount(<AppView data={data} route={parseHash('#/technical/chapter/F1')} />);
    expect(host.querySelector('h1')?.textContent).toBe(d('technical text'));
    const other = mount(<AppView data={data} route={parseHash(host.querySelector('[data-view-link="product"]')?.getAttribute('href') ?? '')} />);
    expect(other.querySelector('h1')?.textContent).toBe(d('product text'));
  });
});

describe('what each route is', () => {
  it('knows the page of a route in each view', () => {
    const data = pageData();
    const pages = pagesOf(data, 'product', COVERAGE);
    expect(pages.map((item) => item.key)).toEqual(['chapter:system', 'chapter:F1', 'chapter:F2', 'history', 'coverage']);
    expect(pagesOf(data, 'technical', COVERAGE).map((item) => item.key)).toEqual(['chapter:system', 'chapter:F1', 'chapter:F2', 'data', 'dictionaries', 'history', 'coverage']);
    expect(pageOf(pages, parseHash('#/product'))).toBeUndefined();
    expect(pageOf(pages, parseHash('#/product/data'))).toBeUndefined();
    expect(viewOf(data, parseHash('#/product'), COVERAGE)).toBe('product');
    expect(viewOf(data, parseHash('#/product/data'), COVERAGE)).toBeNull();
    expect(viewOf(data, parseHash('#/data'), COVERAGE)).toBeNull();
    expect(viewOf(data, parseHash('#/technical/data'), COVERAGE)).toBe('technical');
    expect(viewOf(withDomains(), parseHash('#/technical/domain/d2'), COVERAGE)).toBe('technical');
    expect(viewOf(withDomains(), parseHash('#/technical/domain/d9'), COVERAGE)).toBeNull();
    expect(bodyOf(parseHash('#/technical/chapter/F1'))).toEqual({ name: 'chapter', id: 'F1' });
  });

  it('has the architecture page in the technical view with an architecture text, and nowhere else', () => {
    const data = withDomains({ architecture: { technical: 'Text.' } });
    expect(viewOf(data, parseHash('#/technical/architecture'), COVERAGE)).toBe('technical');
    expect(viewOf(data, parseHash('#/product/architecture'), COVERAGE)).toBeNull();
    expect(viewOf(withDomains(), parseHash('#/technical/architecture'), COVERAGE)).toBeNull();
    expect(viewOf(withDomains({ architecture: { technical: '' } }), parseHash('#/technical/architecture'), COVERAGE)).toBeNull();
    expect(viewOf({ ...pageData({ views: ['product'] }), architecture: { technical: 'Text.' } }, parseHash('#/architecture'), COVERAGE)).toBeNull();
    expect(render(withDomains(), '#/technical/architecture')).toContain('data-view="not-found"');
  });

  it('shows the not-found page for an address that names no page, and the document title says so', () => {
    const data = pageData();
    expect(render(data, '#/product/data')).toContain('data-view="not-found"');
    expect(documentTitle(data, parseHash('#/product/data'))).toBe(marked['page.notFound.heading']);
    expect(render(data, '#/nowhere')).toContain('data-view="not-found"');
  });

  it('titles the document by the page and the view title; home by the system title; a domain by its name', () => {
    const data = withDomains();
    expect(documentTitle(data, parseHash('#/technical/chapter/F1'))).toBe(`${d('Orders')} - ${d('Technical handbook')}`);
    expect(documentTitle(data, parseHash('#/product/coverage'))).toBe(`${COVERAGE} - ${d('Handbook')}`);
    expect(documentTitle(data, parseHash('#/product'))).toBe(`${d('System chapter')} - ${d('Handbook')}`);
    expect(documentTitle(data, parseHash('#/product/domain/d2'))).toBe(`${d('Sales')} - ${d('Handbook')}`);
    expect(documentTitle({ ...data, architecture: { technical: 'Text.' } }, parseHash('#/technical/architecture'))).toBe(`${marked['page.nav.architecture']} - ${d('Technical handbook')}`);
    expect(BOTH).toEqual(['product', 'technical']);
    expect(MARK).toBe('@@');
  });
});

describe('the table of contents', () => {
  const body = (headings: string): string => `# ${d('Title')}\n\n${headings}`;
  const chaptered = (text: string): PageData => pageData({ chapters: [{ id: 'system', texts: { product: text, technical: text } }, chapter('F1', 'Orders'), chapter('F2', 'Reminders')] });
  const FIVE = body(`## ${d('One')}\n\ntext\n\n### ${d('One a')}\n\ntext\n\n## ${d('Two')}\n\ntext\n\n### ${d('Two a')}\n\n#### ${d('deep')}\n\n## ${d('Three')}\n`);

  it('numbers the h2 and h3 of the article h-0, h-1, ... in document order, and lists them as buttons (not links)', () => {
    const host = mount(<AppView data={chaptered(FIVE)} route={parseHash('#/product/chapter/system')} />);
    const headings = Array.from(host.querySelectorAll('.prose h2, .prose h3'));
    expect(headings.map((heading) => heading.id)).toEqual(['h-0', 'h-1', 'h-2', 'h-3', 'h-4']);
    expect(headings.every((heading) => heading.getAttribute('tabindex') === '-1')).toBe(true);
    expect(host.querySelector('.prose h1')?.id).toBe('');
    expect(host.querySelector('.prose h4')?.id).toBe('');
    const toc = host.querySelector('.toc') as HTMLElement;
    expect(toc.querySelectorAll('a')).toHaveLength(0);
    expect(Array.from(toc.querySelectorAll('button')).map((button) => [button.dataset.level, button.textContent])).toEqual([
      ['2', d('One')], ['3', d('One a')], ['2', d('Two')], ['3', d('Two a')], ['2', d('Three')],
    ]);
    expect(toc.getAttribute('aria-label')).toBe(marked['page.toc.label']);
  });

  it('is absent for an article with fewer than two h2, and the page then has no third column', () => {
    const host = mount(<AppView data={chaptered(body(`## ${d('Only')}\n\n### ${d('sub')}\n`))} route={parseHash('#/product/chapter/system')} />);
    expect(host.querySelector('.toc')).toBeNull();
    expect(host.querySelector('.read')?.getAttribute('data-toc')).toBe('none');
    expect(host.querySelector('.prose h2')?.id).toBe('h-0');
  });

  it('scrolls to the heading with a smooth behaviour, focuses it, and never touches the address', () => {
    const calls: { id: string; options: unknown }[] = [];
    const proto = globalThis.HTMLElement.prototype as unknown as { scrollIntoView: (options?: unknown) => void };
    const saved = proto.scrollIntoView;
    proto.scrollIntoView = function scroll(this: HTMLElement, options?: unknown) { calls.push({ id: this.id, options }); };
    try {
      window.location.hash = '#/product/chapter/system';
      const host = mount(<AppView data={chaptered(FIVE)} route={parseHash('#/product/chapter/system')} />);
      const buttons = host.querySelectorAll<HTMLElement>('.toc button');
      act(() => buttons[2].click());
      expect(calls).toEqual([{ id: 'h-2', options: { behavior: 'smooth', block: 'start' } }]);
      expect(document.activeElement?.id).toBe('h-2');
      expect(window.location.hash).toBe('#/product/chapter/system');
      expect(buttons[2].getAttribute('aria-current')).toBe('true');
    } finally {
      proto.scrollIntoView = saved;
    }
  });

  it('uses the plain behaviour when the reader asks for less motion', () => {
    const calls: unknown[] = [];
    const proto = globalThis.HTMLElement.prototype as unknown as { scrollIntoView: (options?: unknown) => void };
    const saved = proto.scrollIntoView;
    const savedMedia = window.matchMedia;
    proto.scrollIntoView = (options?: unknown) => { calls.push(options); };
    window.matchMedia = ((query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    try {
      const host = mount(<AppView data={chaptered(FIVE)} route={parseHash('#/product/chapter/system')} />);
      act(() => host.querySelectorAll<HTMLElement>('.toc button')[1].click());
      expect(calls).toEqual([{ behavior: 'auto', block: 'start' }]);
    } finally {
      proto.scrollIntoView = saved;
      window.matchMedia = savedMedia;
    }
  });

  it('wants a table of contents from two h2 up', () => {
    expect(wantsToc([{ id: 'h-0', level: 2, text: 'a' }, { id: 'h-1', level: 3, text: 'b' }])).toBe(false);
    expect(wantsToc([{ id: 'h-0', level: 2, text: 'a' }, { id: 'h-1', level: 2, text: 'b' }])).toBe(true);
  });

  it('puts the scrollspy limit at the bar plus the larger of 24px and a quarter of the viewport, rounded', () => {
    expect(spyLimit(60, 800)).toBe(260);
    expect(spyLimit(60, 90)).toBe(84);
    expect(spyLimit(60, 101)).toBe(85);
    expect(spyLimit(60, 0)).toBe(84);
  });

  it('marks the last heading whose top is at or above the limit, else the first', () => {
    expect(activeIndex([-300, -50, 200, 600], 260)).toBe(2);
    expect(activeIndex([-300, -50, 260, 600], 260)).toBe(2);
    expect(activeIndex([300, 500], 260)).toBe(0);
    expect(activeIndex([], 260)).toBe(0);
    expect(activeIndex([-10, 400, -20], 260)).toBe(2);
  });
});

describe('the notices of a chapter', () => {
  const NOT_VERIFIED = shippedString('chapter.notVerified');
  const NOT_PASSED = shippedString('chapter.notPassed').replace('{count}', '3');
  const text = `# ${d('Title')}\n\n${marked['chapter.notVerified']}\n\n${marked['chapter.notPassed'].replace('{count}', '3')}\n\n${d('A paragraph')}\n`;

  function shippedString(key: string): string {
    return marked[key].slice(MARK.length);
  }

  it('render the not-verified paragraph and the not-passed paragraph as quiet notes with an icon, and leave the others plain', () => {
    const data = pageData({ chapters: [chapter('system', 'S'), { id: 'F1', texts: { product: text, technical: text } }, chapter('F2', 'R')] });
    const host = mount(<AppView data={data} route={parseHash('#/product/chapter/F1')} />);
    const notes = Array.from(host.querySelectorAll('.prose p.note'));
    expect(notes.map((note) => note.getAttribute('data-note'))).toEqual(['not-verified', 'not-passed']);
    expect(notes.every((note) => note.querySelector('svg') !== null)).toBe(true);
    expect(notes[0].textContent).toBe(marked['chapter.notVerified']);
    expect(notes[1].textContent).toBe(marked['chapter.notPassed'].replace('{count}', '3'));
    const plain = Array.from(host.querySelectorAll('.prose p:not(.note)')).map((p) => p.textContent);
    expect(plain).toEqual([d('A paragraph')]);
    expect(NOT_VERIFIED.length).toBeGreaterThan(0);
    expect(NOT_PASSED).toContain('3');
  });
});

describe('colours', () => {
  it('give each group a pair of the twelve by its index, wrapping after twelve, and have a neutral pair', () => {
    const ids = Array.from({ length: 14 }, (_, at) => `d${at + 1}`);
    const colours = domainColours(ids);
    expect(colours.d1).toEqual({ fill: '#E9DDBF', edge: '#8C6D2C' });
    expect(colours.d12).toEqual({ fill: '#F0D9B0', edge: '#8A5A12' });
    expect(colours.d13).toEqual(colours.d1);
    expect(STRATA).toHaveLength(12);
    expect(new Set(STRATA.map((pair) => pair.fill)).size).toBe(12);
    expect(NEUTRAL).toEqual({ fill: '#DCDFE3', edge: '#59636F' });
  });
});

describe('the stylesheet', () => {
  const css = readFileSync(join(__dirname, '../src/index.css'), 'utf-8');

  it('declares the palette in light and dark, the font stacks and the domain colour mixing', () => {
    for (const value of ['#1C2430', '#59636F', '#FAFAF9', '#D9DDE2', '#1F4FA3', '#A8661A', '#B3261E', '#E6E9EE', '#A4ADB8', '#12161C', '#171C23', '#2A313B', '#8FB1F2', '#E3A85F', '#F08A80']) expect(css).toContain(value);
    expect(css).toContain("--font-sans: 'IBM Plex Sans', 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans CJK SC', 'Noto Sans CJK JP', 'Microsoft YaHei', system-ui, sans-serif;");
    expect(css).toContain("--font-mono: 'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace;");
    expect(css).toContain('color-mix(in oklab, var(--c-fill) 40%, var(--bg))');
    // The page's text breaks only between words; identifiers and paths (file names, value-set names) may break anywhere.
    expect(/\nbody \{[^}]*overflow-wrap: break-word;/.test(css)).toBe(true);
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*transition: none !important/);
  });

  it('keeps the token names the data, dictionaries and history pages use', () => {
    for (const name of ['--bg', '--surface', '--surface-2', '--text', '--text-2', '--text-3', '--line', '--line-strong', '--accent', '--accent-text', '--accent-bg', '--warn-bg', '--warn-text', '--scrim', '--shadow', '--radius', '--control-h', '--topbar-h']) {
      expect(css, name).toContain(`${name}:`);
    }
  });

  it('gives the folds of a feature page their own class: one hairline between folds, none above the first, the chevron rotated when open', () => {
    // The shared list item class adds a top rule and padding; a fold that used it got two lines between neighbours.
    expect(css).not.toMatch(/\.feature details\.item/);
    expect(css).toContain('.feature details.fold + details.fold { border-top: 1px solid var(--line); }');
    expect(css).not.toMatch(/details\.fold:first-of-type/);
    expect(css).toContain('.feature details.fold[open] > summary .chev { transform: rotate(90deg);');
  });

  it('has no all-caps label and no negative-spacing eyebrow', () => {
    expect(css).not.toContain('text-transform: uppercase');
  });
});
