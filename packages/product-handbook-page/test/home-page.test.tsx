// @vitest-environment happy-dom
// The home page (openspec change handbook-page-domain-map, task 4.2; changed by handbook-page-structure, tasks 5.1 and 8.2): the
// lead, the atlas (hover and focus marks, the side panel, a click or Enter opening the domain page, clearing), the phone list in
// place of the map, the button that opens the first domain, the page without a feature list, counts or domain navigation, and the
// page without a usable list (no map, one quiet line saying why, the button still there). The features of a domain are in
// domain-features.test.tsx.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { AppView } from '../src/App';
import { parseHash } from '../src/lib/route';
import type { PageData } from '../src/lib/types';
import { cleanup, mount } from './dom';
import { domainData, outlineWithFeatures } from './domains-fixture';
import { d, marked } from './page-fixture';

afterEach(cleanup);

const home = (data: PageData = domainData(), hash = '#/product'): HTMLElement => mount(<AppView data={data} route={parseHash(hash)} />);
const node = (host: HTMLElement, id: string): SVGGElement => host.querySelector(`[data-node="${id}"]`) as SVGGElement;
const map = (host: HTMLElement): SVGSVGElement => host.querySelector('[data-part="atlas"] svg') as SVGSVGElement;
const side = (host: HTMLElement): HTMLElement => host.querySelector('[data-part="atlas-side"]') as HTMLElement;
const frame = (host: HTMLElement): HTMLElement => host.querySelector('.frame') as HTMLElement;
const fire = (element: Element, type: string, init: Record<string, unknown> = {}): void => { act(() => { element.dispatchEvent(new (type.startsWith('key') ? KeyboardEvent : MouseEvent)(type, { bubbles: true, cancelable: true, ...init })); }); };
const markerOf = (host: HTMLElement, edge: number): string => host.querySelector(`[data-edge="${edge}"] .edge`)?.getAttribute('marker-end') ?? '';
const classOf = (host: HTMLElement, edge: number): string[] => Array.from(host.querySelector(`[data-edge="${edge}"] .edge`)?.classList ?? []);

describe('the top of the page', () => {
  it('has the system name as a screen-reader-only h1, and no visible title and no lead', () => {
    const host = home();
    const title = host.querySelector('h1') as HTMLElement;
    expect(title.className).toBe('vh');
    expect(title.textContent).toBe(d('System chapter'));
    expect(host.querySelectorAll('h1')).toHaveLength(1);
    expect(host.querySelector('.home-lead, .home-title, .home-why')).toBeNull();
    expect(host.textContent).not.toContain(d('A small synthetic system.'));
  });
});

describe('the atlas', () => {
  it('draws one node per domain with its name, count and aria label, the centre dashed, and one line per hand-over', () => {
    const host = home();
    expect(Array.from(host.querySelectorAll('[data-node]')).map((one) => one.getAttribute('data-node')).sort()).toEqual(['d1', 'd2', 'd3', 'd4']);
    const one = node(host, 'd2');
    expect(one.getAttribute('role')).toBe('button');
    expect(one.getAttribute('tabindex')).toBe('0');
    expect(one.getAttribute('aria-label')).toBe(marked['page.map.node'].replace('{name}', d('Orders')).replace('{count}', '1'));
    expect(one.textContent).toContain(d('Orders'));
    expect(one.textContent).toContain(marked['page.map.features'].replace('{count}', '1'));
    expect(node(host, 'd1').classList.contains('center')).toBe(true);
    expect(node(host, 'd2').classList.contains('center')).toBe(false);
    expect(host.querySelectorAll('[data-edge]')).toHaveLength(5);
    expect(host.querySelector('.legend')?.textContent).toContain(marked['page.map.legend.centre']);
    expect(map(host)?.getAttribute('class')).toBeNull();
  });

  it('gives a domain one colour on the map, in the left list and on its page: the ring position, the centre neutral', () => {
    const host = home();
    const fills = Object.fromEntries(['d1', 'd2', 'd3', 'd4'].map((id) => [id, node(host, id).getAttribute('style')]));
    const fill = (id: string) => fills[id];
    expect(fill('d1')).toContain('#DCDFE3');
    expect(new Set(['d2', 'd3', 'd4'].map((id) => fill(id))).size).toBe(3);
    cleanup();
    for (const id of ['d1', 'd2', 'd3', 'd4']) {
      const domain = mount(<AppView data={domainData()} route={parseHash(`#/product/domain/${id}`)} />);
      expect(domain.querySelector('.domain')?.getAttribute('style'), id).toBe(fill(id));
      expect(domain.querySelector(`.side-group[data-group="${id}"]`)?.getAttribute('style'), id).toBe(fill(id));
      cleanup();
    }
  });

  it('shows a domain on hover while nothing is picked: lines out in blue, lines in in ochre, the rest dimmed', () => {
    const host = home();
    fire(node(host, 'd2'), 'mouseover');
    expect(map(host)?.classList.contains('focus')).toBe(true);
    expect(classOf(host, 0)).toContain('in');
    expect(markerOf(host, 0)).toBe('url(#xv-ar-in)');
    expect(classOf(host, 2)).toContain('out');
    expect(markerOf(host, 2)).toBe('url(#xv-ar-out)');
    expect(classOf(host, 3)).toContain('in');
    expect(classOf(host, 4)).not.toContain('in');
    expect(classOf(host, 4)).not.toContain('out');
    expect(markerOf(host, 4)).toBe('url(#xv-ar-default)');
    expect(node(host, 'd2').classList.contains('on')).toBe(true);
    for (const id of ['d1', 'd3']) expect(node(host, id).classList.contains('near')).toBe(true);
    expect(node(host, 'd4').classList.contains('near')).toBe(false);
    fire(node(host, 'd2'), 'mouseout');
    expect(map(host)?.classList.contains('focus')).toBe(false);
    expect(markerOf(host, 0)).toBe('url(#xv-ar-default)');
  });

  it('shows a domain on keyboard focus as on hover, and clears it on blur', () => {
    const host = home();
    fire(node(host, 'd2'), 'focusin');
    expect(node(host, 'd2').classList.contains('on')).toBe(true);
    expect(classOf(host, 2)).toContain('out');
    expect(side(host).querySelector('h3')?.textContent).toBe(d('Orders'));
    fire(node(host, 'd2'), 'focusout');
    expect(map(host)?.classList.contains('focus')).toBe(false);
  });

  it('selects a domain on a click and keeps it after the pointer leaves, without navigating; hover does not replace it; a second click keeps it', () => {
    window.location.hash = '#/product';
    const host = home();
    fire(node(host, 'd3'), 'click');
    expect(window.location.hash).toBe('#/product');
    expect(node(host, 'd3').getAttribute('aria-pressed')).toBe('true');
    expect(node(host, 'd3').classList.contains('on')).toBe(true);
    expect(side(host).querySelector('h3')?.textContent).toBe(d('Billing'));
    expect(side(host).querySelector('h3 a')?.getAttribute('href')).toBe('#/product/domain/d3');
    expect(map(host)?.classList.contains('focus')).toBe(true);
    fire(node(host, 'd3'), 'mouseout');
    expect(node(host, 'd3').classList.contains('on')).toBe(true);
    fire(node(host, 'd2'), 'mouseover');
    expect(side(host).querySelector('h3')?.textContent).toBe(d('Billing'));
    expect(node(host, 'd2').classList.contains('on')).toBe(false);
    fire(node(host, 'd3'), 'click');
    expect(node(host, 'd3').getAttribute('aria-pressed')).toBe('true');
    fire(node(host, 'd2'), 'click');
    expect(node(host, 'd3').getAttribute('aria-pressed')).toBe('false');
    expect(node(host, 'd2').getAttribute('aria-pressed')).toBe('true');
    expect(side(host).querySelector('h3')?.textContent).toBe(d('Orders'));
    fire(host.querySelector('[data-edge="2"] .edge-hit') as Element, 'click');
    expect(node(host, 'd2').getAttribute('aria-pressed')).toBe('false');
    expect(classOf(host, 2)).toContain('picked');
    fire(node(host, 'd3'), 'click');
    expect(classOf(host, 2)).not.toContain('picked');
    expect(window.location.hash).toBe('#/product');
    window.location.hash = '';
  });

  it('clears the selection on a click on the empty map and on Escape inside the atlas', () => {
    const host = home();
    fire(node(host, 'd3'), 'click');
    fire(map(host) as Element, 'click');
    expect(node(host, 'd3').getAttribute('aria-pressed')).toBe('false');
    expect(side(host).querySelector('h3')?.textContent).toBe(marked['page.map.label']);
    fire(node(host, 'd3'), 'click');
    fire(node(host, 'd3'), 'keydown', { key: 'Escape' });
    expect(node(host, 'd3').getAttribute('aria-pressed')).toBe('false');
    expect(map(host)?.classList.contains('focus')).toBe(false);
    expect(side(host).querySelector('h3')?.textContent).toBe(marked['page.map.label']);
  });

  it('shows the side panel of the hovered domain: its name, its intro, the two headings with counts and one entry per domain at the other end, with no hand-over text', () => {
    const host = home();
    fire(node(host, 'd2'), 'mouseover');
    const panel = side(host);
    expect(panel.querySelector('h3')?.textContent).toBe(d('Orders'));
    expect(panel.querySelector('.side-hint')?.textContent).toBe(d('Takes orders.'));
    const headings = Array.from(panel.querySelectorAll('h4')).map((one) => [one.className, one.textContent]);
    expect(headings).toEqual([
      ['dir-out', marked['page.flow.out'].replace('{count}', '1')],
      ['dir-in', marked['page.flow.in'].replace('{count}', '2')],
    ]);
    const entries = (selector: string) => Array.from(panel.querySelectorAll(`${selector} + ul > li`)).map((one) => [one.getAttribute('data-other'), one.querySelector('a')?.getAttribute('href'), one.querySelector('a .link-name')?.textContent, one.querySelector('[data-part="link-count"]')?.textContent]);
    expect(entries('h4.dir-out')).toEqual([['d3', '#/product/domain/d3', d('Billing'), '1']]);
    expect(entries('h4.dir-in')).toEqual([['d1', '#/product/domain/d1', d('Platform'), '1'], ['d3', '#/product/domain/d3', d('Billing'), '1']]);
    expect(panel.querySelector('li[data-other="d1"] .mark')).not.toBeNull();
    for (const row of Array.from(panel.querySelectorAll('ul.link-list > li'))) {
      expect(row.querySelectorAll('a')).toHaveLength(1);
      expect(row.querySelector('a.link-row')?.getAttribute('href')).toBe(`#/product/domain/${row.getAttribute('data-other')}`);
      expect(row.querySelector('a .mark')).not.toBeNull();
      expect(row.querySelector('a [data-part="link-count"]')).not.toBeNull();
    }
    expect(panel.querySelectorAll('h4.dir-out + ul.link-list > li')).toHaveLength(1);
    expect(panel.querySelectorAll('h4.dir-in + ul.link-list > li')).toHaveLength(2);
    const title = panel.querySelector('h3 a.side-title-link') as HTMLAnchorElement;
    expect(title.getAttribute('href')).toBe('#/product/domain/d2');
    expect(title.getAttribute('title')).toBe(marked['page.flow.open'].replace('{name}', d('Orders')));
    expect(title.textContent).toBe(d('Orders'));
    expect(panel.querySelector('.side-go')).toBeNull();
    for (const row of Array.from(panel.querySelectorAll('a.link-row'))) expect(row.getAttribute('title')).toBe(row.querySelector('.link-name')?.textContent);
    expect(panel.querySelector('.link-list')?.hasAttribute('data-cols')).toBe(false);
    expect(panel.getAttribute('aria-live')).toBe('polite');
    expect(panel.querySelector('.ho, .ho-cites, [data-handover], a[data-feature], code')).toBeNull();
    for (const handover of domainData().domains.handovers) expect(panel.textContent).not.toContain(handover.what.slice(0, 12));
    expect(panel.textContent).not.toContain('(F1)');
  });

  it('puts a list of more than six domains in two columns and a list of six or fewer in one', () => {
    const data = domainData();
    const ids = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8'];
    const list = ids.map((id) => ({ ...data.domains.list[0], id, name: d(`Dom ${id}`), features: [] }));
    const hand = (to: string) => ({ from: 'd1', to, what: d(`To ${to}.`), features: [], cites: [] });
    const make = (others: string[]) => home({ ...data, domains: { ...data.domains, list, handovers: others.map(hand) } });
    const seven = make(['d2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8']);
    fire(node(seven, 'd1'), 'mouseover');
    expect(side(seven).querySelectorAll('.link-list > li')).toHaveLength(7);
    expect(side(seven).querySelector('.link-list')?.getAttribute('data-cols')).toBe('2');
    cleanup();
    const six = make(['d2', 'd3', 'd4', 'd5', 'd6', 'd7']);
    fire(node(six, 'd1'), 'mouseover');
    expect(side(six).querySelectorAll('.link-list > li')).toHaveLength(6);
    expect(side(six).querySelector('.link-list')?.hasAttribute('data-cols')).toBe(false);
  });

  it('counts the hand-overs with each domain at the other end in one entry', () => {
    const data = domainData();
    const extra = { from: 'd1', to: 'd2', what: d('Prices reach the orders.'), features: [], cites: ['src/f.js:1-2'] };
    const host = home({ ...data, domains: { ...data.domains, handovers: [...data.domains.handovers, extra] } });
    fire(node(host, 'd2'), 'mouseover');
    const received = Array.from(side(host).querySelectorAll('h4.dir-in + ul > li'));
    expect(received.map((one) => [one.getAttribute('data-other'), one.querySelector('[data-part="link-count"]')?.textContent])).toEqual([['d1', '2'], ['d3', '1']]);
    expect(received[0].querySelectorAll('a[href="#/product/domain/d1"]').length).toBe(1);
  });

  it('shows no cites in the technical view either', () => {
    const technical = home(domainData(), '#/technical');
    fire(node(technical, 'd2'), 'mouseover');
    expect(side(technical).querySelector('.ho-cites, code')).toBeNull();
    expect(side(technical).querySelector('.side-hint')?.textContent).toBe(d('Takes orders.'));
  });

  it('shows one hand-over when its line is clicked: the picked line blue, its two ends in full, the panel with its words', () => {
    const host = home();
    fire(host.querySelector('[data-edge="2"] .edge-hit') as Element, 'click');
    expect(classOf(host, 2)).toContain('picked');
    expect(markerOf(host, 2)).toBe('url(#xv-ar-out)');
    expect(markerOf(host, 1)).toBe('url(#xv-ar-default)');
    expect(node(host, 'd2').classList.contains('near')).toBe(true);
    expect(node(host, 'd3').classList.contains('near')).toBe(true);
    expect(node(host, 'd1').classList.contains('near')).toBe(false);
    const panel = side(host);
    expect(panel.querySelector('h3')?.textContent).toBe(d('Orders'));
    expect(panel.querySelector('.dir-out')?.textContent).toBe(`${marked['page.handover.out']} ${d('Billing')}`);
    expect(panel.querySelector('a[href="#/product/domain/d3"]')?.textContent).toBe(d('Billing'));
    expect(panel.querySelector('li, ul, .ho')).toBeNull();
    expect(panel.textContent).not.toContain(d('Order entry'));
  });

  it('selects on Enter and on Space, ignores other keys, never navigates and has a pressed state', () => {
    window.location.hash = '#/product';
    const host = home();
    fire(node(host, 'd4'), 'keydown', { key: 'Enter' });
    expect(node(host, 'd4').getAttribute('aria-pressed')).toBe('true');
    fire(node(host, 'd2'), 'keydown', { key: ' ' });
    expect(node(host, 'd2').getAttribute('aria-pressed')).toBe('true');
    expect(node(host, 'd4').getAttribute('aria-pressed')).toBe('false');
    fire(node(host, 'd3'), 'keydown', { key: 'a' });
    expect(node(host, 'd3').getAttribute('aria-pressed')).toBe('false');
    expect(window.location.hash).toBe('#/product');
    window.location.hash = '';
  });

  it('clears the picked line on a click on the empty map', () => {
    const host = home();
    fire(host.querySelector('[data-edge="2"] .edge-hit') as Element, 'click');
    expect(classOf(host, 2)).toContain('picked');
    fire(map(host) as Element, 'click');
    expect(map(host)?.classList.contains('focus')).toBe(false);
    expect(side(host).querySelector('h3')?.textContent).toBe(marked['page.map.label']);
  });

  it('has a default panel: the title, the hint and the busiest domains with their counts', () => {
    const panel = side(home());
    expect(panel.querySelector('h3')?.textContent).toBe(marked['page.map.label']);
    expect(panel.querySelector('.side-hint')?.textContent).toBe(marked['page.map.hint']);
    const rows = Array.from(panel.querySelectorAll('li')).map((one) => one.textContent);
    expect(rows).toEqual([
      `${d('Billing')}${marked['page.flow.counts'].replace('{out}', '2').replace('{in}', '2')}`,
      `${d('Orders')}${marked['page.flow.counts'].replace('{out}', '1').replace('{in}', '2')}`,
      `${d('Platform')}${marked['page.flow.counts'].replace('{out}', '2').replace('{in}', '0')}`,
      `${d('Support')}${marked['page.flow.counts'].replace('{out}', '0').replace('{in}', '1')}`,
    ]);
  });
});

describe('the phone list and the stylesheet', () => {
  const css = readFileSync(join(__dirname, '../src/index.css'), 'utf-8');
  const phone = css.slice(css.indexOf('@media (max-width: 900px) {\n  .atlas'));

  it('has one details per domain with its counts, the two lists and the open link, in the page beside the atlas', () => {
    const host = home();
    const rows = Array.from(host.querySelectorAll('.rel-list details'));
    expect(rows.map((one) => one.getAttribute('data-domain'))).toEqual(['d1', 'd2', 'd3', 'd4']);
    expect(rows[1].querySelector('summary')?.textContent).toBe(`${d('Orders')}${marked['page.flow.counts'].replace('{out}', '1').replace('{in}', '2')}`);
    expect(rows[1].querySelectorAll('li')).toHaveLength(3);
    expect(rows[1].querySelector('.side-go')?.getAttribute('href')).toBe('#/product/domain/d2');
    expect(host.querySelector('#h-map')?.textContent).toBe(marked['page.map.label']);
  });

  it('hides the atlas and shows the list under 900px, and the list is hidden above', () => {
    expect(css).toMatch(/\.rel-list \{ display: none; \}/);
    expect(phone).toMatch(/\.atlas \{ display: none; \}/);
    expect(phone).toMatch(/\.rel-list \{ display: block;/);
  });

  it('lets the side panel grow with its content (no inner scroll, no fixed size) and has no card grid, no all-caps label', () => {
    const rule = css.match(/\.atlas-side \{([^}]*)\}/)?.[1] ?? '';
    expect(rule).not.toBe('');
    expect(css).toMatch(/\.link-list \{[^}]*padding: 0 0 0 1[2-6]px;/);
    expect(css).toMatch(/\.link-row \{ display: flex; align-items: center; gap: 8px; min-width: 0; padding: 4px 8px; border-radius: 6px;/);
    expect(css).toMatch(/\.link-row:hover, \.link-row:focus-visible \{ background: var\(--tint\); \}/);
    expect(css).toMatch(/\.link-count \{ margin-left: auto;/);
    expect(css).toMatch(/\.link-list\[data-cols="2"\] \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
    expect(css).toMatch(/\.link-name \{[^}]*text-overflow: ellipsis;/);
    expect(rule).not.toContain('contain: size');
    expect(rule).not.toMatch(/overflow(-y)?: (auto|scroll)/);
    expect(css).toMatch(/\.atlas \{ display: grid; grid-template-columns: minmax\(0, 1fr\) 340px;/);
    expect(css).not.toContain('text-transform: uppercase');
  });
});

describe('the open-domains button and what the home page does not have', () => {
  it('has the hidden title, then one button at the top left of the map, above it', () => {
    const host = home();
    const button = host.querySelector('a[data-part="open-domains"]') as HTMLAnchorElement;
    expect(button.getAttribute('href')).toBe('#/product/domain/d1');
    expect(button.textContent).toBe(marked['page.home.openDomains']);
    expect(host.querySelectorAll('a[data-part="open-domains"]')).toHaveLength(1);
    const parts = ['h1', 'a[data-part="open-domains"]', '[data-part="atlas"]'].map((selector) => host.querySelector(selector) as Element);
    parts.forEach((part, at) => { if (at > 0) expect(parts[at - 1].compareDocumentPosition(part) & Node.DOCUMENT_POSITION_FOLLOWING, parts[at].className).toBeTruthy(); });
    expect(button.parentElement?.className).toBe('map-head');
    expect(button.parentElement?.parentElement?.className).toBe('atlas-section');
    // The button is at the left of the row, where the reader starts reading, not pushed to the right.
    expect(readFileSync(join(__dirname, '../src/index.css'), 'utf-8')).toMatch(/\.map-head \.open-domains \{ flex: none; \}/);
  });

  it('leaves the domains page out of the left list, and the button opens the first domain', () => {
    const outline = outlineWithFeatures();
    const indexed = domainData({ outline: { ...outline, parts: [{ title: d('Domains'), blocks: [{ block: 'domains', kind: 'chapter', title: d('Domains') }] }, ...outline.parts] } });
    const host = home(indexed);
    expect(host.querySelector('.side [data-page="chapter:domains"]')).toBeNull();
    expect(host.querySelector('.side [data-ref-group="d~Domains"]')).toBeNull();
    expect(host.querySelector('a[data-part="open-domains"]')?.getAttribute('href')).toBe('#/product/domain/d1');
    expect(host.querySelector('.side [data-page="chapter:system"]')).not.toBeNull();
  });

  it('has no feature list, no counts, no domain navigation and no architecture section, in either view', () => {
    for (const hash of ['#/product', '#/technical']) {
      const host = home(domainData(), hash);
      const main = host.querySelector('main') as HTMLElement;
      expect(main.querySelector('[data-part="overview-counts"], [data-part="overview-grid"], .ov-block, [data-part="architecture"]'), hash).toBeNull();
      expect(main.querySelector('.dom-table, [data-part="domain-table"], .ref-group, #h-refs, #h-domains'), hash).toBeNull();
      // Outside the map and its phone list the page has one link: the button.
      expect(Array.from(main.querySelectorAll('a')).filter((one) => !one.closest('.atlas, .rel-list')).map((one) => one.getAttribute('href')), hash).toEqual([`${hash}/domain/d1`]);
    }
  });

  it('shows the left list in its global state beside the page', () => {
    const host = home();
    expect(frame(host).getAttribute('data-side')).toBe('global');
    expect(host.querySelector('nav.side')?.getAttribute('data-side')).toBe('global');
  });

  it('has no button when the page has no domain', () => {
    const none = domainData({ outline: { source: 'default', problems: [], parts: [{ title: d('System'), blocks: [{ block: 'system', kind: 'chapter', title: d('System chapter') }] }], unplaced: [] }, domains: { state: 'failed', list: [], handovers: [] } });
    expect(home(none).querySelector('a[data-part="open-domains"]')).toBeNull();
  });
});

describe('without a usable list', () => {
  const without = (state: 'missing' | 'failed' | 'changed') => domainData({ domains: { state, list: [], handovers: [] } });

  it('has no map, no phone list and one quiet line that says why, for each state', () => {
    for (const state of ['missing', 'failed', 'changed'] as const) {
      const host = home(without(state));
      expect(host.querySelector('[data-part="atlas"]'), state).toBeNull();
      expect(host.querySelector('.rel-list')).toBeNull();
      expect(host.querySelector('[data-part="no-map"]')?.textContent, state).toBe(marked[`page.home.noMap.${state}`]);
      expect(host.querySelector('.home-lead strong')).toBeNull();
    }
  });

  it('keeps the button, to the first group of the outline, at the right above the no-map line', () => {
    const host = home(without('failed'));
    const line = host.querySelector('[data-part="no-map"]') as Element;
    const button = host.querySelector('a[data-part="open-domains"]') as Element;
    expect(button.getAttribute('href')).toBe('#/product/domain/d1');
    expect(button.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(button.parentElement?.className).toBe('map-head');
    expect((host.querySelector('h1') as Element).compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(host.querySelector('.home-lead')).toBeNull();
    expect(host.querySelector('[data-part="overview-grid"], [data-part="overview-counts"]')).toBeNull();
  });

  it('treats an ok list with no domain as having no map', () => {
    const host = home(domainData({ domains: { state: 'ok', list: [], handovers: [] } }));
    expect(host.querySelector('[data-part="atlas"]')).toBeNull();
    expect(host.querySelector('[data-part="no-map"]')?.textContent).toBe(marked['page.home.noMap.missing']);
  });
});
