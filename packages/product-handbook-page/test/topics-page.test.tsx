// O2 (page) of openspec change handbook-topics: the route #/topics in both views with a sidebar link after the recommendations, one table
// for each topic with the columns of the topic and a basis column, the places of the cited items and groups in the technical view only,
// a topic without a row saying how many entries it read (never that the system has none), the coverage page listing each lane and the
// rows the judges left out, and every fixed text coming from the ui table.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AppView } from '../src/App';
import { parseHash, routeHash } from '../src/lib/route';
import { PAGE_FORMAT } from '../src/lib/types';
import type { PageData, Topics } from '../src/lib/types';
import { NO_APPENDIX, NO_HISTORY } from './empty-parts';

const MARK = '@@';
const DATA = 'd~';
const shipped = JSON.parse(readFileSync(fileURLToPath(new URL('../../../skills/excavator-product-handbook/ui-strings.json', import.meta.url)), 'utf-8')) as { strings: Record<string, string> };
const marked = Object.fromEntries(Object.entries(shipped.strings).map(([key, value]) => [key, `${MARK}${value}`]));
const d = (text: string): string => `${DATA}${text}`;

const EMPTY: Topics = { approval: [], time: [], handoffs: [], access: [], repeated: [] };
const TOPICS: Topics = {
  approval: [{
    fields: { business: d('Leave'), route: d('The lead approves, then the head.'), skips: '', conditions: d('Over 5 days the director too.'), actors: d('Lead, head') },
    basis: [{ id: 'F1#operations[0].sentences[0]', kind: 'item', feature: d('Leave'), text: d('Submit: the lead approves, then the head.') }],
  }],
  time: [],
  handoffs: [{
    fields: { from: d('Payroll'), to: d('Leave'), content: d('Days taken') },
    basis: [{ id: 'F1#operations[1].sentences[0]', kind: 'item', feature: d('Leave'), text: d('Close: the days taken go to payroll.') }],
  }],
  access: [],
  repeated: [{
    fields: { mechanism: d('No caller check'), places: d('Leave, Payroll') },
    basis: [{ id: 'F1.findings[0]', kind: 'group', category: 'authorization', level: 'P0', text: d('Deleting asks nothing.') }, { id: 'F2.findings[0]', kind: 'group', category: 'authorization', level: null, text: d('Reading asks nothing.') }],
  }],
};
const LANES = [
  { id: 'D1', name: d('Leave'), status: 'verified', kept: 2, dropped: 1 },
  { id: 'D2', name: d('Payroll'), status: 'verified', kept: 0, dropped: 0 },
  { id: 'repeated', name: null, status: 'verified', kept: 1, dropped: 0 },
];

function dataFor(topics: Topics = TOPICS, coverage: Partial<PageData['coverage']['topics']> = {}, views: ('product' | 'technical')[] = ['product', 'technical']): PageData {
  return {
    format: PAGE_FORMAT,
    chunks: { parts: [], units: {} },
    project: d('Acme'),
    language: d('language'),
    languageTag: 'xx',
    ui: { strings: marked },
    views,
    areas: [],
    domains: [],
    domainBasis: 'areas',
    features: [],
    findings: [],
    remedies: { categories: [], recommendations: [] },
    topics,
    history: NO_HISTORY,
    appendix: NO_APPENDIX,
    coverage: {
      candidateTotal: 0, assigned: 0, unassigned: [], reachCounts: [], removedOverview: [], removed: [], findingsUnfinished: [], findingsNotWritten: 0, findingsRemoved: [],
      systemFindingsTotal: 0, systemFindingsUnfinished: [], systemFindingsNotWritten: 0, systemFindingsRemoved: [], priority: { finished: true, unranked: [] }, remedies: { finished: true, stale: false, dropped: [] },
      topics: { finished: true, stale: false, entriesRead: 3, groupsRead: 2, lanes: LANES, dropped: [], ...coverage },
    },
    summary: { notifications: [], jobs: [], counts: { featureTotal: 0, featuresWithEntry: 0, notificationRows: 0, jobRows: 0, schedule: { literal: 0, computed: 0, absent: 0 }, described: 0 } },
    system: { status: 'planned', overview: null, applications: [], counts: { applications: 0, files: 0, lines: 0, areas: 0, features: 0, featuresWithEntry: 0, roles: 0 }, areas: [], domains: [] },
    entities: { domains: [], roles: [], roleFeature: { roles: [], features: [], cells: [] } },
    ...(views.includes('technical') ? {
      technical: {
        featureApplication: [], unattributed: [], applicationDomain: { applications: [], domains: [], cells: [], unattributed: [] }, integrations: [], jobs: [], locations: [],
        topicLocations: [{ id: 'F1#operations[0].sentences[0]', citations: [{ file: d('src/leave.js'), startLine: 12, endLine: 14 }] }],
        history: { hotspots: [], coChange: [] },
        findingLocations: [{ id: 'F1.findings[0]', citations: [{ file: d('src/delete.js'), startLine: 7, endLine: 7 }] }],
        data: null, dataState: 'missing' as const, dictionaries: null, dictionariesState: 'missing' as const,
      },
    } : {}),
  };
}

const render = (data: PageData, hash: string): string => renderToStaticMarkup(<AppView data={data} route={parseHash(hash)} />);
const main = (html: string): string => html.slice(html.indexOf('<main'));
const decode = (text: string): string => text.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const part = (html: string, topic: string): string => {
  const start = html.indexOf(`data-topic="${topic}"`);
  expect(start, topic).toBeGreaterThan(0);
  const end = html.indexOf('</section>', start);
  return decode(html.slice(start, end));
};

describe('the topics route and link', () => {
  it('parses #/topics with and without the view and builds it back', () => {
    expect(parseHash('#/topics')).toEqual({ name: 'topics' });
    expect(parseHash('#/technical/topics')).toEqual({ name: 'topics', view: 'technical' });
    expect(parseHash('#/product/topics/x').name).toBe('not-found');
    expect(routeHash({ name: 'topics' }, null)).toBe('#/topics');
    expect(routeHash({ name: 'topics' }, 'technical')).toBe('#/technical/topics');
  });

  it('both views have the sidebar link right after the recommendations link', () => {
    for (const view of ['product', 'technical']) {
      const html = render(dataFor(), `#/${view}`);
      const rail = html.slice(html.indexOf('<nav class="rail"'), html.indexOf('</nav>', html.indexOf('<nav class="rail"')));
      const links = Array.from(rail.matchAll(/href="([^"]*)"/g), (match) => match[1]);
      const at = links.indexOf(`#/${view}/recommendations`);
      expect(at, view).toBeGreaterThan(-1);
      expect(links[at + 1]).toBe(`#/${view}/topics`);
      expect(rail).toContain(marked['page.nav.topics']);
    }
  });
});

describe('the topics page', () => {
  it('writes one section for each topic in the order of the table, with the heading from the ui table', () => {
    const html = main(render(dataFor(), '#/product/topics'));
    const headings = Array.from(html.matchAll(/class="section-title" id="topic-[a-z]+">([^<]*)</g), (match) => match[1]);
    expect(headings).toEqual(['approval', 'time', 'handoffs', 'access', 'repeated'].map((topic) => marked[`md.topics.${topic}.heading`]));
    expect(html).toContain(marked['md.topics.note']);
    expect(decode(html)).toContain(`${MARK}Lanes: 3. Verified entries read: 3. Verified groups of findings read: 2. Rows: 3.`);
  });

  it('writes each row as a block: its first column on the first line, the other columns as labelled fields, and the basis under them', () => {
    const html = main(render(dataFor(), '#/product/topics'));
    const approval = part(html, 'approval');
    expect(approval).not.toContain('<table');
    expect(approval).toContain('<ul class="item-list"');
    expect(approval).toContain(`<div class="item-attrs">`);
    expect(approval).toContain(`<span class="inline-label">${marked['md.topics.col.approval.route']}</span>`);
    expect(approval).toContain(`<span class="inline-label">${marked['md.topics.col.basis']}</span>`);
    expect(approval).toContain(d('The lead approves, then the head.'));
    expect(approval).toContain(`${MARK}${d('Leave')}: ${d('Submit: the lead approves, then the head.')}`);
    expect(part(html, 'handoffs')).toContain(d('Payroll'));
    expect(part(html, 'repeated')).toContain(`${MARK}[${marked['md.priority.level'].replace('{rank}', '0')}] `);
    expect(part(html, 'repeated')).toContain(d('Reading asks nothing.'));
  });

  it('says how many verified entries a topic without a row read, and never that the system has none', () => {
    const html = main(render(dataFor(), '#/product/topics'));
    expect(part(html, 'time')).toContain(`${MARK}The 3 verified entries it read state none of this.`);
    expect(part(html, 'access')).toContain(`${MARK}The 3 verified entries it read state none of this.`);
    expect(part(render(dataFor({ ...TOPICS, repeated: [] }), '#/product/topics'), 'repeated')).toContain(`${MARK}The 2 verified groups of findings it read hold none of this.`);
  });

  it('writes no file or line in the product view and the file and lines of each cited item and group in the technical view', () => {
    expect(render(dataFor(), '#/product/topics')).not.toContain('src/');
    const technical = decode(main(render(dataFor(), '#/technical/topics')));
    expect(technical).toContain(`<code class="loc-chip">${d('src/')}<wbr/>leave.js:12-14</code>`);
    expect(technical).toContain(`<code class="loc-chip">${d('src/')}<wbr/>delete.js:7</code>`);
    expect(technical).not.toContain('src/delete.js, line 99');
  });

  it('says the topics did not finish when no lane is verified, and shows no table', () => {
    const data = dataFor(EMPTY, { lanes: [{ id: 'D1', name: d('Leave'), status: 'checked', kept: 0, dropped: 0 }], finished: false });
    const html = main(render(data, '#/product/topics'));
    expect(html).toContain(marked['md.topics.notFinished']);
    expect(html).not.toContain('<table');
  });

  it('says a topic whose lane did not finish is not written, while the others are', () => {
    const data = dataFor(TOPICS, { lanes: [LANES[0], LANES[1], { id: 'repeated', name: null, status: 'stale', kept: 0, dropped: 0 }], finished: false, stale: true });
    expect(part(main(render(data, '#/product/topics')), 'repeated')).toContain(marked['md.topics.laneNotFinished']);
  });

  it('says none when there is no lane at all', () => {
    const html = main(render(dataFor(EMPTY, { lanes: [], entriesRead: 0, groupsRead: 0 }), '#/product/topics'));
    expect(html).toContain(marked['md.none']);
    expect(html).not.toContain('<table');
  });

  it('puts the title of the page in the document title', () => {
    expect(render(dataFor(), '#/product/topics')).toContain(marked['md.topics.heading']);
  });
});

describe('the coverage page about the topics', () => {
  const coverage = (data: PageData): string => {
    const html = main(render(data, '#/product/coverage'));
    return decode(html.slice(html.indexOf('id="cov-topics"')));
  };

  it('lists each lane with its status and the rows kept and left out, and the rows the judges left out with their reasons', () => {
    const text = coverage(dataFor(TOPICS, { dropped: [{ id: 'D1#2', topic: 'approval', text: d('Leave / Lead'), reasons: [d('A skip that no item says.')] }] }));
    expect(text).toContain(marked['md.topics.laneStatus.verified']);
    expect(text).toContain(`${marked['md.topics.repeated.heading']}`);
    expect(text).toContain(`${MARK}Left out because a judge found a fact in the row that the entries or findings it cites do not hold: 1.`);
    expect(text).toContain(`${marked['md.topics.approval.heading']}: ${d('Leave / Lead')}`);
    expect(text).toContain(d('A skip that no item says.'));
  });

  it('says that a lane did not finish, was written for other facts, or that everything written is in the handbook', () => {
    expect(coverage(dataFor(TOPICS, { finished: false }))).toContain(marked['md.coverage.topicsNotFinished']);
    expect(coverage(dataFor(TOPICS, { finished: false, stale: true }))).toContain(marked['md.coverage.topicsStale']);
    expect(coverage(dataFor())).toContain(marked['md.coverage.topicsAllKept']);
    expect(coverage(dataFor(EMPTY, { lanes: [] }))).toContain(marked['md.none']);
  });
});
