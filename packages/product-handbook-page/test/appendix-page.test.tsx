// O2 (page) of openspec change handbook-history-appendix: the three parts of the appendix are three pages in both views, with sidebar links
// right after the coverage link; the open questions by domain with the overview's first and each feature a link, the glossary with the kinds,
// the meanings with their features and the features of each term, the sources and scope with what was read and not read, the counts of each
// section and the kept and left-out counts; an empty list says None; and every fixed text comes from the ui table.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AppView, documentTitle } from '../src/App';
import { parseHash, routeHash } from '../src/lib/route';
import { PAGE_FORMAT } from '../src/lib/types';
import type { Appendix, PageData } from '../src/lib/types';
import { NO_APPENDIX, NO_HISTORY } from './empty-parts';

const MARK = '@@';
const DATA = 'd~';
const shipped = JSON.parse(readFileSync(fileURLToPath(new URL('../../../skills/excavator-product-handbook/ui-strings.json', import.meta.url)), 'utf-8')) as { strings: Record<string, string> };
const marked = Object.fromEntries(Object.entries(shipped.strings).map(([key, value]) => [key, `${MARK}${value}`]));
const d = (text: string): string => `${DATA}${text}`;

const APPENDIX: Appendix = {
  open: [
    { feature: null, domain: null, item: d('Whether other tools call it'), searched: d('the routes and the jobs') },
    { feature: 'F1', domain: 'D1', item: d('Who approves a large order'), searched: d('the order form') },
    { feature: 'F2', domain: 'D2', item: d('Who approves a large order'), searched: d('the order form') },
  ],
  glossary: [
    { term: d('Clerk'), kinds: ['role'], features: ['F1', 'F2'], meanings: [{ text: d('Create an order.'), features: ['F1'] }, { text: d('Print an order.'), features: ['F2'] }] },
    { term: d('New Order'), kinds: ['entry', 'screen'], features: ['F1'], meanings: [] },
  ],
  sources: {
    parts: [
      { id: 'overview', units: 1, verified: 1, items: 6, removedVerify: 0, removedTrace: 1, again: 0 },
      { id: 'features', units: 5, verified: 2, items: 14, removedVerify: 2, removedTrace: 1, again: 3 },
      { id: 'findings', units: 5, verified: 2, items: 4, removedVerify: 1, removedTrace: 0, again: 0 },
      { id: 'system-findings', units: 2, verified: 1, items: 0, removedVerify: 0, removedTrace: 0, again: 1 },
    ],
    ranked: { priority: { kept: 3, left: 1 }, remedies: { kept: 4, left: 2 }, topics: { kept: 5, left: 0 } },
  },
};

const feature = (id: string, name: string, domain: string): PageData['features'][number] => ({ id, name: d(name), area: d('A1'), domain, reach: 'menu', status: 'verified', entry: null, findingsStatus: 'planned' });

function dataFor(appendix: Appendix = APPENDIX, views: ('product' | 'technical')[] = ['product', 'technical']): PageData {
  return {
    format: PAGE_FORMAT,
    project: d('Acme'),
    language: d('language'),
    languageTag: 'xx',
    ui: { strings: marked },
    views,
    areas: [{ id: d('A1'), name: d('area') }],
    domains: [{ id: 'D1', name: d('Customer orders') }, { id: 'D2', name: d('System upkeep') }],
    domainBasis: 'domains',
    features: [feature('F1', 'Orders', 'D1'), feature('F2', 'Reminders', 'D2')],
    findings: [],
    remedies: { categories: [], recommendations: [] },
    topics: { approval: [], time: [], handoffs: [], access: [], repeated: [] },
    history: NO_HISTORY,
    appendix,
    coverage: {
      candidateTotal: 0, assigned: 0, unassigned: [], reachCounts: [], removedOverview: [], removed: [], findingsUnfinished: [], findingsNotWritten: 0, findingsRemoved: [],
      systemFindingsTotal: 0, systemFindingsUnfinished: [], systemFindingsNotWritten: 0, systemFindingsRemoved: [], priority: { finished: true, unranked: [] }, remedies: { finished: true, stale: false, dropped: [] },
      topics: { finished: true, stale: false, entriesRead: 0, groupsRead: 0, lanes: [], dropped: [] },
    },
    summary: { notifications: [], jobs: [], counts: { featureTotal: 0, featuresWithEntry: 0, notificationRows: 0, jobRows: 0, schedule: { literal: 0, computed: 0, absent: 0 }, described: 0 } },
    system: { status: 'planned', overview: null, applications: [], counts: { applications: 0, files: 0, lines: 0, areas: 0, features: 0, featuresWithEntry: 0, roles: 0 }, areas: [], domains: [] },
    entities: { domains: [], roles: [], roleFeature: { roles: [], features: [], cells: [] } },
    ...(views.includes('technical') ? {
      technical: {
        featureApplication: [], unattributed: [], applicationDomain: { applications: [], domains: [], cells: [], unattributed: [] }, integrations: [], jobs: [], locations: [],
        topicLocations: [], findingLocations: [], history: { hotspots: [], coChange: [] },
        data: null, dataState: 'missing' as const, dictionaries: null, dictionariesState: 'missing' as const,
      },
    } : {}),
  };
}

const render = (data: PageData, hash: string): string => renderToStaticMarkup(<AppView data={data} route={parseHash(hash)} />);
const main = (html: string): string => html.slice(html.indexOf('<main'));
const decode = (text: string): string => text.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

describe('the appendix routes and links', () => {
  it('parses the three routes with and without the view and builds them back', () => {
    for (const name of ['open-questions', 'glossary', 'sources'] as const) {
      expect(parseHash(`#/${name}`)).toEqual({ name });
      expect(parseHash(`#/technical/${name}`)).toEqual({ name, view: 'technical' });
      expect(parseHash(`#/product/${name}/x`).name).toBe('not-found');
      expect(routeHash({ name }, null)).toBe(`#/${name}`);
      expect(routeHash({ name }, 'technical')).toBe(`#/technical/${name}`);
    }
  });

  it('has the three sidebar links right after the coverage link in both views, in the order of the appendix', () => {
    for (const view of ['product', 'technical']) {
      const html = render(dataFor(), `#/${view}`);
      const rail = html.slice(html.indexOf('<nav class="rail"'), html.indexOf('</nav>', html.indexOf('<nav class="rail"')));
      const links = Array.from(rail.matchAll(/href="([^"]*)"/g), (match) => match[1]);
      const at = links.indexOf(`#/${view}/coverage`);
      expect(links.slice(at + 1, at + 4), view).toEqual([`#/${view}/open-questions`, `#/${view}/glossary`, `#/${view}/sources`]);
      for (const key of ['md.appendix.openHeading', 'md.appendix.glossaryHeading', 'md.appendix.sourcesHeading']) expect(rail).toContain(marked[key]);
    }
  });

  it('has each page title from the ui table', () => {
    for (const [name, key] of [['open-questions', 'md.appendix.openHeading'], ['glossary', 'md.appendix.glossaryHeading'], ['sources', 'md.appendix.sourcesHeading']] as const) {
      expect(documentTitle(dataFor(), parseHash(`#/product/${name}`))).toContain(marked[key]);
    }
  });
});

describe('the open questions page', () => {
  it('writes the overview group first and each domain group with its name, the feature as a link, and the question and the place searched in their own words', () => {
    const html = main(render(dataFor(), '#/product/open-questions'));
    const headings = Array.from(html.matchAll(/class="section-title">([^<]*)</g), (match) => match[1]);
    expect(headings).toEqual([marked['md.overview.heading'], d('Customer orders'), d('System upkeep')]);
    expect(decode(html)).toContain(`${MARK}Open questions: 3.`);
    expect(html).toContain(`<a href="#/product/feature/F1">${d('Orders')}</a>`);
    expect(html).toContain(`<a href="#/product/feature/F2">${d('Reminders')}</a>`);
    expect(html).toContain(d('Whether other tools call it'));
    expect(html).toContain(d('the routes and the jobs'));
    // The overview's row has no feature.
    expect(html).toMatch(/<tr><td data-empty="true"><\/td><td>d~Whether other tools call it<\/td>/);
  });

  it('says None when there is no question', () => {
    const html = main(render(dataFor({ ...APPENDIX, open: [] }), '#/product/open-questions'));
    expect(html).toContain(`data-part="open-none">${marked['md.none']}`);
    expect(html).not.toContain('<table');
  });
});

describe('the glossary page', () => {
  it('writes each term once with its kinds, each meaning with its features, and the features it occurs in as links', () => {
    const html = main(render(dataFor(), '#/product/glossary'));
    expect(decode(html)).toContain(`${MARK}Terms: 2.`);
    expect(html).toContain(`<th scope="row">${d('Clerk')}</th><td>${marked['md.appendix.kind.role']}</td>`);
    expect(html).toContain(`<li>${marked['md.appendix.meaningItem'].replace('{meaning}', d('Create an order.')).replace('{features}', d('Orders'))}</li>`);
    expect(html).toContain(`<li>${marked['md.appendix.meaningItem'].replace('{meaning}', d('Print an order.')).replace('{features}', d('Reminders'))}</li>`);
    expect(html).toContain(`<td>${marked['md.appendix.kind.entry']}, ${marked['md.appendix.kind.screen']}</td>`);
    expect(html).toContain(`<a href="#/product/feature/F1">${d('Orders')}</a>`);
  });

  it('writes an empty meaning cell for a term without a meaning', () => {
    const html = main(render(dataFor(), '#/product/glossary'));
    expect(html).toMatch(/<th scope="row">d~New Order<\/th><td>[^<]*<\/td><td data-empty="true"><\/td>/);
  });

  it('says None when there is no term', () => {
    expect(main(render(dataFor({ ...APPENDIX, glossary: [] }), '#/product/glossary'))).toContain(`data-part="glossary-none">${marked['md.none']}`);
  });
});

describe('the sources and scope page', () => {
  it('writes what was read and not read and the checks, from the ui table', () => {
    const html = main(render(dataFor(), '#/product/sources'));
    for (const key of ['md.appendix.read', 'md.appendix.notRead', 'md.appendix.checks', 'md.appendix.sectionsNote', 'md.appendix.rankedNote']) expect(html, key).toContain(marked[key]);
  });

  it('writes a row for each section with its counts, the removals of the verifiers and of the tracers apart', () => {
    const html = main(render(dataFor(), '#/product/sources'));
    const row = (id: string): string => {
      const start = html.indexOf(`data-section="${id}"`);
      expect(start, id).toBeGreaterThan(0);
      return html.slice(start, html.indexOf('</tr>', start));
    };
    expect(row('features')).toContain(`<th scope="row">${marked['md.appendix.section.features']}</th><td>5</td><td>2</td><td>14</td><td>2</td><td>1</td><td>3</td>`);
    expect(row('overview')).toContain('<td>1</td><td>1</td><td>6</td><td>0</td><td>1</td><td>0</td>');
    expect(row('system-findings')).toContain(`<th scope="row">${marked['md.appendix.section.systemFindings']}</th><td>2</td><td>1</td><td>0</td><td>0</td><td>0</td><td>1</td>`);
    for (const key of ['md.appendix.table.removedVerify', 'md.appendix.table.removedTrace', 'md.appendix.table.again']) expect(html).toContain(`<th scope="col">${marked[key]}</th>`);
  });

  it('writes what the ranking, the remedies and the topics kept and left out', () => {
    const html = main(render(dataFor(), '#/product/sources'));
    expect(html).toContain(`<tr data-part="priority"><th scope="row">${marked['md.appendix.ranked.priority']}</th><td>3</td><td>1</td></tr>`);
    expect(html).toContain(`<tr data-part="remedies"><th scope="row">${marked['md.appendix.ranked.remedies']}</th><td>4</td><td>2</td></tr>`);
    expect(html).toContain(`<tr data-part="topics"><th scope="row">${marked['md.appendix.ranked.topics']}</th><td>5</td><td>0</td></tr>`);
  });

  it('is the same in the technical view', () => {
    expect(main(render(dataFor(), '#/technical/sources'))).toContain(marked['md.appendix.checks']);
    expect(main(render(dataFor(), '#/technical/glossary'))).toContain(d('Clerk'));
    expect(main(render(dataFor(), '#/technical/open-questions'))).toContain(d('the routes and the jobs'));
  });
});
