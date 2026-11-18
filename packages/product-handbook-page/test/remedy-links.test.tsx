// @vitest-environment happy-dom
// Task 7.3 of openspec change handbook-process-review: a problem row expands to one link per remedies item that names it (each
// opening the improvement suggestions page at that item), the link to the dimension section for an old chapter without ids, the
// process of a design row, ids in the remedies text as links (only for ids that exist), the anchors on the items, and the row a
// link from the remedies page opens. Data is written by hand.
import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { App, AppView } from '../src/App';
import { parseHash } from '../src/lib/route';
import type { PageData, ProblemRow, ProcessesData } from '../src/lib/types';
import { cleanup, mount } from './dom';
import { domainData } from './domains-fixture';
import { d, marked } from './page-fixture';

afterEach(() => { cleanup(); window.history.replaceState(null, '', '#'); });
beforeEach(() => { window.history.replaceState(null, '', '#'); });

const fixed = (key: string, values: Record<string, string | number> = {}): string => marked[key].replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole));

const design = (id: string, over: Partial<ProblemRow> = {}): ProblemRow => ({
  id, type: 'design', level: 'high', group: 'duplication', features: ['F2'], summary: d(`design ${id}`),
  texts: { product: { situation: d(`situation ${id}`), consequence: d(`consequence ${id}`) }, technical: { situation: d(`tech situation ${id}`), consequence: d(`tech consequence ${id}`) } },
  cites: ['src/x.js:10-12', 'src/y.js:2'], source: { chapter: 'review', line: 6 }, remedies: [], ...over,
});
const defect = (id: string, over: Partial<ProblemRow> = {}): ProblemRow => ({
  id, type: 'defect', level: 'P1', group: 'security', features: ['F2'], summary: d(`defect ${id}`), texts: { product: d(`text ${id}`), technical: d(`tech ${id}`) },
  source: { chapter: 'defects', line: 4 }, remedies: [], ...over,
});

const PROCESSES: ProcessesData = {
  items: [{ id: 'P1', name: d('Order to invoice'), features: ['F2'], steps: [{ role: d('Clerk'), operation: d('Enter an order'), feature: 'F2', text: d('Saves.') }] }],
  coverage: [],
};

// Lines (the title is line 1): 5 and 9 hold items that name R1; 13 an item that names D1 and an id no row has.
const REMEDIES = [
  `# ${d('Remedies')}`, '', `## ${d('Across processes')}`, '',
  `- ${d('Merge the entrances')} [P1, R1, D1]`, '', `## ${d('Fixes')}`, '',
  `- ${d('Show the button')} [R1]`, '', `## ${d('Defects')}`, '',
  `1. ${d('Move the secret')} [D1, D99, P9]`, '',
  `## ${d('Problems no measure addresses')}`, '', `- R2 ${d('Not addressed')}`, '',
].join('\n');

const data = (over: Partial<PageData> = {}, remedies = REMEDIES): PageData => {
  const base = domainData();
  const outline = { ...base.outline, parts: [...base.outline.parts, { title: d('Problems part'), blocks: [{ block: 'remedies', kind: 'chapter' as const, title: d('Remedies') }] }] };
  return domainData({
    outline,
    chapters: [...base.chapters, { id: 'remedies', texts: { product: remedies, technical: remedies } }],
    processes: PROCESSES,
    problems: {
      sources: { defects: { state: 'ok', count: 1 }, design: { state: 'ok', count: 2 }, open: { state: 'ok', count: 0, unmatched: [] } },
      rows: [
        defect('d1', { remedies: [{ heading: d('Across processes'), anchor: 'remedy-5' }, { heading: d('Defects'), anchor: 'remedy-13' }] }),
        design('r1', { process: 'P1', remedies: [{ heading: d('Across processes'), anchor: 'remedy-5' }, { heading: d('Fixes'), anchor: 'remedy-9' }] }),
        design('r2'),
      ],
      remedies: 'remedies',
    },
    ...over,
  });
};

const render = (page: PageData, hash: string): string => renderToStaticMarkup(<AppView data={page} route={parseHash(hash)} />);
const decode = (text: string): string => text.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const expand = (host: HTMLElement, id: string): HTMLElement => {
  act(() => (host.querySelector(`[data-problem="${id}"] button`) as HTMLElement).click());
  return host.querySelector(`[data-problem="${id}"]`) as HTMLElement;
};
const follow = (link: HTMLAnchorElement) => act(async () => { window.location.hash = link.getAttribute('href') as string; await new Promise((done) => { setTimeout(done, 40); }); });

describe('the expansion of a row', () => {
  it('shows a design problem of the technical view with its situation, consequence, citations and one link to each item that names it', () => {
    window.history.replaceState(null, '', '#/technical/problems');
    const host = mount(<App data={data()} />);
    const row = expand(host, 'r1');
    const text = row.textContent ?? '';
    expect(text).toContain(d('tech situation r1'));
    expect(text).toContain(d('tech consequence r1'));
    expect(row.querySelectorAll('[data-part="citation"]')).toHaveLength(2);
    const links = Array.from(row.querySelectorAll<HTMLAnchorElement>('[data-part="remedy-link"]'));
    expect(links.map((link) => link.getAttribute('data-anchor'))).toEqual(['remedy-5', 'remedy-9']);
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['#/technical/remedies', '#/technical/remedies']);
    expect(links.map((link) => link.textContent)).toEqual([fixed('page.problems.remedyItem', { n: 1, heading: d('Across processes') }), fixed('page.problems.remedyItem', { n: 2, heading: d('Fixes') })]);
    const process = row.querySelector<HTMLAnchorElement>('[data-part="process-link"]');
    expect(process?.getAttribute('href')).toBe('#/technical/processes/P1');
    expect(process?.textContent).toBe(`P1 ${d('Order to invoice')}`);
  });

  it('shows no link for a row no item names, and no process line for a row without a process', () => {
    window.history.replaceState(null, '', '#/product/problems');
    const host = mount(<App data={data()} />);
    const row = expand(host, 'r2');
    expect(row.querySelector('[data-part="remedy-link"]')).toBeNull();
    expect(row.querySelector('[data-field="remedy"]')?.textContent).toBe(fixed('page.problems.noRemedy'));
    expect(row.querySelector('[data-field="process"]')).toBeNull();
  });

  it('links an old output (the remedies name no id) to the section of the dimension, and the link opens the page at that heading', async () => {
    const old = [`# ${d('Remedies')}`, '', `## ${d('Security')}`, '', d('fix secrets'), '', `## ${d('Duplication')}`, '', d('merge them'), ''].join('\n');
    const page = data({}, old);
    page.problems.rows[1] = design('r1', { remedies: [{ heading: d('Duplication'), anchor: 'h-1' }] });
    window.history.replaceState(null, '', '#/product/problems');
    const scrolled: string[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function scrollIntoViewStub(this: Element) { scrolled.push(this.id); } as typeof Element.prototype.scrollIntoView;
    try {
      const host = mount(<App data={page} />);
      const row = expand(host, 'r1');
      const links = row.querySelectorAll<HTMLAnchorElement>('[data-part="remedy-link"]');
      expect(links).toHaveLength(1);
      expect(links[0].textContent).toBe(fixed('page.problems.remedyLink'));
      act(() => links[0].click());
      await follow(links[0]);
      expect(host.querySelector('[data-view="remedies"]')).not.toBeNull();
      expect(scrolled).toContain('h-1');
      expect(document.activeElement?.id).toBe('h-1');
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('opens the page at the item the link names', async () => {
    window.history.replaceState(null, '', '#/product/problems');
    const scrolled: string[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function scrollIntoViewStub(this: Element) { scrolled.push(this.id); } as typeof Element.prototype.scrollIntoView;
    try {
      const host = mount(<App data={data()} />);
      const row = expand(host, 'd1');
      const links = Array.from(row.querySelectorAll<HTMLAnchorElement>('[data-part="remedy-link"]'));
      expect(links).toHaveLength(2);
      act(() => links[1].click());
      await follow(links[1]);
      expect(scrolled).toContain('remedy-13');
      expect(document.activeElement?.id).toBe('remedy-13');
      expect(document.activeElement?.textContent).toContain(d('Move the secret'));
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });
});

describe('the remedies page', () => {
  const html = decode(render(data(), '#/product/remedies'));

  it('puts the anchor of its line on each item', () => {
    for (const [anchor, word] of [['remedy-5', 'Merge the entrances'], ['remedy-9', 'Show the button'], ['remedy-13', 'Move the secret']] as const) {
      const at = html.indexOf(`id="${anchor}"`);
      expect(at, anchor).toBeGreaterThan(-1);
      expect(html.slice(at, at + 200)).toContain(d(word));
    }
  });

  it('turns each id of an id group into a link: D and R to the row of the problems page, P to the process; an id that does not exist stays text', () => {
    const first = html.slice(html.indexOf('id="remedy-5"'), html.indexOf('id="remedy-9"'));
    expect(first).toContain('<a href="#/product/processes/P1" data-item="P1">P1</a>');
    expect(first).toContain('<a href="#/product/problems?row=r1" data-item="R1">R1</a>');
    expect(first).toContain('<a href="#/product/problems?row=d1" data-item="D1">D1</a>');
    const last = html.slice(html.indexOf('id="remedy-13"'));
    expect(last).toContain('[<a href="#/product/problems?row=d1" data-item="D1">D1</a>, D99, P9]');
  });

  it('links the id that starts an item of the generated section', () => {
    const generated = html.slice(html.indexOf(d('Problems no measure addresses')));
    expect(generated).toContain('<a href="#/product/problems?row=r2" data-item="R2">R2</a>');
  });

  it('links no id when the page has no such row or process', () => {
    const bare = decode(render(data({ processes: null, problems: { sources: data().problems.sources, rows: [], remedies: 'remedies' } }), '#/product/remedies'));
    expect(bare).not.toContain('data-item=');
    expect(bare).toContain('[P1, R1, D1]');
  });
});

describe('the address of a row', () => {
  it('scrolls to the named row after the app has scrolled to the top, not before', async () => {
    window.history.replaceState(null, '', '#/technical/problems?row=r2');
    const events: string[] = [];
    const scrollTo = window.scrollTo;
    window.scrollTo = (() => { events.push('top'); }) as typeof window.scrollTo;
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function scrollIntoViewStub(this: Element) { events.push(`row:${this.closest('[data-problem]')?.getAttribute('data-problem')}`); } as typeof Element.prototype.scrollIntoView;
    try {
      mount(<App data={data()} />);
      await act(async () => { await new Promise((done) => { setTimeout(done, 80); }); });
      expect(events).toContain('row:r2');
      expect(events.indexOf('top')).toBeGreaterThanOrEqual(0);
      expect(events.indexOf('top')).toBeLessThan(events.lastIndexOf('row:r2'));
    } finally {
      window.scrollTo = scrollTo;
      Element.prototype.scrollIntoView = original;
    }
  });

  it('keeps the items and the rows clear of the sticky top bar when scrolled to', () => {
    const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf-8');
    expect(css).toMatch(/\[id\^="remedy-"\][^{]*\{[^}]*scroll-margin-top: calc\(var\(--topbar-h\)/);
    expect(css).toMatch(/\.prob \{[^}]*scroll-margin-top: calc\(var\(--topbar-h\)/);
  });

  it('opens the named row and scrolls to it, and a change of a filter drops it', async () => {
    window.history.replaceState(null, '', '#/product/problems?row=r1');
    const scrolled: string[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function scrollIntoViewStub(this: Element) { scrolled.push(this.closest('[data-problem]')?.getAttribute('data-problem') ?? this.id); } as typeof Element.prototype.scrollIntoView;
    try {
      const host = mount(<App data={data()} />);
      expect(host.querySelector('[data-problem="r1"] [data-part="problem-detail"]')).not.toBeNull();
      expect(host.querySelector('[data-problem="r2"] [data-part="problem-detail"]')).toBeNull();
      await act(async () => { await new Promise((done) => { setTimeout(done, 80); }); });
      expect(scrolled).toContain('r1');
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });
});
