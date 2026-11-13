// @vitest-environment happy-dom
// Grouped references, the system overview name and reading across domains (openspec change handbook-page-reachability, step 3).
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { AppView } from '../src/App';
import { flatReferences, referencesOf } from '../src/lib/groups';
import { contextOf, stepsOf } from '../src/lib/navigation';
import { searchResults } from '../src/lib/search';
import { parseHash } from '../src/lib/route';
import type { Outline, PageData } from '../src/lib/types';
import { cleanup, mount } from './dom';
import { domainData } from './domains-fixture';
import { d, marked, pageData } from './page-fixture';

afterEach(cleanup);

const COVERAGE = marked['page.nav.coverage'];
const SYSTEM = marked['page.nav.system'];
const OTHER = (name: string): string => marked['page.chapter.otherDomain'].replace('{name}', name);
const show = (data: PageData, hash: string): HTMLElement => mount(<AppView data={data} route={parseHash(hash)} />);
const titles = (data: PageData): (string | null)[] => referencesOf(data, 'technical', COVERAGE, SYSTEM).map((group) => group.title);

describe('references in groups', () => {
  it('has one group per outline part that holds reference pages, in outline order, the coverage page last without a title', () => {
    const groups = referencesOf(pageData(), 'technical', COVERAGE, SYSTEM);
    expect(groups.map((group) => [group.title, group.items.map((item) => item.key)])).toEqual([
      [d('System'), ['chapter:system']],
      [d('Data and health'), ['data', 'dictionaries', 'history']],
      [null, ['coverage']],
    ]);
    expect(flatReferences(groups).map((item) => item.key)).toEqual(['chapter:system', 'data', 'dictionaries', 'history', 'coverage']);
  });

  it('leaves out a part with no reference page, and the view decides which pages a part holds', () => {
    expect(referencesOf(pageData(), 'product', COVERAGE, SYSTEM).map((group) => group.items.map((item) => item.key))).toEqual([['chapter:system'], ['history'], ['coverage']]);
    expect(titles(pageData())).not.toContain(d('Features'));
  });

  it('has a single group without a title when the coverage page is all there is', () => {
    const outline: Outline = { source: 'outline', problems: [], parts: [{ title: d('Features'), blocks: [{ block: 'F1', kind: 'chapter', title: d('Orders') }] }], unplaced: [] };
    const data = pageData({ outline, domains: { state: 'ok', list: [{ id: 'd1', name: d('A'), features: ['F1'], intro: {}, body: {} }], handovers: [] } });
    expect(referencesOf(data, 'product', COVERAGE, SYSTEM)).toEqual([{ title: null, items: [{ block: 'coverage', kind: 'coverage', title: COVERAGE, key: 'coverage' }] }]);
  });

  it('shows the groups in the popover, the phone menu, the side list and the home page: the title as a small text, no box', () => {
    const host = show(domainData(), '#/technical/chapter/system');
    const panel = host.querySelector('#pop-refs') as HTMLElement;
    expect(Array.from(panel.querySelectorAll('.ref-group')).map((one) => one.getAttribute('data-ref-group'))).toEqual([d('System'), d('Data and health') , '']);
    expect(Array.from(panel.querySelectorAll('.ref-group-title')).map((one) => one.textContent)).toEqual([d('System'), d('Data and health')]);
    const side = host.querySelector('.side') as HTMLElement;
    expect(Array.from(side.querySelectorAll('.ref-group-title')).map((one) => one.textContent)).toEqual([d('System'), d('Data and health')]);
    expect(side.querySelector('a[aria-current="page"]')?.getAttribute('data-page')).toBe('chapter:system');
    act(() => (host.querySelector('.menu-btn') as HTMLElement).click());
    const menu = host.querySelector('#menu') as HTMLElement;
    expect(Array.from(menu.querySelectorAll('.ref-group-title')).map((one) => one.textContent)).toEqual([d('System'), d('Data and health')]);
    const home = show(domainData(), '#/technical');
    expect(Array.from(home.querySelectorAll('[data-part="home"] .ref-group-title, .home .ref-group-title')).map((one) => one.textContent)).toEqual([d('System'), d('Data and health')]);
  });
});

describe('the system chapter is called the system overview in lists and links', () => {
  it('in the popover, phone menu, side list, home references, breadcrumbs and search results; its own heading stays', () => {
    const host = show(domainData(), '#/technical/chapter/system');
    const named = (root: ParentNode): (string | null)[] => Array.from(root.querySelectorAll('a[data-page="chapter:system"]')).map((one) => one.textContent);
    expect(named(host.querySelector('#pop-refs') as HTMLElement)).toEqual([SYSTEM]);
    expect(named(host.querySelector('.side') as HTMLElement)).toEqual([SYSTEM]);
    expect(host.querySelector('.crumbs [aria-current="page"]')?.textContent).toBe(SYSTEM);
    expect(host.querySelector('.prose h1')?.textContent).toBe(d('System chapter'));
    act(() => (host.querySelector('.menu-btn') as HTMLElement).click());
    expect(named(host.querySelector('#menu') as HTMLElement)).toEqual([SYSTEM]);
    expect(named(show(domainData(), '#/technical') as HTMLElement)).toContain(SYSTEM);
    const data = domainData();
    const results = searchResults({ query: 'overview', groups: [], items: data.search, references: [], referencesLabel: 'r', domainsLabel: 'd', systemTitle: SYSTEM });
    expect(results.map((result) => [result.key, result.title])).toEqual([['chapter:system', SYSTEM]]);
  });

  it('is the previous or next link of its neighbours, by the same name', () => {
    const context = contextOf(pageData(), 'technical', COVERAGE, SYSTEM, 'chapter:system');
    expect(stepsOf(context, 'chapter:system').next?.item.key).toBe('data');
    const history = contextOf(pageData(), 'technical', COVERAGE, SYSTEM, 'history');
    expect(stepsOf(history, 'history').previous?.item.title).toBe(marked['md.dict.heading']);
    const product = contextOf(pageData(), 'product', COVERAGE, SYSTEM, 'history');
    expect(stepsOf(product, 'history').previous?.item.title).toBe(SYSTEM);
  });
});

describe('previous and next across domains', () => {
  // Domains d1 [F1], d2 [F2], d3 [F3], d4 [F4] in the shared fixture, one feature each.
  const step = (hash: string, side: 'previous' | 'next'): [string | null, string | null, string | null] => {
    const host = show(domainData(), hash);
    const link = host.querySelector(`[data-side="${side}"]`);
    return [link?.getAttribute('href') ?? null, link?.querySelector('small')?.textContent ?? null, link?.textContent?.replace(link.querySelector('small')?.textContent ?? '', '') ?? null];
  };

  it('goes from the last feature of a domain to the first of the next one, labelled with the domain name', () => {
    expect(step('#/product/chapter/F1', 'next')).toEqual(['#/product/chapter/F2', OTHER(d('Orders')), d('Order entry')]);
    expect(step('#/product/chapter/F3', 'next')).toEqual(['#/product/chapter/F4', OTHER(d('Support')), d('Help desk')]);
  });

  it('goes back from the first feature of a domain to the last one of the previous domain', () => {
    expect(step('#/product/chapter/F4', 'previous')).toEqual(['#/product/chapter/F3', OTHER(d('Billing')), d('Invoicing')]);
  });

  it('has no previous at the very first feature and no next at the very last', () => {
    expect(step('#/product/chapter/F1', 'previous')[0]).toBeNull();
    expect(step('#/product/chapter/F4', 'next')[0]).toBeNull();
  });

  it('keeps the plain labels inside one domain', () => {
    const data = domainData();
    const one: PageData = { ...data, domains: data.domains.state === 'ok' ? { ...data.domains, handovers: [], list: [{ ...data.domains.list[0], features: ['F1', 'F2'] }, ...data.domains.list.slice(2)] } : data.domains };
    const host = show(one, '#/product/chapter/F1');
    expect(host.querySelector('[data-side="next"] small')?.textContent).toBe(marked['page.chapter.next']);
    expect(host.querySelector('[data-side="next"]')?.getAttribute('href')).toBe('#/product/chapter/F2');
    const jump = show(one, '#/product/chapter/F2');
    expect(jump.querySelector('[data-side="next"] small')?.textContent).toBe(OTHER(d('Billing')));
  });

  it('keeps the order of the reference pages and their plain labels', () => {
    const host = show(domainData(), '#/technical/history');
    expect(host.querySelector('[data-side="next"] small')?.textContent).toBe(marked['page.chapter.next']);
    expect(host.querySelector('[data-side="next"]')?.getAttribute('href')).toBe('#/technical/coverage');
  });
});

