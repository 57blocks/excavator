// @vitest-environment happy-dom
// Openspec change handbook-process-review (S6c): the processes are read by business domain. There is no list of all the processes and no
// entry for one: the domain page lists its own, a process has a page of its own (steps, problems, suggestions) and the reader never sees
// its number; the old address of the list opens the index of the domains. Data is written by hand.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { App, AppView, documentTitle } from '../src/App';
import { referencesOf } from '../src/lib/groups';
import { switchTarget, viewOf } from '../src/lib/navigation';
import { pagesOf } from '../src/lib/pages';
import { parseHash, routeHash } from '../src/lib/route';
import { searchAll } from '../src/lib/search';
import type { ChapterData, PageData, ProblemRow, ProcessesData, SearchItem } from '../src/lib/types';
import { cleanup, mount } from './dom';
import { FEATURES, outlineWithFeatures, domainData } from './domains-fixture';
import { BOTH, d, marked } from './page-fixture';

afterEach(() => { cleanup(); window.history.replaceState(null, '', '#'); });
beforeEach(() => { window.history.replaceState(null, '', '#'); });

const fixed = (key: string, values: Record<string, string | number> = {}): string => marked[key].replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole));

const PROCESSES: ProcessesData = {
  items: [
    {
      id: 'P1', name: d('Order to invoice'), domain: 'd2', features: ['F2', 'F3'],
      steps: [
        { role: d('Clerk'), operation: d('Enter an order'), feature: 'F2', text: d('The clerk saves the order.'), cites: ['src/a.js:1-3'] },
        { role: d('System'), operation: d('Create an invoice'), feature: 'F3', text: d('The system bills it.'), cites: ['src/b.js:4'] },
      ],
      end: { text: d('Invoiced.'), cites: ['src/c.js:9'] },
    },
    { id: 'P2', name: d('Order follow-up'), domain: 'd2', features: ['F2'], steps: [{ role: d('Clerk'), operation: d('Enter an order'), feature: 'F2', text: d('Again.'), cites: ['src/d.js:2'] }] },
    { id: 'P3', name: d('Support call'), domain: 'd4', features: ['F4'], steps: [{ role: d('Agent'), operation: d('Answer a call'), feature: 'F4', text: d('Answered.'), cites: [] }] },
  ].map((item) => ({ ...item, features: item.features })),
  coverage: [{ feature: 'F3', operations: [d('Cancel an invoice'), d('Resend an invoice')] }],
};
const designRow = (id: string, process: string | undefined, over: Partial<ProblemRow> = {}): ProblemRow => ({
  id, type: 'design', level: 'high', group: 'duplication', features: ['F2'], summary: d(`summary ${id}`),
  texts: { product: { situation: d(`situation ${id}`), consequence: d(`consequence ${id}`) }, technical: { situation: d(`tech situation ${id}`), consequence: d(`tech consequence ${id}`) } },
  cites: ['src/p.js:10-12'], ...(process === undefined ? {} : { process }), source: { chapter: 'review', line: 6 }, remedies: [], ...over,
});
const withRows = (base: PageData, rows: ProblemRow[]): PageData => ({ ...base, problems: { ...base.problems, rows } });
const PROCESS_TEXT = `# ${d('Business processes')}\n\n## P1 ${d('Order to invoice')}\n\ntext\n`;

const withProcesses = (processes: ProcessesData | null, placed = processes !== null): PageData => {
  const base = outlineWithFeatures();
  const outline = placed ? { ...base, parts: [...base.parts, { title: d('People'), blocks: [{ block: 'processes', kind: 'chapter' as const, title: d('Business processes') }] }] } : base;
  const chapters: ChapterData[] = [
    ...domainData().chapters,
    ...(placed ? [{ id: 'processes', texts: Object.fromEntries(BOTH.map((view) => [view, PROCESS_TEXT])) }] : []),
  ];
  return domainData({ outline, chapters, processes });
};

const render = (page: PageData, hash: string): string => renderToStaticMarkup(<AppView data={page} route={parseHash(hash)} />);
const decode = (text: string): string => text.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const page = withProcesses(PROCESSES);
/** The text the reader reads in a rendered page, without the attributes (a process number is in addresses and attributes only). */
const textOf = (html: string): string => decode(html.replace(/<[^>]*>/g, ' '));
const NUMBER = /\bP\d+\b/;

describe('the routes', () => {
  it('parses the old list address and one process, with and without the view prefix, and builds them back', () => {
    expect(parseHash('#/processes')).toEqual({ name: 'processes' });
    expect(parseHash('#/technical/processes/P12')).toEqual({ name: 'process', id: 'P12', view: 'technical' });
    expect(routeHash({ name: 'process', id: 'P4' }, 'product')).toBe('#/product/processes/P4');
    for (const hash of ['#/processes', '#/product/processes/P4', '#/technical/processes']) {
      const parsed = parseHash(hash);
      expect(routeHash(parsed as never, 'view' in parsed && parsed.view !== undefined ? parsed.view : null)).toBe(hash);
    }
  });

  it('makes an id that is no process number, a deeper path and a query not found', () => {
    for (const hash of ['#/processes/x', '#/processes/p4', '#/processes/P4/more', '#/processes?q=a', '#/processes/P']) expect(parseHash(hash).name, hash).toBe('not-found');
  });

  it('is a page of both views, found only when the process exists; the other view keeps the address; the title is the name only', () => {
    expect(viewOf(page, parseHash('#/technical/processes/P2'), 'c')).toBe('technical');
    expect(viewOf(page, parseHash('#/product/processes/P9'), 'c')).toBeNull();
    expect(viewOf(withProcesses(null), parseHash('#/product/processes/P2'), 'c')).toBeNull();
    expect(switchTarget(page, parseHash('#/product/processes/P2'), 'technical', 'c')).toBe('#/technical/processes/P2');
    const title = documentTitle(page, parseHash('#/product/processes/P2'));
    expect(title).toContain(d('Order follow-up'));
    expect(title).not.toMatch(NUMBER);
  });
});

describe('the navigation', () => {
  it('has no entry for the processes: no page in the lists and no link in the left list or the menu', () => {
    const items = referencesOf(page, 'product', 'c', 's').flatMap((group) => group.items);
    expect(items.some((item) => item.block === 'processes')).toBe(false);
    expect(pagesOf(page, 'product', 'c').some((item) => item.block === 'processes')).toBe(false);
    const html = decode(render(page, '#/product/'));
    expect(html).not.toContain('data-page="processes"');
    expect(html).not.toContain('href="#/product/processes"');
    expect(html).not.toContain(fixed('page.nav.processes'));
  });

  it('keeps the chapter as a plain page when the data has no usable processes (a chapter that did not pass)', () => {
    const failed = withProcesses(null, true);
    const entry = referencesOf(failed, 'product', 'c', 's').flatMap((group) => group.items).find((item) => item.block === 'processes');
    expect(entry).toMatchObject({ kind: 'chapter', key: 'chapter:processes' });
  });

  it('sends the old address of the list to the index of the domains, else to the home page', async () => {
    const base = withProcesses(PROCESSES);
    const indexed: PageData = { ...base, outline: { ...base.outline, parts: [...base.outline.parts, { title: d('More'), blocks: [{ block: 'domains', kind: 'chapter', title: d('Domains') }] }] } };
    for (const [data, hash] of [[indexed, '#/product/chapter/domains'], [base, '#/product']] as const) {
      window.history.replaceState(null, '', '#/product/processes');
      mount(<App data={data} />);
      await act(async () => { await new Promise((done) => { setTimeout(done, 40); }); });
      expect(window.location.hash).toBe(hash);
      cleanup();
    }
  });
});

describe('the domain page', () => {
  const mainLine = marked['chapter.domain.mainLine'];
  const withBody = (processes: ProcessesData | null): PageData => {
    const base = withProcesses(processes);
    const body = `### ${d('Domain features')}\n\n| a | b |\n| --- | --- |\n| ${d('Platform core')} | x |\n\n### ${mainLine}\n\n1. ${d('Start the services.')}\n\n### ${d('Closing notes')}\n\n${d('Last words here.')}\n`;
    return { ...base, domains: { ...base.domains, list: base.domains.list.map((domain) => (domain.id === 'd2' ? { ...domain, body: { product: body, technical: body } } : domain)) } };
  };
  const five: ProcessesData = {
    items: ['P1', 'P2', 'P3', 'P4', 'P5'].map((id, at) => ({
      id, name: d(`Process ${id}`), domain: 'd2', features: ['F2'],
      steps: [{ role: d('Clerk'), operation: d(`Enter ${at}`), feature: 'F2', text: d('Saves.') }, { role: d('System'), operation: d(`Bill ${at}`), feature: 'F3', text: d('Bills.') }],
    })).concat([{ id: 'P6', name: d('Elsewhere'), domain: 'd4', features: ['F4'], steps: [{ role: d('Agent'), operation: d('Answer'), feature: 'F4', text: d('Answers.') }] }]),
    coverage: [],
  };

  it('lists every process that starts in the domain, none folded, in the place of the main line: name as a link, the operations in one line, a badge with the number of problems', () => {
    const data = withRows(withBody(five), [designRow('r1', 'P2'), designRow('r2', 'P2'), designRow('r3', 'P4')]);
    window.history.replaceState(null, '', '#/product/domain/d2');
    const host = mount(<App data={data} />);
    const section = host.querySelector('[data-part="domain-processes"]') as HTMLElement;
    expect(section.querySelector('h2')?.textContent).toBe(fixed('page.nav.processes'));
    const rows = Array.from(section.querySelectorAll('li'));
    expect(rows.map((row) => row.getAttribute('data-process'))).toEqual(['P1', 'P2', 'P3', 'P4', 'P5']);
    expect(rows[0].querySelector('a')?.getAttribute('href')).toBe('#/product/processes/P1');
    expect(rows[0].querySelector('.proc-name')?.textContent).toBe(d('Process P1'));
    expect(rows[2].querySelector('[data-part="process-operations"]')?.textContent).toBe(`${d('Enter 2')} ${String.fromCharCode(0x2192)} ${d('Bill 2')}`);
    expect(rows.map((row) => row.querySelector('[data-part="process-problem-count"]')?.textContent ?? null)).toEqual([null, fixed('page.processes.problemCount', { count: 2 }), null, fixed('page.processes.problemCount', { count: 1 }), null]);
    expect(section.querySelector('button')).toBeNull();
    // The main line is gone; the sections around it stay, and the processes of another domain are not here.
    const text = host.textContent ?? '';
    expect(text).not.toContain(d('Start the services.'));
    expect(text).toContain(d('Last words here.'));
    expect(text).not.toContain(d('Elsewhere'));
    expect(text).not.toMatch(NUMBER);
    const body = host.querySelector('[data-view="domain"]') as HTMLElement;
    expect(body.innerHTML.indexOf('data-part="domain-processes"')).toBeLessThan(body.innerHTML.indexOf(d('Last words here.')));
  });

  it('shows the main line and no processes section when the page has no processes', () => {
    const html = decode(render(withBody(null), '#/product/domain/d2'));
    expect(html).toContain(d('Start the services.'));
    expect(html).not.toContain('data-part="domain-processes"');
  });
});

describe('one process', () => {
  it('shows its domain as a link on the top line, the steps in order with the role, the operation, the feature as a link, the sentence, and the end state; no process number anywhere', () => {
    window.history.replaceState(null, '', '#/product/processes/P1');
    const host = mount(<App data={page} />);
    const html = decode(render(page, '#/product/processes/P1'));
    const line = host.querySelector('[data-part="process-domain"] a') as HTMLAnchorElement;
    expect(line.getAttribute('href')).toBe('#/product/domain/d2');
    expect(line.textContent).toBe(d('Orders'));
    expect(host.querySelector('h1')?.textContent).toBe(d('Order to invoice'));
    const steps = html.slice(html.indexOf('data-part="process-steps"'), html.indexOf('data-part="process-end"'));
    expect(steps.indexOf(d('Enter an order'))).toBeGreaterThan(-1);
    expect(steps.indexOf(d('Enter an order'))).toBeLessThan(steps.indexOf(d('Create an invoice')));
    expect(steps).toContain('href="#/product/chapter/F2"');
    expect(steps).toContain(d('The clerk saves the order.'));
    expect(html).toContain(fixed('chapter.processes.end'));
    expect(html).toContain(d('Invoiced.'));
    expect(html).not.toContain('data-part="citation"');
    expect(host.textContent).not.toMatch(NUMBER);
    expect(host.querySelector('.crumbs')?.textContent).not.toMatch(NUMBER);
  });

  it('shows the citations of each step and of the end state in the technical view only', () => {
    const html = decode(render(page, '#/technical/processes/P1'));
    expect(html.match(/data-part="citation"/g)?.length).toBe(3);
    expect(html).toContain('title="src/a.js:1-3"');
    expect(html).toContain('title="src/c.js:9"');
  });

  it('lists the features the process passes through, after its problems and suggestions', () => {
    const html = decode(render(withRows(page, [designRow('r4', 'P1')]), '#/product/processes/P1'));
    expect(html.slice(html.indexOf('data-part="process-features"'))).toContain('href="#/product/chapter/F3"');
    expect(html.indexOf('data-part="process-problems"')).toBeLessThan(html.indexOf('data-part="process-features"'));
    expect(html.indexOf('data-part="process-end"')).toBeLessThan(html.indexOf('data-part="process-problems"'));
  });

  it('shows the design problems that name it with the title, the impact, the situation and the consequence, and no link to the problems table', () => {
    const rows = [designRow('r4', 'P1'), designRow('r5', 'P2'), designRow('r6', 'P1', { level: 'low' })];
    const html = decode(render(withRows(page, rows), '#/product/processes/P1'));
    const section = html.slice(html.indexOf('data-part="process-problems"'), html.indexOf('data-part="process-features"'));
    expect(section).toContain(`<h2>${fixed('page.processes.problems')}</h2>`);
    expect(section.indexOf(d('summary r4'))).toBeLessThan(section.indexOf(d('summary r6')));
    expect(section).not.toContain(d('summary r5'));
    for (const word of ['summary r4', 'situation r4', 'consequence r4', 'situation r6']) expect(section, word).toContain(d(word));
    expect(section).toContain(fixed('chapter.review.impact.high'));
    expect(section).toContain(fixed('chapter.review.impact.low'));
    expect(section).not.toContain('<a ');
    expect(section).not.toContain('/problems');
    expect(section).not.toContain('data-part="citation"');
    const technical = decode(render(withRows(page, rows), '#/technical/processes/P1'));
    const tech = technical.slice(technical.indexOf('data-part="process-problems"'), technical.indexOf('data-part="process-features"'));
    expect(tech).toContain(d('tech situation r4'));
    expect(tech).toContain('data-part="citation"');
  });

  it('shows the suggestions written under it as two rows, as the remedies page does: one row of the problem titles, one of the suggestion without its id group, the anchor of its line', () => {
    const rows = [designRow('r4', 'P1'), designRow('r6', 'P1')];
    const item = { ...PROCESSES.items[0], remedies: [
      { line: 7, texts: { product: `**${d('Merge entrances')}** ${d('Close in one place')} [P1, R4, R6, D99].`, technical: `**${d('Merge entrances')}** ${d('Close in one place')} [P1, R4, R6, D99] \`src/q.js:3\`.` } },
      { line: 9, texts: { product: `**${d('Second')}** ${d('No problem named')} [P1].`, technical: `**${d('Second')}** ${d('No problem named')} [P1].` } },
    ] };
    const data = withRows(withProcesses({ ...PROCESSES, items: [item, ...PROCESSES.items.slice(1)] }), rows);
    window.history.replaceState(null, '', '#/product/processes/P1');
    const host = mount(<App data={data} />);
    const section = host.querySelector('[data-part="process-remedies"]') as HTMLElement;
    expect(section.querySelector('h2')?.textContent).toBe(fixed('page.processes.suggestions'));
    const first = section.querySelector('#remedy-7') as HTMLElement;
    const labels = Array.from(first.querySelectorAll('.remedy-row-label')).map((label) => label.textContent);
    expect(labels).toEqual([fixed('page.remedies.problem'), fixed('page.remedies.suggestion')]);
    const problems = first.querySelector('[data-part="remedy-problems"] .remedy-row-content') as HTMLElement;
    expect(problems.textContent).toBe(`${d('summary r4')}${fixed('page.remedies.problemSeparator')}${d('summary r6')}`);
    expect(first.querySelector('a')).toBeNull();
    const suggestion = first.querySelector('[data-part="remedy-suggestion"] .remedy-row-content') as HTMLElement;
    expect(suggestion.textContent).toBe(`${d('Merge entrances')} ${d('Close in one place')}.`);
    expect(first.textContent).not.toMatch(/[\[\]]|\bR4\b|\bD99\b|P1/);
    expect(suggestion.querySelector('strong')?.textContent).toBe(d('Merge entrances'));
    // An item that names no problem has the suggestion row only.
    const second = section.querySelector('#remedy-9') as HTMLElement;
    expect(second.querySelector('[data-part="remedy-problems"]')).toBeNull();
    expect(second.querySelector('.remedy-row-label')?.textContent).toBe(fixed('page.remedies.suggestion'));
    expect(second.textContent).not.toContain('[');
  });

  it('shows neither the problems nor the suggestions section for a process that has none', () => {
    const html = decode(render(withRows(page, [designRow('r4', 'P1')]), '#/product/processes/P2'));
    expect(html).not.toContain('data-part="process-problems"');
    expect(html).not.toContain('data-part="process-remedies"');
    expect(html).not.toContain(`<h2>${fixed('page.processes.problems')}</h2>`);
    expect(html).not.toContain(`<h2>${fixed('page.processes.suggestions')}</h2>`);
    expect(html).toContain('data-part="process-features"');
  });

  it('is not found for a process the data does not have', () => {
    expect(decode(render(page, '#/product/processes/P9'))).toContain(fixed('page.notFound.heading'));
  });
});

describe('citations on the process page', () => {
  it('are the chip of the chapter pages, inside the page that styles that chip so a long path wraps', () => {
    const html = decode(render(page, '#/technical/processes/P1'));
    expect(html).toContain('class="cite"');
    const css = readFileSync(join(__dirname, '../src/index.css'), 'utf-8');
    expect(css).toMatch(/\.processes code\.cite[^{]*\{[^}]*overflow-wrap: anywhere/);
    expect(css).toMatch(/\.processes code\.cite > \*/);
  });
});

describe('the feature page', () => {
  it('lists the processes that pass through the feature by name, each linking to its page', () => {
    const html = decode(render(page, '#/product/chapter/F2'));
    const at = html.indexOf('data-part="feature-processes"');
    expect(at).toBeGreaterThan(-1);
    const block = html.slice(at, html.indexOf('</ul>', at));
    expect(block).toContain('href="#/product/processes/P1"');
    expect(block).toContain('href="#/product/processes/P2"');
    expect(block).not.toContain('data-process="P3"');
    expect(textOf(block)).not.toMatch(NUMBER);
    expect(html).toContain(`>${fixed('page.feature.block.processes')}</h2>`);
  });

  it('has no block for a feature in no process, and none without processes data', () => {
    expect(decode(render(page, '#/product/chapter/F1'))).not.toContain('data-part="feature-processes"');
    expect(decode(render(withProcesses(null), '#/product/chapter/F2'))).not.toContain('data-part="feature-processes"');
  });

  it('opens the page of that process when a link of a feature page in two processes is clicked', async () => {
    window.history.replaceState(null, '', '#/product/chapter/F2');
    const host = mount(<App data={page} />);
    const links = Array.from(host.querySelectorAll<HTMLAnchorElement>('[data-part="feature-processes"] a'));
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['#/product/processes/P1', '#/product/processes/P2']);
    act(() => links[1].click());
    // A click on an anchor navigates in a browser; happy-dom does not, so follow the link the way the browser would.
    await act(async () => { window.location.hash = links[1].getAttribute('href') as string; await new Promise((done) => { setTimeout(done, 30); }); });
    expect(host.querySelector('[data-view="process"]')?.getAttribute('data-process')).toBe('P2');
    expect(host.querySelector('[data-view="problems"]')).toBeNull();
  });
});

describe('the search', () => {
  const items: SearchItem[] = [
    { kind: 'process', title: d('Refund an order'), chapter: null, domain: null, heading: null, level: null, id: 'P4' },
    { kind: 'problem', title: `R12 ${d('Two entrances')}`, chapter: null, domain: null, heading: null, level: null, id: 'r12' },
    { kind: 'problem', title: `D3 ${d('A hidden button')}`, chapter: null, domain: null, heading: null, level: null, id: 'd3' },
  ];
  const input = { groups: [], items, references: [], systemTitle: 's', domainsLabel: 'd', sources: [] };

  it('finds a process by its name, with the page of the process as the target and no number in the title, and a problem by its number', () => {
    const process = searchAll({ ...input, query: 'Refund' }).results;
    expect(process.map((result) => result.target)).toEqual([{ kind: 'process', id: 'P4' }]);
    expect(process[0].title).toBe(d('Refund an order'));
    expect(process[0].title).not.toMatch(NUMBER);
    expect(searchAll({ ...input, query: 'P4' }).results).toEqual([]);
    expect(searchAll({ ...input, query: 'R12' }).results.map((result) => result.target)).toEqual([{ kind: 'problem', id: 'r12' }]);
    expect(searchAll({ ...input, query: 'D3' }).results.map((result) => result.target)).toEqual([{ kind: 'problem', id: 'd3' }]);
  });
});

describe('the fixture', () => {
  it('has the feature chapters the tests above rely on', () => {
    expect(FEATURES.map(([id]) => id)).toEqual(['F1', 'F2', 'F3', 'F4']);
  });
});
