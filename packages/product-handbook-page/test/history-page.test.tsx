// O2 (page) of openspec change handbook-history-appendix: the route #/history in both views with a sidebar link right before the coverage
// link; the commits of each year as a table and bars drawn from it, the applications (one without history has its reason in the first cell),
// the files that change most by name in the product view and by path in the technical view with each feature as a link, the pairs changed
// together, the source and test files with the conventions; a project with no version history says so with the reason and still shows the
// test files; a missing or malformed file has one line; and every fixed text comes from the ui table.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AppView, documentTitle } from '../src/App';
import { parseHash, routeHash } from '../src/lib/route';
import { PAGE_FORMAT } from '../src/lib/types';
import type { History, PageData } from '../src/lib/types';
import { NO_APPENDIX } from './empty-parts';

const MARK = '@@';
const DATA = 'd~';
const shipped = JSON.parse(readFileSync(fileURLToPath(new URL('../../../skills/excavator-product-handbook/ui-strings.json', import.meta.url)), 'utf-8')) as { strings: Record<string, string> };
const marked = Object.fromEntries(Object.entries(shipped.strings).map(([key, value]) => [key, `${MARK}${value}`]));
const d = (text: string): string => `${DATA}${text}`;

const HISTORY: History = {
  state: 'ok',
  noHistory: null,
  years: [
    { year: 2022, commits: 3, byApp: { [d('api')]: 2, [d('web')]: 2 } },
    { year: 2023, commits: 0, byApp: {} },
    { year: 2024, commits: 6, byApp: { [d('api')]: 6 } },
  ],
  apps: [
    { dir: d('api'), first: '2022-03-01', last: '2024-09-09', commits: 8, authors: 3, authors80: 2, reason: null },
    { dir: d('loose'), first: null, last: null, commits: null, authors: null, authors80: null, reason: 'not-a-repository' },
  ],
  hotspots: [
    { name: d('orders.js'), app: d('api'), commits: 5, authors: 2, lines: 20, last: '2024-09-09', uncertain: 0, features: ['F1', 'F2'] },
    { name: d('misc.js'), app: null, commits: 2, authors: 1, lines: 9, last: '2023-01-01', uncertain: 0, features: [] },
  ],
  coChange: [{ a: d('orders.js'), appA: d('api'), b: d('page.js'), appB: d('web'), commits: 4 }],
  tests: [{ dir: d('api'), sourceFiles: 9, testFiles: 2 }, { dir: d('web'), sourceFiles: 4, testFiles: 0 }],
  conventions: ['goTest', 'dotTest', 'testsDir'],
};

const feature = (id: string, name: string): PageData['features'][number] => ({ id, name: d(name), area: d('A1'), domain: d('A1'), reach: 'menu', status: 'verified', entry: null, findingsStatus: 'planned' });

function dataFor(history: History = HISTORY, views: ('product' | 'technical')[] = ['product', 'technical']): PageData {
  return {
    format: PAGE_FORMAT,
    chunks: { parts: [], units: {} },
    project: d('Acme'),
    language: d('language'),
    languageTag: 'xx',
    ui: { strings: marked },
    views,
    areas: [{ id: d('A1'), name: d('area') }],
    domains: [{ id: d('A1'), name: d('area') }],
    domainBasis: 'areas',
    features: [feature('F1', 'Orders'), feature('F2', 'Reminders')],
    findings: [],
    remedies: { categories: [], recommendations: [] },
    topics: { approval: [], time: [], handoffs: [], access: [], repeated: [] },
    history,
    appendix: NO_APPENDIX,
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
        topicLocations: [], findingLocations: [],
        history: { hotspots: [d('api/src/orders.js'), d('misc.js')], coChange: [{ a: d('api/src/orders.js'), b: d('web/src/page.js') }] },
        data: null, dataState: 'missing' as const, dictionaries: null, dictionariesState: 'missing' as const,
      },
    } : {}),
  };
}

const render = (data: PageData, hash: string): string => renderToStaticMarkup(<AppView data={data} route={parseHash(hash)} />);
const main = (html: string): string => html.slice(html.indexOf('<main'));
const decode = (text: string): string => text.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const part = (html: string, name: string): string => {
  const start = html.indexOf(`data-part="${name}"`);
  expect(start, name).toBeGreaterThan(0);
  const end = html.indexOf('</section>', start);
  return decode(html.slice(start, end));
};

describe('the history route and link', () => {
  it('parses #/history with and without the view and builds it back', () => {
    expect(parseHash('#/history')).toEqual({ name: 'history' });
    expect(parseHash('#/technical/history')).toEqual({ name: 'history', view: 'technical' });
    expect(parseHash('#/product/history/x').name).toBe('not-found');
    expect(routeHash({ name: 'history' }, null)).toBe('#/history');
    expect(routeHash({ name: 'history' }, 'technical')).toBe('#/technical/history');
  });

  it('has the sidebar link right before the coverage link in both views, with the heading from the ui table', () => {
    for (const view of ['product', 'technical']) {
      const html = render(dataFor(), `#/${view}`);
      const rail = html.slice(html.indexOf('<nav class="rail"'), html.indexOf('</nav>', html.indexOf('<nav class="rail"')));
      const links = Array.from(rail.matchAll(/href="([^"]*)"/g), (match) => match[1]);
      const at = links.indexOf(`#/${view}/history`);
      expect(at, view).toBeGreaterThan(-1);
      expect(links[at + 1]).toBe(`#/${view}/coverage`);
      expect(rail).toContain(marked['md.history.heading']);
    }
  });

  it('has the page title from the ui table', () => {
    const title = documentTitle(dataFor(), parseHash('#/product/history'));
    expect(title).toContain(marked['md.history.heading']);
    expect(title).toContain(d('Acme'));
  });
});

describe('the history page', () => {
  it('writes the commits of each year as a table with a zero for a year without commits, and bars drawn from the same rows', () => {
    const html = main(render(dataFor(), '#/product/history'));
    const years = part(html, 'history-years');
    expect(years).toContain(marked['md.history.yearsNote']);
    expect(years).toMatch(/<tr data-year="2022"><th scope="row">2022<\/th><td>3<\/td>/);
    expect(years).toMatch(/<tr data-year="2023"><th scope="row">2023<\/th><td>0<\/td><td data-empty="true"><\/td>/);
    expect(years).toContain(marked['md.history.byAppItem'].replace('{application}', d('api')).replace('{count}', '2'));
    // The widest bar is the year with the most commits; a year without commits has an empty bar.
    expect(years).toContain('width:100%');
    expect(years).toContain('width:50%');
    expect(years).toContain('width:0%');
    expect(years).toContain(`aria-label="${marked['md.history.chartTitle']}"`);
  });

  it('writes each application, and one without history with its reason in the first cell and empty cells after it', () => {
    const html = main(render(dataFor(), '#/product/history'));
    const apps = part(html, 'history-apps');
    expect(apps).toMatch(new RegExp(`<tr data-application="${d('api')}"><th scope="row">${d('api')}</th><td>2022-03-01</td><td>2024-09-09</td><td>8</td><td>3</td><td>2</td></tr>`));
    expect(apps).toContain(marked['md.history.appNoHistory'].replace('{reason}', marked['md.history.reason.notARepository']));
    expect(apps).toMatch(/<td data-empty="true"><\/td><td data-empty="true"><\/td><td data-empty="true"><\/td><td data-empty="true"><\/td>/);
  });

  it('writes the file name and each feature as a link to its page in the product view, and no path', () => {
    const html = render(dataFor(), '#/product/history');
    const hotspots = part(main(html), 'history-hotspots');
    expect(hotspots).toContain(`<th scope="col">${marked['md.history.table.file']}</th>`);
    expect(hotspots).toContain(`<th scope="row">${d('orders.js')}</th>`);
    expect(hotspots).toContain(`<a href="#/product/feature/F1">${d('Orders')}</a>`);
    expect(hotspots).toContain(`<a href="#/product/feature/F2">${d('Reminders')}</a>`);
    expect(hotspots).toMatch(/<th scope="row">d~misc\.js<\/th><td data-empty="true"><\/td>/);
    expect(html).not.toContain('api/src');
  });

  it('writes no uncertain mark and no note when no listed file has an uncertain count', () => {
    for (const view of ['product', 'technical']) {
      const hotspots = part(main(render(dataFor(), `#/${view}/history`)), 'history-hotspots');
      expect(hotspots, view).not.toContain(marked['md.history.uncertainNote']);
      expect(hotspots, view).not.toContain('uncertain)');
      expect(hotspots, view).toContain('<td>5</td>');
    }
  });

  it('writes the commits of a file with an uncertain count as the ui text and one note after the hotspots note, in both views', () => {
    const uncertain: History = { ...HISTORY, hotspots: [{ ...HISTORY.hotspots[0], uncertain: 3 }, HISTORY.hotspots[1]] };
    const mark = marked['md.history.commitsUncertain'].replace('{commits}', '5').replace('{uncertain}', '3');
    for (const view of ['product', 'technical']) {
      const hotspots = part(main(render(dataFor(uncertain), `#/${view}/history`)), 'history-hotspots');
      expect(hotspots, view).toContain(`<td>${mark}</td>`);
      // the file without an uncertain count keeps its plain number
      expect(hotspots, view).toContain('<td>2</td>');
      expect(hotspots.split(marked['md.history.uncertainNote']).length - 1, view).toBe(1);
      expect(hotspots.indexOf(marked['md.history.uncertainNote']), view).toBeGreaterThan(hotspots.indexOf(marked['md.history.hotspotsNote']));
      expect(hotspots.indexOf(marked['md.history.uncertainNote']), view).toBeLessThan(hotspots.indexOf('<table'));
    }
  });

  it('writes the path of each file in the technical view', () => {
    const html = decode(main(render(dataFor(), '#/technical/history')));
    expect(html).toContain(`<th scope="col">${marked['md.history.table.path']}</th>`);
    expect(html).toContain(`<th scope="row">${d('api/src/orders.js')}</th>`);
    expect(html).toContain(marked['md.history.fileInApplication'].replace('{file}', d('api/src/orders.js')).replace('{application}', d('api')));
    expect(html).toContain(marked['md.history.fileInApplication'].replace('{file}', d('web/src/page.js')).replace('{application}', d('web')));
  });

  it('writes the pairs changed together by name in the product view', () => {
    const co = part(main(render(dataFor(), '#/product/history')), 'history-cochange');
    expect(co).toContain(marked['md.history.fileInApplication'].replace('{file}', d('orders.js')).replace('{application}', d('api')));
    expect(co).toContain(marked['md.history.fileInApplication'].replace('{file}', d('page.js')).replace('{application}', d('web')));
    expect(co).toContain('<td>4</td>');
  });

  it('writes the test files with the conventions from the ui table, in the order the data gives them', () => {
    const tests = part(main(render(dataFor(), '#/product/history')), 'history-tests');
    const conventions = ['goTest', 'dotTest', 'testsDir'].map((id) => marked[`md.history.test.${id}`]).join('; ');
    expect(tests).toContain(marked['md.history.testsNote'].replace('{conventions}', conventions));
    expect(tests).toContain(`<th scope="row">${d('web')}</th><td>4</td><td>0</td>`);
  });

  it('says there is no version history, with the reason, shows no year, application or file list and still shows the test files', () => {
    const html = main(render(dataFor({ ...HISTORY, noHistory: { reason: 'inside-repository' }, years: [], apps: [], hotspots: [], coChange: [] }), '#/product/history'));
    expect(decode(html)).toContain(marked['md.history.noHistory'].replace('{reason}', marked['md.history.reason.insideRepository']));
    expect(html).not.toContain('history-years');
    expect(html).not.toContain('history-hotspots');
    expect(html).toContain('history-tests');
  });

  it('has one line for a missing file and one for a malformed file, and no table', () => {
    for (const [state, key, name] of [['missing', 'md.history.notWritten', 'history-missing'], ['malformed', 'md.history.malformed', 'history-malformed']] as const) {
      const html = main(render(dataFor({ ...HISTORY, state }), '#/product/history'));
      expect(html).toContain(`data-part="${name}">${marked[key]}`);
      expect(html).not.toContain('<table');
    }
  });

  it('has the note and the same sections in both views, the technical view with the paths', () => {
    for (const view of ['product', 'technical']) {
      const html = main(render(dataFor(), `#/${view}/history`));
      expect(html).toContain(marked['md.history.note']);
      for (const name of ['history-years', 'history-apps', 'history-hotspots', 'history-cochange', 'history-tests']) expect(html, `${view} ${name}`).toContain(`data-part="${name}"`);
    }
  });
});
