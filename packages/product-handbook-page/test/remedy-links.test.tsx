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
      expect(html.slice(at, at + 1200)).toContain(d(word));
    }
  });

  it('turns each id of an id group into a link: D and R to the row of the problems page, P to the process; an id that does not exist stays text', () => {
    const first = html.slice(html.indexOf('id="remedy-5"'), html.indexOf('id="remedy-9"'));
    expect(first).toContain('<a href="#/product/processes/P1" data-item="P1">P1</a>');
    expect(first).toContain('<a href="#/product/problems?row=r1" data-item="R1">R1</a>');
    expect(first).toContain('<a href="#/product/problems?row=d1" data-item="D1">D1</a>');
    const last = html.slice(html.indexOf('id="remedy-13"'));
    expect(last).toContain('[D99, P9]');
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
    expect(fold).toContain(`href="#/product/processes/P1"><span class="proc-no">P1</span><span class="proc-name">${d('Order to invoice')}</span><span class="proc-count">${fixed('page.remedies.suggestionCount', { count: 1 })}</span>`);
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

  it('shows a line "Problem", id, title above a suggestion of a fixed section for each problem it names, and none for an id the page does not know', () => {
    const item = html.slice(html.indexOf('id="remedy-13"'), html.indexOf('id="remedy-15"'));
    const lines = item.match(/<div class="remedy-problem" data-problem-line="(\w+)">/g);
    expect(lines).toEqual(['<div class="remedy-problem" data-problem-line="R1">', '<div class="remedy-problem" data-problem-line="D1">']);
    expect(item).toContain(`<span class="remedy-problem-label">${fixed('page.remedies.problem')}</span> <a href="#/product/problems?row=d1" data-item="D1">D1</a> <a href="#/product/problems?row=d1" data-item="D1-title" class="remedy-problem-title">${d('defect d1')}</a>`);
    expect(item).toContain(`data-item="R1-title" class="remedy-problem-title">${d('design r1')}</a>`);
    expect(item).not.toContain('data-problem-line="D99"');
    expect(item).toContain('D99]');
    expect(item.indexOf('data-part="remedy-problems"')).toBeLessThan(item.indexOf(d('Show the button')));
    const plain = html.slice(html.indexOf('id="remedy-15"'));
    expect(plain).not.toContain('data-part="remedy-problems"');
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

describe('the problem lines of a suggestion with many ids', () => {
  const many = (): PageData => {
    const base = data();
    const rows = ['d1', 'd2', 'd3', 'd4', 'd5'].map((id) => defect(id));
    const text = [`# ${d('Remedies')}`, '', `## ${d('Fixes')}`, '', `- ${d('Fix all')} [D1, D2, D3, D4, D5]`, '', `- ${d('Fix two')} [D1, D2]`, ''].join('\n');
    return { ...base, chapters: base.chapters.map((entry) => (entry.id === 'remedies' ? { id: 'remedies', texts: { product: text, technical: text } } : entry)), problems: { ...base.problems, rows } };
  };

  it('shows the first 3 lines in the order of the group and a row "2 more problems" that shows all 5 on a click; 2 ids show 2 lines and no row', () => {
    window.history.replaceState(null, '', '#/product/remedies');
    const host = mount(<App data={many()} />);
    const item = host.querySelector('#remedy-5') as HTMLElement;
    const lines = (): string[] => Array.from(item.querySelectorAll('[data-problem-line]')).map((line) => line.getAttribute('data-problem-line') as string);
    expect(lines()).toEqual(['D1', 'D2', 'D3']);
    const more = item.querySelector('[data-part="remedy-more"]') as HTMLElement;
    expect(more.textContent).toBe(fixed('page.remedies.moreProblems', { count: 2 }));
    act(() => more.click());
    expect(lines()).toEqual(['D1', 'D2', 'D3', 'D4', 'D5']);
    const two = host.querySelector('#remedy-7') as HTMLElement;
    expect(two.querySelectorAll('[data-problem-line]')).toHaveLength(2);
    expect(two.querySelector('[data-part="remedy-more"]')).toBeNull();
  });
});

describe('the id group of a suggestion that has problem lines', () => {
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

  it('leaves the D and R ids to the problem lines and keeps the P id in the group', () => {
    const item = html.slice(html.indexOf('id="remedy-5"'), html.indexOf('id="remedy-7"'));
    expect(item.match(/class="remedy-problem" data-problem-line/g)).toHaveLength(3);
    expect(item).toContain('data-part="remedy-more"');
    expect(item).toContain(`${d('text')} [<a href="#/product/processes/P1" data-item="P1">P1</a>].`);
    expect(item).not.toContain(', <a');
  });

  it('drops the brackets and the space before them from a group left empty, and keeps an id the page does not know as text', () => {
    const only = html.slice(html.indexOf('id="remedy-7"'), html.indexOf('id="remedy-9"'));
    expect(only).toContain(`${d('more text')}.</p>`);
    expect(only).not.toContain('[');
    const unknown = html.slice(html.indexOf('id="remedy-9"'), html.indexOf('id="remedy-11"'));
    expect(unknown).toContain(`${d('some text')} [D99].`);
    expect(textOf('id="remedy-9"', 'id="remedy-11"')).not.toContain('D1,');
  });

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
