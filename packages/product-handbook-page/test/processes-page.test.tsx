// @vitest-environment happy-dom
// Tasks 7.2 and 7.3 (search) of openspec change handbook-process-review: the routes of the business processes page, its entry in the
// navigation (only with processes data), the list, one process with its steps (citations in the technical view only), the processes
// block of a feature page and the way from it to a process, and the search by process number. Data is written by hand.
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
import type { ChapterData, PageData, ProcessesData, SearchItem } from '../src/lib/types';
import { cleanup, mount } from './dom';
import { FEATURES, outlineWithFeatures, domainData } from './domains-fixture';
import { BOTH, d, marked } from './page-fixture';

afterEach(() => { cleanup(); window.history.replaceState(null, '', '#'); });
beforeEach(() => { window.history.replaceState(null, '', '#'); });

const fixed = (key: string, values: Record<string, string | number> = {}): string => marked[key].replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole));

const PROCESSES: ProcessesData = {
  items: [
    {
      id: 'P1', name: d('Order to invoice'), features: ['F2', 'F3'],
      steps: [
        { role: d('Clerk'), operation: d('Enter an order'), feature: 'F2', text: d('The clerk saves the order.'), cites: ['src/a.js:1-3'] },
        { role: d('System'), operation: d('Create an invoice'), feature: 'F3', text: d('The system bills it.'), cites: ['src/b.js:4'] },
      ],
      end: { text: d('Invoiced.'), cites: ['src/c.js:9'] },
    },
    { id: 'P2', name: d('Order follow-up'), features: ['F2'], steps: [{ role: d('Clerk'), operation: d('Enter an order'), feature: 'F2', text: d('Again.'), cites: ['src/d.js:2'] }] },
    { id: 'P3', name: d('Support call'), features: ['F4'], steps: [{ role: d('Agent'), operation: d('Answer a call'), feature: 'F4', text: d('Answered.'), cites: [] }] },
  ].map((item) => ({ ...item, features: item.features })),
  coverage: [{ feature: 'F3', operations: [d('Cancel an invoice'), d('Resend an invoice')] }],
};
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

describe('the routes', () => {
  it('parses the list and one process, with and without the view prefix, and builds them back', () => {
    expect(parseHash('#/processes')).toEqual({ name: 'processes' });
    expect(parseHash('#/technical/processes/P12')).toEqual({ name: 'process', id: 'P12', view: 'technical' });
    expect(routeHash({ name: 'process', id: 'P4' }, 'product')).toBe('#/product/processes/P4');
    expect(routeHash({ name: 'processes' }, null)).toBe('#/processes');
    for (const hash of ['#/processes', '#/product/processes/P4', '#/technical/processes']) {
      const parsed = parseHash(hash);
      expect(routeHash(parsed as never, 'view' in parsed && parsed.view !== undefined ? parsed.view : null)).toBe(hash);
    }
  });

  it('makes an id that is no process number, a deeper path and a query not found', () => {
    for (const hash of ['#/processes/x', '#/processes/p4', '#/processes/P4/more', '#/processes?q=a', '#/processes/P']) expect(parseHash(hash).name, hash).toBe('not-found');
  });

  it('is a page of both views, found only when the process exists; the other view keeps the address', () => {
    expect(viewOf(page, parseHash('#/product/processes'), 'c')).toBe('product');
    expect(viewOf(page, parseHash('#/technical/processes/P2'), 'c')).toBe('technical');
    expect(viewOf(page, parseHash('#/product/processes/P9'), 'c')).toBeNull();
    expect(viewOf(withProcesses(null), parseHash('#/product/processes'), 'c')).toBeNull();
    expect(switchTarget(page, parseHash('#/product/processes/P2'), 'technical', 'c')).toBe('#/technical/processes/P2');
    expect(documentTitle(page, parseHash('#/product/processes'))).toContain(fixed('page.nav.processes'));
    expect(documentTitle(page, parseHash('#/product/processes/P2'))).toContain(`P2 ${d('Order follow-up')}`);
  });
});

describe('the navigation', () => {
  it('replaces the processes chapter by the page entry, at the chapter place, titled by the fixed text', () => {
    const items = referencesOf(page, 'product', 'c', 's').flatMap((group) => group.items);
    const entry = items.find((item) => item.block === 'processes');
    expect(entry).toMatchObject({ kind: 'processes', key: 'processes', title: fixed('page.nav.processes') });
    expect(pagesOf(page, 'product', 'c').filter((item) => item.block === 'processes')).toHaveLength(1);
    const html = decode(render(page, '#/product/'));
    expect(html).toContain('data-page="processes"');
    expect(html).toContain('href="#/product/processes"');
    expect(html).toContain(fixed('page.nav.processes'));
  });

  it('has no entry and no page when the run has no processes chapter', () => {
    const bare = withProcesses(null);
    for (const hash of ['#/product/', '#/product/chapter/F2']) {
      const html = decode(render(bare, hash));
      expect(html, hash).not.toContain('data-page="processes"');
      expect(html, hash).not.toContain(fixed('page.nav.processes'));
    }
    expect(decode(render(bare, '#/product/processes'))).toContain(fixed('page.notFound.heading'));
    expect(referencesOf(bare, 'product', 'c', 's').flatMap((group) => group.items).some((item) => item.kind === 'processes')).toBe(false);
  });

  it('keeps the chapter as a plain page when the data has no usable processes (a chapter that did not pass)', () => {
    const failed = withProcesses(null, true);
    const entry = referencesOf(failed, 'product', 'c', 's').flatMap((group) => group.items).find((item) => item.block === 'processes');
    expect(entry).toMatchObject({ kind: 'chapter', key: 'chapter:processes' });
  });
});

describe('the list page', () => {
  const html = decode(render(page, '#/product/processes'));
  it('lists each process with its number, name and step count, each linking to its page', () => {
    for (const [id, name, count] of [['P1', 'Order to invoice', 2], ['P2', 'Order follow-up', 1], ['P3', 'Support call', 1]] as const) {
      const at = html.indexOf(`data-process="${id}"`);
      expect(at, id).toBeGreaterThan(-1);
      const row = html.slice(at, html.indexOf('</li>', at));
      expect(row).toContain(`href="#/product/processes/${id}"`);
      expect(row).toContain(d(name));
      expect(row).toContain(fixed('page.processes.stepCount', { count }));
    }
    expect(html).toContain(`<h1 class="page-title">${fixed('page.nav.processes')}</h1>`);
  });

  it('ends with the operations in no process, by feature, as links', () => {
    const at = html.indexOf('data-part="process-coverage"');
    const section = html.slice(at);
    expect(section).toContain(fixed('chapter.processes.uncovered'));
    expect(section).toContain('href="#/product/chapter/F3"');
    expect(section).toContain(`${d('Cancel an invoice')}${fixed('chapter.processes.uncoveredJoin')}${d('Resend an invoice')}`);
    expect(html.indexOf('data-part="process-list"')).toBeLessThan(at);
    const none = decode(render(withProcesses({ ...PROCESSES, coverage: [] }), '#/product/processes'));
    expect(none).toContain(fixed('chapter.processes.uncoveredNone'));
  });

  it('marks the entry of the left list on the list and on a process', () => {
    for (const hash of ['#/product/processes', '#/product/processes/P1']) {
      expect(decode(render(page, hash)), hash).toMatch(/data-page="processes" aria-current="page"/);
    }
  });
});

describe('one process', () => {
  it('shows the steps in order with the role, the operation, the feature as a link, the sentence, and the end state; no citations in the product view', () => {
    const html = decode(render(page, '#/product/processes/P1'));
    expect(html).toContain('data-process="P1"');
    const steps = html.slice(html.indexOf('data-part="process-steps"'), html.indexOf('data-part="process-end"'));
    expect(steps.indexOf(d('Enter an order'))).toBeGreaterThan(-1);
    expect(steps.indexOf(d('Enter an order'))).toBeLessThan(steps.indexOf(d('Create an invoice')));
    expect(steps).toContain('href="#/product/chapter/F2"');
    expect(steps).toContain('href="#/product/chapter/F3"');
    expect(steps).toContain(d('The clerk saves the order.'));
    expect(html).toContain(fixed('chapter.processes.end'));
    expect(html).toContain(d('Invoiced.'));
    expect(html).not.toContain('data-part="citation"');
    expect(html).toContain(`href="#/product/processes">${fixed('page.nav.processes')}</a>`);
  });

  it('shows the citations of each step and of the end state in the technical view only', () => {
    const html = decode(render(page, '#/technical/processes/P1'));
    expect(html.match(/data-part="citation"/g)?.length).toBe(3);
    expect(html).toContain('title="src/a.js:1-3"');
    expect(html).toContain('title="src/c.js:9"');
  });

  it('lists the features the process passes through and the design problems that name it', () => {
    const withRow: PageData = { ...page, problems: { ...page.problems, rows: [{
      id: 'r4', type: 'design', level: 'high', group: 'duplication', features: ['F2'], summary: d('Two entrances'), texts: {}, process: 'P1', source: { chapter: 'review', line: 3 }, remedies: [],
    }] } };
    const html = decode(render(withRow, '#/product/processes/P1'));
    expect(html.slice(html.indexOf('data-part="process-features"'))).toContain('href="#/product/chapter/F3"');
    const problems = html.slice(html.indexOf('data-part="process-problems"'));
    expect(problems).toContain('href="#/product/problems?row=r4"');
    expect(problems).toContain(`R4 ${d('Two entrances')}`);
    expect(decode(render(page, '#/product/processes/P2'))).not.toContain('data-part="process-problems"');
  });

  it('is not found for a process the data does not have', () => {
    expect(decode(render(page, '#/product/processes/P9'))).toContain(fixed('page.notFound.heading'));
  });
});

describe('citations on the process page', () => {
  it('are the chip of the chapter pages, inside the page that styles that chip so a long path wraps', () => {
    const html = decode(render(page, '#/technical/processes/P1'));
    expect(html).toContain('class="cite"');
    const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf-8');
    expect(css).toMatch(/\.processes code\.cite[^{]*\{[^}]*overflow-wrap: anywhere/);
    expect(css).toMatch(/\.processes code\.cite > \*/);
  });
});

describe('the feature page', () => {
  it('lists the processes that pass through the feature, each linking to its page', () => {
    const html = decode(render(page, '#/product/chapter/F2'));
    const at = html.indexOf('data-part="feature-processes"');
    expect(at).toBeGreaterThan(-1);
    const block = html.slice(at, html.indexOf('</ul>', at));
    expect(block).toContain('href="#/product/processes/P1"');
    expect(block).toContain('href="#/product/processes/P2"');
    expect(block).not.toContain('P3');
    expect(html).toContain(`>${fixed('page.feature.block.processes')}</h2>`);
  });

  it('has no block for a feature in no process, and none without processes data', () => {
    expect(decode(render(page, '#/product/chapter/F1'))).not.toContain('data-part="feature-processes"');
    expect(decode(render(withProcesses(null), '#/product/chapter/F2'))).not.toContain('data-part="feature-processes"');
    expect(decode(render(withProcesses(null), '#/product/chapter/F2'))).not.toContain(fixed('page.feature.block.processes'));
  });

  it('opens the processes page at that process when a link of a feature page in two processes is clicked', async () => {
    window.history.replaceState(null, '', '#/product/chapter/F2');
    const host = mount(<App data={page} />);
    const links = Array.from(host.querySelectorAll<HTMLAnchorElement>('[data-part="feature-processes"] a'));
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['#/product/processes/P1', '#/product/processes/P2']);
    act(() => links[1].click());
    // A click on an anchor navigates in a browser; happy-dom does not, so follow the link the way the browser would.
    await act(async () => { window.location.hash = links[1].getAttribute('href') as string; await new Promise((done) => { setTimeout(done, 30); }); });
    expect(host.querySelector('[data-view="process"]')?.getAttribute('data-process')).toBe('P2');
    expect(host.querySelector('[data-view="problems"]')).toBeNull();
    expect(host.querySelector('[data-page="processes"][aria-current="page"]')).not.toBeNull();
  });
});

describe('the search', () => {
  const items: SearchItem[] = [
    { kind: 'chapter', title: d('Business processes'), chapter: 'processes', domain: null, heading: null, level: null },
    { kind: 'heading', title: `P4 ${d('Refund an order')}`, chapter: 'processes', domain: null, heading: 3, level: 2 },
    { kind: 'heading', title: fixed('chapter.processes.uncovered'), chapter: 'processes', domain: null, heading: 4, level: 2 },
    { kind: 'problem', title: `R12 ${d('Two entrances')}`, chapter: null, domain: null, heading: null, level: null, id: 'r12' },
    { kind: 'problem', title: `D3 ${d('A hidden button')}`, chapter: null, domain: null, heading: null, level: null, id: 'd3' },
  ];
  const input = { groups: [], items, references: [], systemTitle: 's', domainsLabel: 'd', sources: [] };

  it('finds a process by its number and a problem by its number, each with the target that opens it', () => {
    const process = searchAll({ ...input, query: 'P4' }).results;
    expect(process.map((result) => result.target)).toEqual([{ kind: 'process', id: 'P4' }]);
    const problem = searchAll({ ...input, query: 'R12' }).results;
    expect(problem.map((result) => result.target)).toEqual([{ kind: 'problem', id: 'r12' }]);
    expect(searchAll({ ...input, query: 'D3' }).results.map((result) => result.target)).toEqual([{ kind: 'problem', id: 'd3' }]);
  });

  it('finds the generated section of the operations in no process, as a heading of the chapter', () => {
    const found = searchAll({ ...input, query: fixed('chapter.processes.uncovered').slice(0, 12) }).results;
    expect(found.map((result) => result.target)).toEqual([{ kind: 'heading', chapter: 'processes', heading: 4 }]);
  });

  it('opens the process from a match in a step, and the list from a match in the generated section', () => {
    const text = [`# ${d('Business processes')}`, '', `## P4 ${d('Refund an order')}`, '', `1. ${d('Clerk: **Refund**')} the money goes back`, '', `## ${fixed('chapter.processes.uncovered')}`, '', `- ${d('Orders')} (F2): money transfer`].join('\n');
    const found = searchAll({ ...input, query: 'money', sources: [{ chapter: 'processes', text }] }).results;
    expect(found.map((result) => result.target)).toEqual([{ kind: 'process', id: 'P4' }, { kind: 'heading', chapter: 'processes', heading: 1 }]);
  });
});

describe('the fixture', () => {
  it('has the feature chapters the tests above rely on', () => {
    expect(FEATURES.map(([id]) => id)).toEqual(['F1', 'F2', 'F3', 'F4']);
  });
});
