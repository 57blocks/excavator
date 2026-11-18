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
import type { PageData, ProblemRow, ProcessesData, RemedyDomains } from '../src/lib/types';
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
    expect(process?.textContent).toBe(d('Order to invoice'));
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
      expect(html.slice(at, at + 1200)).toContain(d(word));
    }
  });

  it('shows no process number in an id group, and links the ids that are rows (the chapter as it is, without the layout by domain)', () => {
    const first = html.slice(html.indexOf('id="remedy-5"'), html.indexOf('id="remedy-9"'));
    expect(first).not.toContain('data-item="P1"');
    expect(first).toContain('<a href="#/product/problems?row=r1" data-item="R1">R1</a>');
    expect(first).toContain('<a href="#/product/problems?row=d1" data-item="D1">D1</a>');
    expect(first).not.toContain('data-part="remedy-problems"');
    const last = html.slice(html.indexOf('id="remedy-13"'));
    expect(last).toContain('D99]');
    expect(last).not.toContain('P9');
  });

  it('links the id that starts an item of the generated section', () => {
    const generated = html.slice(html.indexOf(d('Problems no measure addresses')));
    expect(generated).toContain('<a href="#/product/problems?row=r2" data-item="R2">R2</a>');
  });

  it('links no id when the page has no such row', () => {
    const bare = decode(render(data({ processes: null, problems: { sources: data().problems.sources, rows: [], remedies: 'remedies' } }), '#/product/remedies'));
    expect(bare).not.toContain('data-item=');
    expect(bare).toContain('[R1, D1]');
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

// A remedies chapter with the sections of two processes in front of a fixed section (lines: P1 item 5, P2 item 9, fixed items 13 and 15).
const BY_PROCESS = [
  `# ${d('Remedies')}`, '', `## P1 ${d('Order to invoice')}`, '',
  `- **${d('Merge the entrances')}** ${d('Close in one place')} [P1, R1, D1]`, '', `## P2 ${d('Follow-up')}`, '',
  `- **${d('Mail it')}** ${d('Send the mail')} [P2, R2]`, '', `## ${d('Fixes')}`, '',
  `- **${d('Show the button')}** ${d('Make it visible')} [R1, D1, D99]`, '',
  `- **${d('Other')}** ${d('Text without ids')}`, '',
].join('\n');
const byProcess = (): PageData => {
  const base = data({}, BY_PROCESS);
  const processes: ProcessesData = { items: [
    { ...PROCESSES.items[0], remedies: [{ line: 5, texts: { product: `**${d('Merge the entrances')}** ${d('Close in one place')} [P1, R1, D1]`, technical: `**${d('Merge the entrances')}** ${d('Close in one place')} [P1, R1, D1]` } }] },
    { id: 'P2', name: d('Follow-up'), features: ['F2'], steps: [], remedies: [{ line: 9, texts: { product: `**${d('Mail it')}** ${d('Send the mail')} [P2, R2]`, technical: `**${d('Mail it')}** ${d('Send the mail')} [P2, R2]` } }] },
  ], coverage: [] };
  const rows = base.problems.rows.map((row) => (row.id === 'r1' ? { ...row, remedies: [{ heading: `P1 ${d('Order to invoice')}`, anchor: 'remedy-5', process: 'P1' }, { heading: d('Fixes'), anchor: 'remedy-13' }] } : row));
  return { ...base, processes, problems: { ...base.problems, rows } };
};

describe('the remedies page with sections of processes', () => {
  const html = decode(render(byProcess(), '#/product/remedies'));

  it('folds the sections of the processes into one section of links, one row for each process with its number of suggestions', () => {
    const fold = html.slice(html.indexOf('data-part="remedy-processes"'), html.indexOf('data-part="remedies"') + 4000);
    expect(fold).toContain(`<h2>${fixed('page.remedies.processes')}</h2>`);
    expect(fold).toContain(`href="#/product/processes/P1"><span class="proc-name">${d('Order to invoice')}</span><span class="proc-count">${fixed('page.remedies.suggestionCount', { count: 1 })}</span>`);
    expect(fold).toContain('href="#/product/processes/P2"');
    expect(html).not.toContain(`>P1 ${d('Order to invoice')}</h2>`);
    expect(html).not.toContain(d('Close in one place'));
    expect(html).not.toContain(d('Send the mail'));
    // The fixed section stays, with its anchors on the lines they had.
    expect(html).toContain(d('Fixes'));
    expect(html.indexOf('id="remedy-13"')).toBeGreaterThan(-1);
    expect(html.indexOf('id="remedy-15"')).toBeGreaterThan(-1);
    expect(html.indexOf('data-part="remedy-processes"')).toBeLessThan(html.indexOf('id="remedy-13"'));
  });

  it('leaves a remedies chapter without sections of processes as it is: no folded section, the headings in place', () => {
    const old = decode(render(data(), '#/product/remedies'));
    expect(old).not.toContain('data-part="remedy-processes"');
    expect(old).not.toContain(fixed('page.remedies.processes'));
    expect(old).toContain(d('Across processes'));
  });
});

describe('a link of a row to a suggestion under a process', () => {
  it('opens the page of the process at that suggestion, and a link to a fixed section still opens the remedies page', async () => {
    window.history.replaceState(null, '', '#/product/problems');
    const scrolled: string[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function scrollIntoViewStub(this: Element) { scrolled.push(this.id); } as typeof Element.prototype.scrollIntoView;
    try {
      const host = mount(<App data={byProcess()} />);
      const row = expand(host, 'r1');
      const links = Array.from(row.querySelectorAll<HTMLAnchorElement>('[data-part="remedy-link"]'));
      expect(links.map((link) => link.getAttribute('href'))).toEqual(['#/product/processes/P1', '#/product/remedies']);
      act(() => links[0].click());
      await follow(links[0]);
      expect(host.querySelector('[data-view="process"]')?.getAttribute('data-process')).toBe('P1');
      expect(scrolled).toContain('remedy-5');
      expect(document.activeElement?.id).toBe('remedy-5');
      expect(document.activeElement?.textContent).toContain(d('Close in one place'));
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('keeps the suggestions of a process clear of the top bar when scrolled to (the same margin as on the remedies page)', () => {
    const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf-8');
    expect(css).toMatch(/\[id\^="remedy-"\][^{]*\{[^}]*scroll-margin-top: calc\(var\(--topbar-h\)/);
  });
});

describe('the category word of a suggestion', () => {
  const page = (): PageData => {
    const base = data();
    const rows = ['d1', 'd2', 'd3', 'd4', 'd5'].map((id) => defect(id));
    const text = [`# ${d('Remedies')}`, '', `## ${d('Fixes')}`, '',
      `- **${d('Fix')}** ${d('text')} [P1, D1, D2, D3, D4, D5].`, '',
      `- **${d('Only defects')}** ${d('more text')} [D1, D2].`, '',
      `- **${d('Unknown')}** ${d('some text')} [D1, D99].`, '',
      `- **authorization** ${d('Category word')} [D1].`, '', `- **${d('Fix')}** ${d('Plain bold')}.`, '',
      `## ${d('Problems no measure addresses')}`, '', `- D1 ${d('Not addressed')}`, ''].join('\n');
    return { ...base, chapters: base.chapters.map((entry) => (entry.id === 'remedies' ? { id: 'remedies', texts: { product: text, technical: text } } : entry)), problems: { ...base.problems, rows } };
  };
  const html = decode(render(page(), '#/product/remedies'));
  const textOf = (from: string, to: string): string => html.slice(html.indexOf(from), html.indexOf(to)).replace(/<[^>]*>/g, '');

  it('leaves the generated section alone', () => {
    expect(html.slice(html.indexOf(d('Not addressed')) - 200)).toContain('data-item="D1"');
  });

  it('shows the category word that starts an item as its label, and any other bold text as written', () => {
    const item = html.slice(html.indexOf('id="remedy-11"'), html.indexOf('id="remedy-13"'));
    expect(item).toContain(`<strong>${fixed('page.defects.category.authorization')}</strong>`);
    expect(item).not.toContain('<strong>authorization</strong>');
    expect(html).toContain(`<strong>${d('Fix')}</strong> ${d('Plain bold')}`);
  });

  it('shows the label of a defect category in the row of the problems page, and keeps the ui table to the categories the chapter of defects writes', () => {
    window.history.replaceState(null, '', '#/product/problems');
    const host = mount(<App data={page()} />);
    const row = expand(host, 'd1');
    expect(row.querySelector('[data-field="group"]')?.textContent).toContain(fixed('page.defects.category.security'));
    const shipped = Object.keys(JSON.parse(readFileSync(join(process.cwd(), '../../skills/excavator-product-handbook/ui-strings.json'), 'utf-8')).strings).filter((key) => key.startsWith('page.defects.category.')).map((key) => key.slice('page.defects.category.'.length)).sort();
    const source = readFileSync(join(process.cwd(), '../../skills/excavator-product-handbook/lib/defects-items.mjs'), 'utf-8');
    const words = (/DEFECT_CATEGORIES = Object\.freeze\(\[([^\]]*)\]/.exec(source)?.[1] ?? '').split(',').map((word) => word.trim().replace(/'/g, '')).filter(Boolean).sort();
    expect(shipped).toEqual(words);
    const own = readFileSync(join(process.cwd(), 'src/lib/problems.ts'), 'utf-8');
    const ours = (/DEFECT_CATEGORIES: readonly string\[\] = \[([^\]]*)\]/.exec(own)?.[1] ?? '').split(',').map((word) => word.trim().replace(/'/g, '')).filter(Boolean).sort();
    expect(ours).toEqual(words);
  });
});

// The items of the remedies chapter under the business domains (page data `remedyDomains`): an item of a fixed section that names
// defects of two domains is under both, with the problems of each; a process item is under its process; a defect fix is once in its own
// section, each domain ending with a line that links to it; an item with no id is last. Lines: 5 process item, 9 defect fix, 13 and 15
// items of the section to simplify (15 names no id).
const BY_DOMAIN_TEXT = [
  `# ${d('Remedies')}`, '', `## P1 ${d('Order to invoice')}`, '',
  `- **${d('Merge')}** ${d('Close in one place')} [P1, R1]`, '', `## ${d('Defect fixes')}`, '',
  `- **authorization** ${d('Fix both')} [D1, D2]`, '', `## ${d('Simplify')}`, '',
  `- **${d('Simplify')}** ${d('Merge both')} [D1, D2]`, '',
  `- **${d('Plain')}** ${d('Item without ids')}`, '',
  `## ${marked['chapter.remedies.uncovered']}`, '', `- R2 ${d('Not addressed')}`, '',
].join('\n');
const both = (text: string): { product: string; technical: string } => ({ product: text, technical: text });
const covered = { count: 1, items: [{ line: 9, label: 'authorization' }] };
const BY_DOMAIN: RemedyDomains = {
  items: [
    { line: 5, texts: both(`**${d('Merge')}** ${d('Close in one place')} [P1, R1]`) },
    { line: 9, texts: both(`**authorization** ${d('Fix both')} [D1, D2]`) },
    { line: 13, texts: both(`**${d('Simplify')}** ${d('Merge both')} [D1, D2]`) },
    { line: 15, texts: both(`**${d('Plain')}** ${d('Item without ids')}`) },
  ],
  domains: [
    { id: 'd2', processes: [{ id: 'P1', items: [{ line: 5, problems: ['r1'] }] }], sections: [{ heading: d('Simplify'), items: [{ line: 13, problems: ['d1'] }] }], covered },
    { id: 'd3', processes: [], sections: [{ heading: d('Simplify'), items: [{ line: 13, problems: ['d2'] }] }], covered },
  ],
  defectFixes: { heading: d('Defect fixes'), items: [{ line: 9, problems: ['d1', 'd2'] }] },
  untied: [{ line: 15, problems: [] }],
};
const byDomain = (rows: Partial<Record<string, ProblemRow['remedies']>> = {}, remedyDomains: RemedyDomains = BY_DOMAIN): PageData => {
  const base = data({}, BY_DOMAIN_TEXT);
  const processes: ProcessesData = { items: [{ ...PROCESSES.items[0], domain: 'd2' }], coverage: [] };
  const problemRows = [defect('d1', { features: ['F2'] }), defect('d2', { features: ['F3'] }), defect('d3'), defect('d4'), defect('d5'), design('r1', { process: 'P1' }), design('r2')].map((row) => ({ ...row, remedies: rows[row.id] ?? [] }));
  return { ...base, processes, remedyDomains, problems: { ...base.problems, rows: problemRows } };
};
const withFixProblems = (problems: string[]): RemedyDomains => ({ ...BY_DOMAIN, defectFixes: { heading: d('Defect fixes'), items: [{ line: 9, problems }] } });

describe('the remedies page by business domain', () => {
  const host = (data: PageData = byDomain()): HTMLElement => {
    window.history.replaceState(null, '', '#/product/remedies');
    return mount(<App data={data} />);
  };

  it('has one section per domain in the page order, its process with its items first, then its fixed sections under their own headings; no number is shown', () => {
    const page = host();
    const sections = Array.from(page.querySelectorAll('[data-part="remedy-domain"]'));
    expect(sections.map((section) => section.getAttribute('data-domain'))).toEqual(['d2', 'd3']);
    expect(sections[0].querySelector('h2')?.textContent).toBe(d('Orders'));
    expect(sections[1].querySelector('h2')?.textContent).toBe(d('Billing'));
    const headings = Array.from(sections[0].querySelectorAll('h3'));
    expect(headings.map((heading) => heading.textContent)).toEqual([d('Order to invoice'), d('Simplify')]);
    expect(headings[0].querySelector('a')?.getAttribute('href')).toBe('#/product/processes/P1');
    expect(sections[0].querySelector('#remedy-d2-5')?.textContent).toContain(d('Close in one place'));
    expect(page.querySelector('[data-part="remedy-processes"]')).toBeNull();
    const text = [...sections.map((section) => section.textContent), page.querySelector('[data-part="remedy-defect-fixes"]')?.textContent].join(' ');
    expect(text).not.toMatch(/\bP\d+\b|\b[DR]\d+\b/);
  });

  it('shows a defect fix once, in a section of its own, with the titles of both domains it names, after the domains and before the untied and the generated sections', () => {
    const page = host();
    const section = page.querySelector('[data-part="remedy-defect-fixes"]') as HTMLElement;
    expect(section.querySelector('h2')?.textContent).toBe(d('Defect fixes'));
    expect(page.querySelectorAll('#remedy-f-9')).toHaveLength(1);
    expect(page.querySelector('#remedy-d2-9')).toBeNull();
    expect(page.querySelector('#remedy-d3-9')).toBeNull();
    const item = section.querySelector('#remedy-f-9') as HTMLElement;
    expect(item.querySelector('.remedy-row-content')?.textContent).toBe(`${d('defect d1')}${fixed('page.remedies.problemSeparator')}${d('defect d2')}`);
    expect(item.textContent).toContain(`${fixed('page.defects.category.authorization')} ${d('Fix both')}`);
    const html = page.innerHTML;
    expect(html.lastIndexOf('data-part="remedy-domain" data-domain="d3"')).toBeLessThan(html.indexOf('data-part="remedy-defect-fixes"'));
    expect(html.indexOf('data-part="remedy-defect-fixes"')).toBeLessThan(html.indexOf('data-part="remedy-untied"'));
  });

  it('ends each domain that a defect fix names with a line of the number of its problems that the fixes cover and the category of each fix as a link to it', async () => {
    const scrolled: string[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function scrollIntoViewStub(this: Element) { scrolled.push(this.id); } as typeof Element.prototype.scrollIntoView;
    try {
      const page = host();
      const lines = Array.from(page.querySelectorAll<HTMLElement>('[data-part="remedy-covered"]'));
      expect(lines).toHaveLength(2);
      for (const line of lines) {
        expect(line.textContent).toBe(`${fixed('page.remedies.covered', { count: 1 })} ${fixed('page.defects.category.authorization')}`);
        expect(line.closest('[data-part="remedy-domain"]')?.lastElementChild).toBe(line);
      }
      const link = lines[1].querySelector('a') as HTMLAnchorElement;
      act(() => link.click());
      await follow(link);
      expect(scrolled).toContain('remedy-f-9');
      expect(document.activeElement?.id).toBe('remedy-f-9');
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('still shows an item of another fixed section that names two domains under both, each with the titles of its own domain only', () => {
    const page = host();
    const first = page.querySelector('[data-domain="d2"] #remedy-d2-13') as HTMLElement;
    const second = page.querySelector('[data-domain="d3"] #remedy-d3-13') as HTMLElement;
    expect(first.querySelector('.remedy-row-content')?.textContent).toBe(d('defect d1'));
    expect(second.querySelector('.remedy-row-content')?.textContent).toBe(d('defect d2'));
    for (const item of [first, second]) {
      expect(item.querySelector('a')).toBeNull();
      expect(item.textContent).not.toContain('[');
    }
    const ids = Array.from(page.querySelectorAll('[id^="remedy-"]')).map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('puts the item with no id in a last section, before the generated section, which stays as it was', () => {
    const page = host();
    const untied = page.querySelector('[data-part="remedy-untied"]') as HTMLElement;
    expect(untied.querySelector('h2')?.textContent).toBe(fixed('page.remedies.untied'));
    expect(untied.querySelector('#remedy-u-15')?.textContent).toContain(d('Item without ids'));
    expect(untied.querySelector('[data-part="remedy-problems"]')).toBeNull();
    const html = page.innerHTML;
    expect(html.indexOf('data-part="remedy-untied"')).toBeLessThan(html.indexOf(marked['chapter.remedies.uncovered']));
    expect(page.querySelector('a[data-item="R2"]')?.getAttribute('href')).toBe('#/product/problems?row=r2');
  });

  it('leaves a chapter that names no id as it was: the chapter text as one page, no domain section', () => {
    const page = host(data());
    expect(page.querySelector('[data-part="remedy-domain"]')).toBeNull();
    expect(page.textContent).toContain(d('Across processes'));
  });

  it('opens a link of a row to a defect fix at its single anchor, and one to an item of a process on the page of the process', async () => {
    const remedies = { d1: [{ heading: d('Defect fixes'), anchor: 'remedy-f-9' }], r1: [{ heading: `P1 ${d('Order to invoice')}`, anchor: 'remedy-5', process: 'P1' }] };
    window.history.replaceState(null, '', '#/product/problems');
    const scrolled: string[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function scrollIntoViewStub(this: Element) { scrolled.push(this.id); } as typeof Element.prototype.scrollIntoView;
    try {
      const page = mount(<App data={byDomain(remedies)} />);
      expect(expand(page, 'r1').querySelector('[data-part="remedy-link"]')?.getAttribute('href')).toBe('#/product/processes/P1');
      const link = expand(page, 'd1').querySelector<HTMLAnchorElement>('[data-part="remedy-link"]') as HTMLAnchorElement;
      expect(link.getAttribute('href')).toBe('#/product/remedies');
      act(() => link.click());
      await follow(link);
      expect(page.querySelector('[data-view="remedies"]')).not.toBeNull();
      expect(scrolled).toContain('remedy-f-9');
      expect(document.activeElement?.id).toBe('remedy-f-9');
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });
});

describe('a suggestion as two rows: the problems, then the suggestion', () => {
  const item = (problems: string[]): HTMLElement => {
    window.history.replaceState(null, '', '#/product/remedies');
    const page = mount(<App data={byDomain({}, withFixProblems(problems))} />);
    return page.querySelector('#remedy-f-9') as HTMLElement;
  };
  const sep = fixed('page.remedies.problemSeparator');

  it('shows the label "Problem" once and the titles of 2 problems joined by the separator on one row, then the row of the suggestion with its own label', () => {
    const one = item(['d1', 'd2']);
    const rows = Array.from(one.querySelectorAll('.remedy-row'));
    expect(rows.map((row) => row.querySelector('.remedy-row-label')?.textContent)).toEqual([fixed('page.remedies.problem'), fixed('page.remedies.suggestion')]);
    expect(one.textContent?.split(fixed('page.remedies.problem')).length).toBe(2);
    expect(rows[0].querySelector('.remedy-row-content')?.textContent).toBe(`${d('defect d1')}${sep}${d('defect d2')}`);
    expect(rows[0].querySelector('a')).toBeNull();
    expect(rows[1].querySelector('.remedy-row-content')?.textContent).toContain(d('Fix both'));
    expect(one.textContent).not.toMatch(/\b[DR]\d+\b/);
  });

  it('shows 3 titles of 5 problems and "and 2 more", and a click shows all 5 on the same row', () => {
    const one = item(['d1', 'd2', 'd3', 'd4', 'd5']);
    const row = one.querySelector('[data-part="remedy-problems"]') as HTMLElement;
    const titles = (): string[] => Array.from(row.querySelectorAll('.remedy-problem-title')).map((title) => title.textContent as string);
    expect(titles()).toEqual([d('defect d1'), d('defect d2'), d('defect d3')]);
    const more = row.querySelector('[data-part="remedy-more"]') as HTMLElement;
    expect(more.textContent).toBe(fixed('page.remedies.moreTitles', { count: 2 }));
    act(() => more.click());
    expect(titles()).toEqual(['d1', 'd2', 'd3', 'd4', 'd5'].map((id) => d(`defect ${id}`)));
    expect(row.querySelector('[data-part="remedy-more"]')).toBeNull();
    expect(row.querySelectorAll('.remedy-row-content').length).toBe(1);
    expect(row.querySelector('.remedy-row-content')?.textContent).toContain(`${d('defect d3')}${sep}${d('defect d4')}`);
  });

  it('has no problem row for an item with no problems, only the suggestion row', () => {
    const one = item([]);
    expect(one.querySelector('[data-part="remedy-problems"]')).toBeNull();
    expect(Array.from(one.querySelectorAll('.remedy-row-label')).map((label) => label.textContent)).toEqual([fixed('page.remedies.suggestion')]);
  });
});
