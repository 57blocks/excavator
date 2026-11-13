// @vitest-environment happy-dom
// The home page (openspec change handbook-page-domain-map, task 4.2): the lead and the counts, the atlas (selection classes and
// markers, the side panel, keyboard, clearing), the phone list in place of the map, the domain table, the references, and the
// page without a usable list (no map, one quiet line saying why).
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
const fire = (element: Element, type: string, init: Record<string, unknown> = {}): void => { act(() => { element.dispatchEvent(new (type.startsWith('key') ? KeyboardEvent : MouseEvent)(type, { bubbles: true, cancelable: true, ...init })); }); };
const markerOf = (host: HTMLElement, edge: number): string => host.querySelector(`[data-edge="${edge}"] .edge`)?.getAttribute('marker-end') ?? '';
const classOf = (host: HTMLElement, edge: number): string[] => Array.from(host.querySelector(`[data-edge="${edge}"] .edge`)?.classList ?? []);

describe('the top of the page', () => {
  it('has the system title, the lead as inline Markdown and the counts sentence with the numbers in strong', () => {
    const host = home();
    expect(host.querySelector('h1')?.textContent).toBe(d('System chapter'));
    const lead = host.querySelector('.home-lead') as HTMLElement;
    expect(lead.querySelector('em')?.textContent).toBe('synthetic');
    expect(Array.from(lead.querySelectorAll('strong')).map((one) => one.textContent)).toEqual(['4', '4', '5']);
    expect(lead.textContent).toContain(marked['page.home.counts'].replace('{domains}', '4').replace('{features}', '4').replace('{handovers}', '5'));
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

  it('gives a domain one colour on the map, in the side list and on its page: the ring position, the centre neutral', () => {
    const host = home();
    const fill = (id: string) => node(host, id).getAttribute('style');
    expect(fill('d1')).toContain('#DCDFE3');
    const ringFills = ['d2', 'd3', 'd4'].map((id) => fill(id));
    expect(new Set(ringFills).size).toBe(3);
    const rows = Array.from(host.querySelectorAll('[data-part="domain-table"] tbody tr'));
    expect(rows.map((row) => row.getAttribute('style'))).toEqual(['d1', 'd2', 'd3', 'd4'].map((id) => fill(id)));
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

  it('picks a domain on a click, keeps it while another is hovered, and unpicks it on a second click', () => {
    const host = home();
    fire(node(host, 'd3'), 'click');
    expect(node(host, 'd3').classList.contains('on')).toBe(true);
    fire(node(host, 'd2'), 'mouseover');
    expect(node(host, 'd3').classList.contains('on')).toBe(true);
    expect(node(host, 'd2').classList.contains('on')).toBe(false);
    fire(node(host, 'd3'), 'click');
    expect(map(host)?.classList.contains('focus')).toBe(false);
  });

  it('shows the side panel of the picked domain: its name, its intro as plain text, the two lists with links and the link to its page', () => {
    const host = home();
    fire(node(host, 'd2'), 'click');
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
    fire(node(host, 'd2'), 'click');
    const received = Array.from(side(host).querySelectorAll('h4.dir-in + ul > li'));
    expect(received.map((one) => [one.getAttribute('data-other'), Array.from(one.querySelectorAll('[data-handover]')).map((ho) => ho.getAttribute('data-handover'))])).toEqual([['d1', ['0', '5']], ['d3', ['3']]]);
    expect(received[0].querySelectorAll('a[href="#/product/domain/d1"]').length).toBe(1);
  });

  it('shows the cites as quiet monospace text in the technical view only', () => {
    const technical = home(domainData(), '#/technical');
    fire(node(technical, 'd2'), 'click');
    expect(Array.from(side(technical).querySelectorAll('.ho-cites code')).map((one) => one.textContent)).toEqual(['src/c.js:2-2', 'src/a.js:1-3', 'src/d.js:7-8']);
    expect(side(technical).querySelector('.side-hint')?.textContent).toBe(d('Takes orders.'));
    expect(technical.querySelector('tr[data-domain="d2"] td')?.textContent).toBe(d('Takes orders.'));
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

  it('selects with Enter and with Space, ignores other keys, and clears on a click on the empty map', () => {
    const host = home();
    fire(node(host, 'd4'), 'keydown', { key: 'Enter' });
    expect(node(host, 'd4').classList.contains('on')).toBe(true);
    expect(node(host, 'd4').getAttribute('aria-pressed')).toBe('true');
    fire(node(host, 'd4'), 'keydown', { key: 'Enter' });
    expect(map(host)?.classList.contains('focus')).toBe(false);
    fire(node(host, 'd2'), 'keydown', { key: ' ' });
    expect(node(host, 'd2').classList.contains('on')).toBe(true);
    fire(node(host, 'd3'), 'keydown', { key: 'a' });
    expect(node(host, 'd3').classList.contains('on')).toBe(false);
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
    expect(phone).toMatch(/\.col-hide \{ display: none; \}/);
  });

  it('keeps the side panel from stretching the map and has no card grid, no all-caps label', () => {
    expect(css).toMatch(/\.atlas-side \{[^}]*overflow: auto;[^}]*contain: size;/);
    expect(css).toMatch(/\.atlas \{ display: grid; grid-template-columns: minmax\(0, 1fr\) 340px;/);
    expect(css).not.toContain('text-transform: uppercase');
  });
});

describe('the domain table and the references', () => {
  it('lists each domain with its mark and link, what it does, its feature count and the domains it receives from and hands over to', () => {
    const host = home();
    const head = Array.from(host.querySelectorAll('.dom-table thead th')).map((one) => one.textContent);
    expect(head).toEqual(['Domain', 'What it does', 'Features', 'Receives from', 'Hands over to'].map((word) => `@@${word}`));
    const rows = Array.from(host.querySelectorAll('.dom-table tbody tr'));
    expect(rows).toHaveLength(4);
    const cells = (row: Element) => Array.from(row.children).map((cell) => cell.textContent);
    expect(cells(rows[0])).toEqual([d('Platform'), 'd~Runs the base services.', '1', '', `${d('Orders')}${d('Billing')}`]);
    expect(rows[0].children[3].getAttribute('data-empty')).toBe('true');
    expect(rows[0].querySelector('strong')?.textContent).toBe('base');
    expect(cells(rows[1])).toEqual([d('Orders'), d('Takes orders.'), '1', `${d('Platform')}${d('Billing')}`, d('Billing')]);
    expect(rows[1].querySelector('th a')?.getAttribute('href')).toBe('#/product/domain/d2');
    expect(rows[1].children[3].querySelectorAll('a.end')).toHaveLength(2);
    expect(rows[1].children[3].classList.contains('col-hide')).toBe(true);
  });

  it('lists the references as links, in the order of the page', () => {
    const host = home();
    const refs = Array.from(host.querySelectorAll('.ref-list a')).map((one) => [one.getAttribute('href'), one.textContent]);
    expect(refs).toEqual([['#/product/chapter/system', marked['page.nav.system']], ['#/product/history', marked['md.history.heading']], ['#/product/coverage', marked['page.nav.coverage']]]);
  });
});

describe('without a usable list', () => {
  const without = (state: 'missing' | 'failed' | 'changed') => domainData({ domains: { state, list: [], handovers: [] } });

  it('has no map, no relation columns and one quiet line that says why, for each state', () => {
    for (const state of ['missing', 'failed', 'changed'] as const) {
      const host = home(without(state));
      expect(host.querySelector('[data-part="atlas"]'), state).toBeNull();
      expect(host.querySelector('.rel-list')).toBeNull();
      expect(host.querySelector('[data-part="no-map"]')?.textContent, state).toBe(marked[`page.home.noMap.${state}`]);
      expect(Array.from(host.querySelectorAll('.dom-table thead th')).map((one) => one.textContent)).toEqual([marked['page.table.name'], marked['page.table.features']]);
      expect(host.querySelector('.home-lead strong')).toBeNull();
    }
  });

  it('groups by the parts of the outline and still lists the groups and the references', () => {
    const host = home(without('failed'));
    expect(Array.from(host.querySelectorAll('.dom-table tbody th a')).map((one) => [one.getAttribute('href'), one.textContent])).toEqual([['#/product/domain/d1', d('Features')]]);
    expect(host.querySelectorAll('.ref-list a')).toHaveLength(3);
  });

  it('treats an ok list with no domain as having no map', () => {
    const host = home(domainData({ domains: { state: 'ok', list: [], handovers: [] } }));
    expect(host.querySelector('[data-part="atlas"]')).toBeNull();
    expect(host.querySelector('[data-part="no-map"]')?.textContent).toBe(marked['page.home.noMap.missing']);
  });
});
