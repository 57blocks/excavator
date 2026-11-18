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

// The items of the remedies chapter in groups by measure type (page data `remedyDomains`). Lines: 5 an item written under a process
// (simplify), 9 a category item of the defect fixes, 13 a unify item that names two domains, 15 an automate item that names no id,
// 17 a plain fix of a domain; the generated section lists one problem.
const BY_DOMAIN_TEXT = [
  `# ${d('Remedies')}`, '', `## P1 ${d('Order to invoice')}`, '',
  `- **${d('Merge')}** ${d('Close in one place')} [P1, R1]`, '', `## ${d('Defect fixes')}`, '',
  `- **authorization** ${d('Fix both')} [D1, D2]`, '', `## ${d('Simplify')}`, '',
  `- **${d('Unify')}** ${d('Use one rule')} [D1, D2]`, '',
  `- **${d('Automate')}** ${d('Send it by itself')}`, '',
  `- **${d('Fix')}** ${d('Repair the date')} [D2]`, '',
  `## ${marked['chapter.remedies.uncovered']}`, '', `- R2 ${d('Not addressed')}`, '',
].join('\n');
const both = (text: string): { product: string; technical: string } => ({ product: text, technical: text });
const covered = { count: 1, items: [{ line: 9, label: 'authorization' }] };
const BY_DOMAIN: RemedyDomains = {
  items: [
    { line: 5, texts: both(`**${d('Merge')}** ${d('Close in one place')} [P1, R1]`) },
    { line: 9, texts: both(`**authorization** ${d('Fix both')} [D1, D2]`) },
    { line: 13, texts: both(`**${d('Unify')}** ${d('Use one rule')} [D1, D2]`) },
    { line: 15, texts: both(`**${d('Automate')}** ${d('Send it by itself')}`) },
    { line: 17, texts: both(`**${d('Fix')}** ${d('Repair the date')} [D2]`) },
  ],
  groups: [
    { id: 'simplify', count: 1, across: [], domains: [{ id: 'd2', items: [{ line: 5, problems: ['r1'], process: 'P1' }] }], untied: [] },
    { id: 'unify', count: 1, across: [], domains: [{ id: 'd2', items: [{ line: 13, problems: ['d1'], bare: true }] }, { id: 'd3', items: [{ line: 13, problems: ['d2'], bare: true }] }], untied: [] },
    { id: 'automate', count: 1, across: [], domains: [], untied: [{ line: 15, problems: [], bare: true }] },
    { id: 'defects', count: 2, across: [{ line: 9, problems: ['d1', 'd2'] }], domains: [{ id: 'd2', items: [], covered }, { id: 'd3', items: [{ line: 17, problems: ['d2'], bare: true }], covered }], untied: [] },
  ],
  generated: 1,
};
const byDomain = (rows: Partial<Record<string, ProblemRow['remedies']>> = {}, remedyDomains: RemedyDomains = BY_DOMAIN): PageData => {
  const base = data({}, BY_DOMAIN_TEXT);
  const processes: ProcessesData = { items: [{ ...PROCESSES.items[0], domain: 'd2' }], coverage: [] };
  const problemRows = [defect('d1', { features: ['F2'] }), defect('d2', { features: ['F3'] }), defect('d3'), defect('d4'), defect('d5'), design('r1', { process: 'P1' }), design('r2')].map((row) => ({ ...row, remedies: rows[row.id] ?? [] }));
  return { ...base, processes, remedyDomains, problems: { ...base.problems, rows: problemRows } };
};
const withFixProblems = (problems: string[]): RemedyDomains => ({ ...BY_DOMAIN, groups: BY_DOMAIN.groups.map((group) => (group.id === 'defects' ? { ...group, across: [{ line: 9, problems }] } : group)) });
const open = (hash: string, page: PageData = byDomain()): HTMLElement => {
  window.history.replaceState(null, '', hash);
  return mount(<App data={page} />);
};

describe('the remedies page in tabs by measure type', () => {
  it('has a tab for each group with its number of items, then the generated section; the first is selected and only its content is on the page', () => {
    const page = open('#/product/remedies');
    const tabs = Array.from(page.querySelectorAll<HTMLElement>('[role="tab"]'));
    expect(tabs.map((tab) => tab.getAttribute('data-tab'))).toEqual(['simplify', 'unify', 'automate', 'defects', 'uncovered']);
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      `${fixed('page.remedies.group.simplify')}1`, `${fixed('page.remedies.group.unify')}1`, `${fixed('page.remedies.group.automate')}1`, `${fixed('page.remedies.group.defects')}2`, `${fixed('chapter.remedies.uncovered')}1`,
    ]);
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false', 'false']);
    expect(page.querySelectorAll('[data-tab]:not([role="tab"])')).toHaveLength(1);
    expect(page.querySelector('article[data-tab="simplify"]')).not.toBeNull();
    expect(page.querySelector('[data-part="remedy-note"]')?.textContent).toBe(fixed('page.remedies.groupNote.simplify'));
    expect(page.textContent).not.toMatch(/\bP\d+\b|\b[DR]\d+\b/);
  });

  it('shows only the group of the tab that is clicked and keeps the tab in the address, and opens at the tab the address names', async () => {
    const page = open('#/product/remedies');
    const tab = page.querySelector<HTMLAnchorElement>('[data-tab="unify"]') as HTMLAnchorElement;
    expect(tab.getAttribute('href')).toBe('#/product/remedies?tab=unify');
    act(() => tab.click());
    await follow(tab);
    expect(window.location.hash).toBe('#/product/remedies?tab=unify');
    expect(page.querySelector('article[data-tab="unify"]')).not.toBeNull();
    expect(page.querySelector('article[data-tab="simplify"]')).toBeNull();
    expect(page.querySelector('[data-tab="unify"][role="tab"]')?.getAttribute('aria-selected')).toBe('true');
    cleanup();
    const direct = open('#/product/remedies?tab=automate');
    expect(direct.querySelector('article[data-tab="automate"]')).not.toBeNull();
    expect(direct.querySelector('article[data-tab="simplify"]')).toBeNull();
    cleanup();
    expect(open('#/product/remedies?tab=nothing').querySelector('article[data-tab="simplify"]')).not.toBeNull();
  });

  it('shows a unify item that names two domains under both, each with the titles of its own domain only, no type word, no id and an anchor of its own', () => {
    const page = open('#/product/remedies?tab=unify');
    const sections = Array.from(page.querySelectorAll('[data-part="remedy-domain"]'));
    expect(sections.map((section) => section.querySelector('h3')?.textContent)).toEqual([d('Orders'), d('Billing')]);
    const first = sections[0].querySelector('#remedy-unify-d2-13') as HTMLElement;
    const second = sections[1].querySelector('#remedy-unify-d3-13') as HTMLElement;
    expect(first.querySelector('[data-part="remedy-problems"] .remedy-row-content')?.textContent).toBe(d('defect d1'));
    expect(second.querySelector('[data-part="remedy-problems"] .remedy-row-content')?.textContent).toBe(d('defect d2'));
    for (const item of [first, second]) {
      expect(item.querySelector('[data-part="remedy-suggestion"] .remedy-row-content')?.textContent).toBe(d('Use one rule'));
      expect(item.textContent).not.toContain(d('Unify'));
      expect(item.querySelector('a')).toBeNull();
    }
    const ids = Array.from(page.querySelectorAll('[id^="remedy-"]')).map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps the type word where the group has several types, and gives an item written under a process a first row with the process as a link', () => {
    const page = open('#/product/remedies');
    const item = page.querySelector('#remedy-simplify-d2-5') as HTMLElement;
    // The process row is a row of the item itself, beside its problem and suggestion rows, so the three share one grid (a row
    // outside the item made the item's whole text one cell of the outer grid and squeezed the process name into a zero-wide column).
    const row = item.children[0] as HTMLElement;
    expect(row.getAttribute('data-part')).toBe('remedy-process');
    expect(Array.from(item.children).every((child) => child.classList.contains('remedy-row'))).toBe(true);
    expect(Array.from(item.closest('[data-remedy-line]')?.children ?? []).some((child) => child.classList.contains('remedy-row'))).toBe(false);
    expect(row.querySelector('.remedy-row-label')?.textContent).toBe(fixed('page.remedies.process'));
    expect(row.querySelector('a')?.getAttribute('href')).toBe('#/product/processes/P1');
    expect(row.querySelector('a')?.textContent).toBe(d('Order to invoice'));
    expect(item.querySelector('strong')?.textContent).toBe(d('Merge'));
  });

  it('shows the category item once in the section of the fixes across domains, and ends each domain with the line that links to it', async () => {
    const scrolled: string[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function scrollIntoViewStub(this: Element) { scrolled.push(this.id); } as typeof Element.prototype.scrollIntoView;
    try {
      const page = open('#/product/remedies?tab=defects');
      const across = page.querySelector('[data-part="remedy-across"]') as HTMLElement;
      expect(across.querySelector('h3')?.textContent).toBe(fixed('page.remedies.across'));
      expect(page.querySelectorAll('#remedy-defects-a-9')).toHaveLength(1);
      const item = across.querySelector('#remedy-defects-a-9') as HTMLElement;
      expect(item.querySelector('[data-part="remedy-problems"] .remedy-row-content')?.textContent).toBe(`${d('defect d1')}${fixed('page.remedies.problemSeparator')}${d('defect d2')}`);
      expect(item.textContent).toContain(`${fixed('page.defects.category.authorization')} ${d('Fix both')}`);
      // The plain fix of a domain has no type word; a domain with only covered problems still has its subsection.
      const sections = Array.from(page.querySelectorAll('[data-part="remedy-domain"]'));
      expect(sections.map((section) => section.getAttribute('data-domain'))).toEqual(['d2', 'd3']);
      expect(sections[0].querySelector('#remedy-defects-d2-17')).toBeNull();
      expect(sections[1].querySelector('#remedy-defects-d3-17')?.textContent).toContain(d('Repair the date'));
      expect(sections[1].querySelector('#remedy-defects-d3-17')?.textContent).not.toContain(d('Fix'));
      const lines = Array.from(page.querySelectorAll<HTMLElement>('[data-part="remedy-covered"]'));
      expect(lines).toHaveLength(2);
      for (const line of lines) {
        expect(line.textContent).toBe(`${fixed('page.remedies.covered', { count: 1 })} ${fixed('page.defects.category.authorization')}`);
        expect(line.closest('[data-part="remedy-domain"]')?.lastElementChild).toBe(line);
      }
      const link = lines[1].querySelector('a') as HTMLAnchorElement;
      expect(link.getAttribute('href')).toBe('#/product/remedies?tab=defects');
      act(() => link.click());
      await follow(link);
      expect(scrolled).toContain('remedy-defects-a-9');
      expect(document.activeElement?.id).toBe('remedy-defects-a-9');
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('puts an item with no id in the last subsection of its tab', () => {
    const page = open('#/product/remedies?tab=automate');
    const untied = page.querySelector('[data-part="remedy-untied"]') as HTMLElement;
    expect(untied.querySelector('h3')?.textContent).toBe(fixed('page.remedies.untied'));
    expect(untied.querySelector('#remedy-automate-u-15')?.textContent).toContain(d('Send it by itself'));
    expect(untied.querySelector('[data-part="remedy-problems"]')).toBeNull();
  });

  it('has the generated section as the last tab only when it lists problems', () => {
    const page = open('#/product/remedies?tab=uncovered');
    expect(page.querySelector('article[data-tab]')).toBeNull();
    expect(page.querySelector('a[data-item="R2"]')?.getAttribute('href')).toBe('#/product/problems?row=r2');
    expect(page.querySelector('[data-tab="uncovered"][role="tab"]')?.getAttribute('aria-selected')).toBe('true');
    cleanup();
    const none = open('#/product/remedies', byDomain({}, { ...BY_DOMAIN, generated: null }));
    expect(none.querySelector('[data-tab="uncovered"]')).toBeNull();
    expect(Array.from(none.querySelectorAll('[role="tab"]')).map((tab) => tab.getAttribute('data-tab'))).toEqual(['simplify', 'unify', 'automate', 'defects']);
  });

  it('shows no tabs for a chapter that names no id: the chapter text as one page', () => {
    const page = open('#/product/remedies', data());
    expect(page.querySelector('[role="tab"]')).toBeNull();
    expect(page.textContent).toContain(d('Across processes'));
  });

  it('opens a link of a row to the tab of the item and lands on the item under the domain of the row, and one to an item of a process on the page of the process', async () => {
    const remedies = {
      d1: [{ heading: d('Simplify'), anchor: 'remedy-unify-d2-13', tab: 'unify', domain: 'd2' }],
      r1: [{ heading: `P1 ${d('Order to invoice')}`, anchor: 'remedy-5', process: 'P1' }],
    };
    const scrolled: string[] = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function scrollIntoViewStub(this: Element) { scrolled.push(this.id); } as typeof Element.prototype.scrollIntoView;
    try {
      const page = open('#/product/problems', byDomain(remedies));
      expect(expand(page, 'r1').querySelector('[data-part="remedy-link"]')?.getAttribute('href')).toBe('#/product/processes/P1');
      const link = expand(page, 'd1').querySelector<HTMLAnchorElement>('[data-part="remedy-link"]') as HTMLAnchorElement;
      expect(link.getAttribute('href')).toBe('#/product/remedies?tab=unify');
      act(() => link.click());
      await follow(link);
      expect(page.querySelector('article[data-tab="unify"]')).not.toBeNull();
      expect(scrolled).toContain('remedy-unify-d2-13');
      expect(document.activeElement?.id).toBe('remedy-unify-d2-13');
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('names a link to a tab by the name of its group and a link to a process by the name of the process, never by a process number', () => {
    const remedies = {
      d1: [
        { heading: d('Simplify'), anchor: 'remedy-unify-d2-13', tab: 'unify', domain: 'd2' },
        { heading: d('Order to invoice'), anchor: 'remedy-5', process: 'P1' },
      ],
    };
    const page = open('#/product/problems', byDomain(remedies));
    const links = Array.from(expand(page, 'd1').querySelectorAll<HTMLAnchorElement>('[data-part="remedy-link"]'));
    expect(links.map((link) => link.textContent)).toEqual([
      fixed('page.problems.remedyItem', { n: 1, heading: fixed('page.remedies.group.unify') }),
      fixed('page.problems.remedyItem', { n: 2, heading: d('Order to invoice') }),
    ]);
    expect(links.map((link) => link.textContent).join(' ')).not.toMatch(/\bP\d+\b/);
  });
});

describe('a suggestion as two rows: the problems, then the suggestion', () => {
  const item = (problems: string[]): HTMLElement => open('#/product/remedies?tab=defects', byDomain({}, withFixProblems(problems))).querySelector('#remedy-defects-a-9') as HTMLElement;
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
