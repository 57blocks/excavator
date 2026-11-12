// @vitest-environment happy-dom
// O4 of openspec change handbook-skill-first, the shell half: the sidebar groups the chapters under the outline's part titles in
// the outline's order, the data and dictionaries blocks are in the technical view only, the home route is the first page of the
// outline, previous and next follow the outline with the coverage page last, the view switch keeps the page (and goes to the
// first chapter when the other view does not have it), and the title of the document comes from the data.
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';

import { AppView, documentTitle } from '../src/App';
import { bodyOf, pageOf, pagesOf, switchTarget, viewOf } from '../src/lib/pages';
import { parseHash, routeHash } from '../src/lib/route';
import type { Outline, PageData } from '../src/lib/types';
import { cleanup, mount } from './dom';
import { BOTH, MARK, d, marked, pageData } from './page-fixture';

afterEach(cleanup);

const render = (data: PageData, hash: string): string => renderToStaticMarkup(<AppView data={data} route={parseHash(hash)} />);
const rail = (html: string): string => html.slice(html.indexOf('<nav class="rail"'), html.indexOf('</nav>', html.indexOf('<nav class="rail"')));
const COVERAGE = marked['page.nav.coverage'];

describe('routes', () => {
  it('parses a chapter and the pages, with and without the view, and builds them back', () => {
    expect(parseHash('#/')).toEqual({ name: 'home' });
    expect(parseHash('#/chapter/F1')).toEqual({ name: 'chapter', id: 'F1' });
    expect(parseHash('#/technical/chapter/F%201')).toEqual({ name: 'chapter', id: 'F 1', view: 'technical' });
    expect(parseHash('#/product/coverage')).toEqual({ name: 'coverage', view: 'product' });
    expect(parseHash('#/history')).toEqual({ name: 'history' });
    expect(parseHash('#/chapter').name).toBe('not-found');
    expect(parseHash('#/feature/F1').name).toBe('not-found');
    expect(routeHash({ name: 'chapter', id: 'F 1' }, 'product')).toBe('#/product/chapter/F%201');
    expect(routeHash({ name: 'home' }, null)).toBe('#/');
  });
});

describe('the sidebar', () => {
  it('groups the chapters under the outline parts, in the outline order, with each chapter title; the coverage page last, in no part', () => {
    const html = render(pageData(), '#/technical/chapter/F1');
    const groups = Array.from(rail(html).matchAll(/<section class="rail-group"[^>]*>(.*?)<\/section>/g), (match) => match[1]);
    const parts = groups.map((group) => ({ title: /<h2[^>]*>([^<]*)<\/h2>/.exec(group)?.[1], links: Array.from(group.matchAll(/<a [^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/g), (link) => [link[1], link[2]]) }));
    expect(parts).toEqual([
      { title: d('System'), links: [['#/technical/chapter/system', d('System chapter')]] },
      { title: d('Features'), links: [['#/technical/chapter/F1', d('Orders')], ['#/technical/chapter/F2', d('Reminders')]] },
      { title: d('Data and health'), links: [['#/technical/data', marked['md.data.heading']], ['#/technical/dictionaries', marked['md.dict.heading']], ['#/technical/history', marked['md.history.heading']]] },
      { title: undefined, links: [['#/technical/coverage', COVERAGE]] },
    ]);
  });

  it('follows a written outline, not the default one', () => {
    const outline: Outline = { source: 'outline', problems: [], parts: [{ title: d('Second first'), blocks: [{ block: 'F2', kind: 'chapter', title: d('Reminders') }] }, { title: d('Then'), blocks: [{ block: 'F1', kind: 'chapter', title: d('Orders') }] }], unplaced: [{ block: 'system', reason: d('left out') }] };
    const html = render(pageData({ outline }), '#/product/chapter/F2');
    const names = Array.from(rail(html).matchAll(/<h2[^>]*>([^<]*)<\/h2>/g), (match) => match[1]);
    expect(names).toEqual([d('Second first'), d('Then')]);
    expect(rail(html)).not.toContain(d('System chapter'));
    // A chapter the outline leaves out has no page.
    expect(render(pageData({ outline }), '#/product/chapter/system')).toContain('data-view="not-found"');
  });

  it('marks the page the route shows as current, and the first page for the home route', () => {
    const current = (hash: string): string[] => Array.from(rail(render(pageData(), hash)).matchAll(/<a [^>]*aria-current="page"[^>]*>([^<]*)<\/a>/g), (match) => match[1]);
    expect(current('#/technical/chapter/F2')).toEqual([d('Reminders')]);
    expect(current('#/technical')).toEqual([d('System chapter')]);
    expect(current('#/technical/coverage')).toEqual([COVERAGE]);
  });

  it('has no data and dictionaries link in the product view, and no empty part', () => {
    const product = rail(render(pageData(), '#/product/chapter/F1'));
    expect(product).not.toContain('/data"');
    expect(product).not.toContain('/dictionaries"');
    expect(product).toContain('/product/history"');
    const blocks = pageData().outline.parts[2].blocks.filter((item) => item.kind !== 'history');
    const outline: Outline = { ...pageData().outline, parts: [...pageData().outline.parts.slice(0, 2), { title: d('Only technical'), blocks }] };
    expect(rail(render(pageData({ outline }), '#/product/chapter/F1'))).not.toContain(d('Only technical'));
    expect(rail(render(pageData({ outline }), '#/technical/chapter/F1'))).toContain(d('Only technical'));
  });

  it('a page with one view has no view in its addresses and no switch', () => {
    const html = render(pageData({ views: ['technical'] }), '#/chapter/F1');
    expect(rail(html)).toContain('href="#/chapter/F2"');
    expect(html).not.toContain('view-switch');
  });
});

describe('previous and next', () => {
  const links = (html: string): { previous?: string; next?: string } => ({
    previous: /data-side="previous" href="([^"]*)"/.exec(html)?.[1],
    next: /data-side="next" href="([^"]*)"/.exec(html)?.[1],
  });

  it('follow the outline order and end with the coverage page', () => {
    expect(links(render(pageData(), '#/technical/chapter/F1'))).toEqual({ previous: '#/technical/chapter/system', next: '#/technical/chapter/F2' });
    expect(links(render(pageData(), '#/technical/history'))).toEqual({ previous: '#/technical/dictionaries', next: '#/technical/coverage' });
    expect(links(render(pageData(), '#/technical/coverage'))).toEqual({ previous: '#/technical/history', next: undefined });
  });

  it('skip the technical blocks in the product view, and the first page has no previous link', () => {
    expect(links(render(pageData(), '#/product/history'))).toEqual({ previous: '#/product/chapter/F2', next: '#/product/coverage' });
    expect(links(render(pageData(), '#/product'))).toEqual({ previous: undefined, next: '#/product/chapter/F1' });
  });
});

describe('the view switch', () => {
  const to = (hash: string, view: 'product' | 'technical'): string => switchTarget(pageData(), parseHash(hash), view, COVERAGE);

  it('keeps the chapter, the code health and the coverage page when the other view has them', () => {
    expect(to('#/technical/chapter/F2', 'product')).toBe('#/product/chapter/F2');
    expect(to('#/product/chapter/F1', 'technical')).toBe('#/technical/chapter/F1');
    expect(to('#/technical/history', 'product')).toBe('#/product/history');
    expect(to('#/product/coverage', 'technical')).toBe('#/technical/coverage');
  });

  it('goes to the first chapter of the other view when it does not have the page (the data page in the product view)', () => {
    expect(to('#/technical/data', 'product')).toBe('#/product/chapter/system');
    expect(to('#/technical/dictionaries', 'product')).toBe('#/product/chapter/system');
    expect(to('#/technical/chapter/nope', 'product')).toBe('#/product/chapter/system');
  });

  it('the home route goes to the first page of the other view', () => {
    expect(to('#/technical', 'product')).toBe('#/product/chapter/system');
  });

  it('puts the links of the switch in the bar, the current view marked, and the page keeps its place on the chapter', () => {
    const html = render(pageData(), '#/technical/chapter/F2');
    const link = (page: string, view: string) => new RegExp(`<a [^>]*href="([^"]*)"[^>]*data-view-link="${view}"([^>]*)>`).exec(page);
    expect(link(html, 'product')?.[1]).toBe('#/product/chapter/F2');
    expect(link(html, 'technical')?.[1]).toBe('#/technical/chapter/F2');
    expect(link(html, 'technical')?.[2]).toContain('aria-current="page"');
    expect(link(html, 'product')?.[2]).not.toContain('aria-current');
    expect(link(render(pageData(), '#/technical/data'), 'product')?.[1]).toBe('#/product/chapter/system');
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
    expect(pageOf(pages, parseHash('#/product'))?.key).toBe('chapter:system');
    expect(pageOf(pages, parseHash('#/product/data'))).toBeUndefined();
    expect(viewOf(data, parseHash('#/product/data'), COVERAGE)).toBeNull();
    expect(viewOf(data, parseHash('#/data'), COVERAGE)).toBeNull();
    expect(viewOf(data, parseHash('#/technical/data'), COVERAGE)).toBe('technical');
    expect(bodyOf(parseHash('#/technical/chapter/F1'))).toEqual({ name: 'chapter', id: 'F1' });
  });

  it('shows the not-found page for an address that names no page, and the document title says so', () => {
    const data = pageData();
    expect(render(data, '#/product/data')).toContain('data-view="not-found"');
    expect(documentTitle(data, parseHash('#/product/data'))).toBe(marked['page.notFound.heading']);
    expect(render(data, '#/nowhere')).toContain('data-view="not-found"');
  });

  it('titles the document by the page and the view title', () => {
    const data = pageData();
    expect(documentTitle(data, parseHash('#/technical/chapter/F1'))).toBe(`${d('Orders')} - ${d('Technical handbook')}`);
    expect(documentTitle(data, parseHash('#/product/coverage'))).toBe(`${COVERAGE} - ${d('Handbook')}`);
    expect(BOTH).toEqual(['product', 'technical']);
    expect(MARK).toBe('@@');
  });
});
