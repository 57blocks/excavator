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
import { domainData } from './domains-fixture';
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
  it('has the system title and the lead as inline Markdown, with no counts sentence in the lead', () => {
    const host = home();
    expect(host.querySelector('h1')?.textContent).toBe(d('System chapter'));
    const lead = host.querySelector('.home-lead') as HTMLElement;
    expect(lead.querySelector('em')?.textContent).toBe('synthetic');
    expect(lead.querySelector('strong')).toBeNull();
    expect(lead.textContent).toBe(d('A small synthetic system.'));
    expect(lead.querySelector('p')).toBeNull();
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

  it('opens the domain page on a click on a node, and a click on the empty map opens nothing', () => {
    window.location.hash = '#/product';
    const host = home();
    fire(map(host) as Element, 'click');
    expect(window.location.hash).toBe('#/product');
    fire(node(host, 'd3'), 'click');
    expect(window.location.hash).toBe('#/product/domain/d3');
    window.location.hash = '';
  });

  it('shows the side panel of the hovered domain: its name, its intro as plain text, the two lists with links and the link to its page', () => {
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
    expect(Array.from(panel.querySelectorAll('[data-handover]')).map((one) => one.getAttribute('data-handover'))).toEqual(['2', '0', '3']);
    expect(panel.querySelector('h4.dir-in + ul > li[data-other="d1"] > b a[href="#/product/domain/d1"]')?.textContent).toBe(d('Platform'));
    const links = Array.from(panel.querySelectorAll('[data-handover="0"] a[data-feature]'));
    expect(links.map((one) => [one.getAttribute('href'), one.textContent])).toEqual([['#/product/chapter/F1', d('Platform core')], ['#/product/chapter/F2', d('Order entry')]]);
    expect(panel.textContent).not.toContain('(F1)');
    expect(panel.querySelector('.side-go')?.getAttribute('href')).toBe('#/product/domain/d2');
    expect(panel.querySelector('.side-go')?.textContent).toBe(marked['page.flow.open'].replace('{name}', d('Orders')));
    expect(panel.getAttribute('aria-live')).toBe('polite');
    expect(panel.querySelector('.ho-cites')).toBeNull();
  });

  it('groups the hand-overs of the side panel by the domain at the other end, as the domain page does', () => {
    const data = domainData();
    const extra = { from: 'd1', to: 'd2', what: d('Prices reach the orders.'), features: [], cites: ['src/f.js:1-2'] };
    const host = home({ ...data, domains: { ...data.domains, handovers: [...data.domains.handovers, extra] } });
    fire(node(host, 'd2'), 'mouseover');
    const received = Array.from(side(host).querySelectorAll('h4.dir-in + ul > li'));
    expect(received.map((one) => [one.getAttribute('data-other'), Array.from(one.querySelectorAll('[data-handover]')).map((ho) => ho.getAttribute('data-handover'))])).toEqual([['d1', ['0', '5']], ['d3', ['3']]]);
    expect(received[0].querySelectorAll('a[href="#/product/domain/d1"]').length).toBe(1);
  });

  it('shows the cites as quiet monospace text in the technical view only', () => {
    const technical = home(domainData(), '#/technical');
    fire(node(technical, 'd2'), 'mouseover');
    expect(Array.from(side(technical).querySelectorAll('.ho-cites code')).map((one) => one.textContent)).toEqual(['src/c.js:2-2', 'src/a.js:1-3', 'src/d.js:7-8']);
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
    expect(panel.querySelectorAll('li')).toHaveLength(1);
    expect(panel.querySelector('li')?.textContent).toContain(d('Order entry'));
  });

  it('opens the domain page on Enter and on Space, ignores other keys, and has no pressed state', () => {
    window.location.hash = '#/product';
    const host = home();
    fire(node(host, 'd4'), 'keydown', { key: 'Enter' });
    expect(window.location.hash).toBe('#/product/domain/d4');
    fire(node(host, 'd2'), 'keydown', { key: ' ' });
    expect(window.location.hash).toBe('#/product/domain/d2');
    fire(node(host, 'd3'), 'keydown', { key: 'a' });
    expect(window.location.hash).toBe('#/product/domain/d2');
    expect(node(host, 'd4').hasAttribute('aria-pressed')).toBe(false);
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

  it('keeps the side panel from stretching the map and has no card grid, no all-caps label', () => {
    expect(css).toMatch(/\.atlas-side \{[^}]*overflow: auto;[^}]*contain: size;/);
    expect(css).toMatch(/\.atlas \{ display: grid; grid-template-columns: minmax\(0, 1fr\) 340px;/);
    expect(css).not.toContain('text-transform: uppercase');
  });
});

describe('the open-domains button and what the home page does not have', () => {
  it('has the title, the lead, then one button that opens the first domain at the top right of the map, above it', () => {
    const host = home();
    const button = host.querySelector('a[data-part="open-domains"]') as HTMLAnchorElement;
    expect(button.getAttribute('href')).toBe('#/product/domain/d1');
    expect(button.textContent).toBe(marked['page.home.openDomains']);
    expect(host.querySelectorAll('a[data-part="open-domains"]')).toHaveLength(1);
    const parts = ['h1', '.home-lead', 'a[data-part="open-domains"]', '[data-part="atlas"]'].map((selector) => host.querySelector(selector) as Element);
    parts.forEach((part, at) => { if (at > 0) expect(parts[at - 1].compareDocumentPosition(part) & Node.DOCUMENT_POSITION_FOLLOWING, parts[at].className).toBeTruthy(); });
    expect(button.parentElement?.className).toBe('map-head');
    expect(button.parentElement?.parentElement?.className).toBe('atlas-section');
    expect(readFileSync(join(__dirname, '../src/index.css'), 'utf-8')).toMatch(/\.map-head \.open-domains \{[^}]*margin-left: auto;/);
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
    expect((host.querySelector('.home-lead') as Element).compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(host.querySelector('[data-part="overview-grid"], [data-part="overview-counts"]')).toBeNull();
  });

  it('treats an ok list with no domain as having no map', () => {
    const host = home(domainData({ domains: { state: 'ok', list: [], handovers: [] } }));
    expect(host.querySelector('[data-part="atlas"]')).toBeNull();
    expect(host.querySelector('[data-part="no-map"]')?.textContent).toBe(marked['page.home.noMap.missing']);
  });
});
