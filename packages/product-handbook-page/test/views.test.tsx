// O1 (page) of openspec change handbook-entities-and-views: a page with one
// view has no switch; with two views the bar has one and switching stays on
// the same entity; the technical navigation is by application; every fixed
// text of the new pages comes from the ui table. The page is rendered to a
// string from synthetic data; the browser half (no sideways scroll at phone
// width, the real switch) is tests/skill/excavator-product-handbook/page-browser.test.mjs.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AppView } from '../src/App';
import { parseHash, routeHash } from '../src/lib/route';
import type { Entry, Feature, PageData, View } from '../src/lib/types';
import { switchTarget, technicalNav } from '../src/lib/views';
import { NO_APPENDIX, NO_HISTORY } from './empty-parts';

const MARK = '@@';
const DATA = 'd~';
const shipped = JSON.parse(readFileSync(fileURLToPath(new URL('../../../skills/excavator-product-handbook/ui-strings.json', import.meta.url)), 'utf-8')) as { strings: Record<string, string> };
const marked = Object.fromEntries(Object.entries(shipped.strings).map(([key, value]) => [key, `${MARK}${value}`]));
const d = (text: string): string => `${DATA}${text}`;
const enc = encodeURIComponent;
/** The directories, the roles and the external system are data text, so each carries the data prefix like the page's own data. */
const SVC = d('svc');
const ADMIN = d('svc/admin');
const GHOST = d('ghost');
const CLERK = d('Clerk');
const APPROVER = d('Approver');
const SLACK = d('Slack');

const entry = (purpose: string, roles: [string, string][]): Entry => ({
  purpose: d(purpose),
  who: roles.map(([role, can]) => ({ role, can: d(can) })),
  where: [], screens: [], operations: [], states: [], transitions: [], notifications: [], automatic: [], unknowns: [],
});

const feature = (id: string, area: string, domain: string, status: Feature['status'], entryValue: Entry | null): Feature => ({
  id, name: d(`name ${id}`), area, domain, reach: 'menu', status, entry: entryValue, findingsStatus: 'planned',
});

/** Two business domains that cross the two areas of the map (F1 and F3 are in A1, F2 and F4 in A2); F1 and F3 verified, F2 and F4 not; applications svc, svc/admin and one with no verified name; Slack is shown for svc and named in svc/admin too. */
function dataFor(views: View[]): PageData {
  const withTechnical = views.includes('technical');
  return {
    format: 'excavator-product-handbook-page/17',
    chunks: { parts: [], units: {} },
    project: d('project'),
    language: d('language'),
    languageTag: 'xx',
    ui: { strings: marked },
    views,
    areas: [{ id: 'A1', name: d('area one') }, { id: 'A2', name: d('area two') }],
    domains: [{ id: 'D1', name: d('domain one') }, { id: 'D2', name: d('domain two') }],
    domainBasis: 'domains',
    features: [
      feature('F1', 'A1', 'D1', 'verified', entry('purpose one', [[CLERK, 'creates']])),
      feature('F2', 'A2', 'D1', 'planned', null),
      feature('F3', 'A1', 'D2', 'verified', entry('purpose three', [[CLERK, 'reviews'], [APPROVER, 'approves']])),
      feature('F4', 'A2', 'D2', 'failed', null),
    ],
    findings: [],
    remedies: { categories: [], recommendations: [] },
    topics: { approval: [], time: [], handoffs: [], access: [], repeated: [] },
    history: NO_HISTORY,
    appendix: NO_APPENDIX,
    coverage: { candidateTotal: 1, assigned: 1, unassigned: [], reachCounts: [{ reach: 'menu', count: 4 }], removedOverview: [], removed: [], findingsUnfinished: [], findingsNotWritten: 0, findingsRemoved: [], systemFindingsTotal: 0, systemFindingsUnfinished: [], systemFindingsNotWritten: 0, systemFindingsRemoved: [], priority: { finished: true, unranked: [] }, remedies: { finished: true, stale: false, dropped: [] }, topics: { finished: true, stale: false, entriesRead: 0, groupsRead: 0, lanes: [], dropped: [] } },
    summary: {
      notifications: [],
      jobs: [{ kind: 'job', candidate: d('c1'), feature: 'F1', reason: null, schedule: { bucket: 'absent', literal: null }, automatic: [] }],
      counts: { featureTotal: 4, featuresWithEntry: 2, notificationRows: 0, jobRows: 1, schedule: { literal: 0, computed: 0, absent: 1 }, described: 0 },
    },
    system: {
      status: 'verified',
      overview: { name: d('system name'), summary: [d('summary')], audiences: [], integrations: [{ system: SLACK, use: d('messages'), callers: [SVC] }], unknowns: [] },
      applications: [
        { dir: SVC, name: d('Service'), does: d('main work'), languages: [{ language: d('Lang'), files: 3 }], frameworks: [], files: 3, lines: 30, history: null },
        { dir: ADMIN, name: d('Admin'), does: d('admin work'), languages: [], frameworks: [], files: 1, lines: 5, history: { first: d('2024-01-01'), last: d('2024-02-01'), commits: 4, authors: 2 } },
        { dir: GHOST, name: null, does: null, languages: [], frameworks: [], files: 0, lines: 0, history: null },
      ],
      counts: { applications: 2, files: 4, lines: 35, areas: 2, domains: 2, features: 4, featuresWithEntry: 2, roles: 2 },
      areas: [{ id: 'A1', name: d('area one'), features: 2, verified: 2, roles: [CLERK, APPROVER] }, { id: 'A2', name: d('area two'), features: 2, verified: 0, roles: [] }],
      domains: [{ id: 'D1', name: d('domain one'), features: 2, verified: 1, roles: [CLERK] }, { id: 'D2', name: d('domain two'), features: 2, verified: 1, roles: [CLERK, APPROVER] }],
    },
    entities: {
      domains: [
        { id: 'D1', name: d('domain one'), features: ['F1', 'F2'], purposes: [{ feature: 'F1', text: d('purpose one') }] },
        { id: 'D2', name: d('domain two'), features: ['F3', 'F4'], purposes: [{ feature: 'F3', text: d('purpose three') }] },
      ],
      roles: [{ label: CLERK }, { label: APPROVER }],
      roleFeature: {
        roles: [CLERK, APPROVER],
        features: ['F1', 'F3'],
        cells: [{ role: CLERK, feature: 'F1', can: [d('creates')] }, { role: CLERK, feature: 'F3', can: [d('reviews')] }, { role: APPROVER, feature: 'F3', can: [d('approves')] }],
      },
    },
    ...(withTechnical ? {
      technical: {
        featureApplication: [
          { feature: 'F1', application: SVC, citations: 3 },
          { feature: 'F1', application: ADMIN, citations: 1 },
          { feature: 'F3', application: ADMIN, citations: 2 },
        ],
        unattributed: [{ feature: 'F3', citations: 1 }],
        applicationDomain: {
          applications: [SVC, ADMIN, GHOST],
          domains: ['D1', 'D2'],
          cells: [{ application: SVC, domain: 'D1', citations: 3 }, { application: ADMIN, domain: 'D1', citations: 1 }, { application: ADMIN, domain: 'D2', citations: 2 }],
          unattributed: [{ domain: 'D2', citations: 1 }],
        },
        integrations: [{ system: SLACK, use: d('messages'), shown: [SVC], named: [{ application: SVC, files: 2 }, { application: ADMIN, files: 1 }], namedOutside: 0 }],
        jobs: [{ candidate: d('c1'), feature: 'F1', application: SVC }],
        locations: [
          { id: 'F1', items: [{ claim: d('claim one'), citations: [{ file: d('src/a.js'), startLine: 3, endLine: 3 }, { file: d('src/b.js'), startLine: 5, endLine: 9 }, { file: d('src/c.js'), startLine: null, endLine: null }] }] },
          { id: 'overview', items: [{ claim: d('overview claim'), citations: [{ file: d('package.json'), startLine: 1, endLine: 1 }] }] },
        ],
        findingLocations: [],
        topicLocations: [], history: { hotspots: [], coChange: [] },
        data: null,
        dataState: 'missing',
        dictionaries: null,
        dictionariesState: 'missing',
      },
    } : {}),
  };
}

const BOTH: View[] = ['product', 'technical'];
const render = (data: PageData, hash: string): string => renderToStaticMarkup(<AppView data={data} route={parseHash(hash)} />);

const decode = (text: string): string => text.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function visibleTexts(html: string): string[] {
  const nodes = html.replace(/<wbr\/>/g, '').split(/<[^>]*>/).map((text) => decode(text).trim()).filter((text) => text !== '');
  const attributes = Array.from(html.matchAll(/\s(?:aria-label|title|alt|placeholder|aria-description)="([^"]*)"/g), (match) => decode(match[1]).trim());
  return [...nodes, ...attributes];
}
const unmarked = (html: string): string[] => visibleTexts(html).filter((text) => !text.includes(MARK) && !(text.startsWith(DATA) && !text.includes('@')) && !/^\d+$/.test(text));

describe('routes: the view in front of the page', () => {
  it('parses a fragment with and without a view, and builds it back', () => {
    expect(parseHash('#/feature/F1')).toEqual({ name: 'feature', id: 'F1' });
    expect(parseHash('#/technical/feature/F1')).toEqual({ name: 'feature', id: 'F1', view: 'technical' });
    expect(parseHash('#/product')).toEqual({ name: 'overview', view: 'product' });
    expect(parseHash('#/technical/application/svc%2Fadmin')).toEqual({ name: 'application', dir: 'svc/admin', view: 'technical' });
    expect(parseHash('#/technical/system/Slack')).toEqual({ name: 'system', system: 'Slack', view: 'technical' });
    expect(parseHash('#/matrix/roles')).toEqual({ name: 'roles-matrix' });
    expect(parseHash('#/technical/matrix/applications')).toEqual({ name: 'applications-matrix', view: 'technical' });
    expect(parseHash('#/design/feature/F1').name).toBe('not-found');
    expect(routeHash({ name: 'feature', id: 'F1' }, null)).toBe('#/feature/F1');
    expect(routeHash({ name: 'feature', id: 'F1' }, 'technical')).toBe('#/technical/feature/F1');
    expect(routeHash({ name: 'application', dir: 'svc/admin' }, 'technical')).toBe('#/technical/application/svc%2Fadmin');
    expect(routeHash({ name: 'overview' }, null)).toBe('#/');
    expect(routeHash({ name: 'overview' }, 'product')).toBe('#/product');
  });
});

describe('the view switch', () => {
  it('a page with one view has no switch, and its links carry no view', () => {
    for (const views of [['product'], ['technical']] as View[][]) {
      const html = render(dataFor(views), '#/');
      expect(html).not.toContain('data-part="view-switch"');
      expect(html).not.toContain('page.view');
      expect(html).toContain('href="#/feature/F1"');
      expect(html).not.toMatch(/href="#\/(product|technical)/);
    }
  });

  it('a page with both views has the switch in the bar, a link per view with the current one marked, and links that carry the view', () => {
    const html = render(dataFor(BOTH), '#/product/feature/F1');
    const bar = html.slice(html.indexOf('<header class="topbar">'), html.indexOf('</header>'));
    expect(bar).toContain('data-part="view-switch"');
    expect(bar).toMatch(/data-view-link="product" aria-current="page"/);
    expect(bar).toContain(`${marked['page.view.product']}`);
    expect(bar).toContain(`${marked['page.view.technical']}`);
    expect(html).toContain('href="#/product/feature/F1"');
    expect(html).not.toContain('href="#/feature/F1"');
  });

  it('switching on a feature page goes to the same feature in the other view, and back', () => {
    const data = dataFor(BOTH);
    const product = render(data, '#/product/feature/F1');
    expect(product).toContain('href="#/technical/feature/F1" data-view-link="technical"');
    const technical = render(data, '#/technical/feature/F1');
    expect(technical).toContain('href="#/product/feature/F1" data-view-link="product"');
  });

  it('stays on the same entity for a domain, a role, the notifications and the matrix; goes to the overview when the other view does not have the page', () => {
    const data = dataFor(BOTH);
    const to = (hash: string, view: View) => switchTarget(data, parseHash(hash), view);
    expect(to('#/product/domain/D2', 'technical')).toBe('#/technical/domain/D2');
    expect(to(`#/product/role/${enc(CLERK)}`, 'technical')).toBe(`#/technical/role/${enc(CLERK)}`);
    expect(to('#/product/matrix/roles', 'technical')).toBe('#/technical/matrix/roles');
    expect(to('#/product/jobs', 'technical')).toBe('#/technical/jobs');
    expect(to(`#/technical/application/${enc(SVC)}`, 'product')).toBe('#/product');
    expect(to(`#/technical/system/${enc(SLACK)}`, 'product')).toBe('#/product');
    expect(to('#/technical/matrix/applications', 'product')).toBe('#/product');
    expect(to(`#/technical/application/${enc(SVC)}`, 'technical')).toBe(`#/technical/application/${enc(SVC)}`);
    expect(to('#/technical/feature/F9', 'product')).toBe('#/product');
    expect(to('#/nowhere', 'technical')).toBe('#/technical');
  });

  it('the roles use the data text, so a role label with a slash or a space round-trips through the fragment', () => {
    const data = dataFor(BOTH);
    data.entities.roles[0].label = 'Clerk / front desk';
    data.entities.roleFeature.roles[0] = 'Clerk / front desk';
    expect(switchTarget(data, parseHash('#/product/role/Clerk%20%2F%20front%20desk'), 'technical')).toBe('#/technical/role/Clerk%20%2F%20front%20desk');
    expect(switchTarget(data, parseHash('#/product/role/Clerk%20%2F%20back%20desk'), 'technical')).toBe('#/technical');
  });
});

describe('the technical view is navigated by application', () => {
  const data = dataFor(BOTH);

  it('lists each application with the domains that have quoted passages in it and, under each domain, those features; the features in no application are in a group of their own', () => {
    const nav = technicalNav(data);
    expect(nav.applications.map((application) => [application.dir, application.domains.map((domain) => [domain.id, domain.features.map((item) => item.id)])])).toEqual([
      [SVC, [['D1', ['F1']]]],
      [ADMIN, [['D1', ['F1']], ['D2', ['F3']]]],
      [GHOST, []],
    ]);
    expect(nav.unplaced.map((item) => item.id)).toEqual(['F2', 'F4']);
  });

  it('lists the applications in the rail, one link each, in the order of the overview, then the domains and the external systems', () => {
    const html = render(data, '#/technical');
    const rail = html.slice(html.indexOf('<nav class="rail"'), html.indexOf('</nav>', html.indexOf('<nav class="rail"')));
    expect(rail).toContain('data-view-nav="technical"');
    const at = (text: string, from = 0) => rail.indexOf(text, from);
    const svc = at(`data-application="${SVC}"`);
    const admin = at(`data-application="${ADMIN}"`);
    const ghost = at(`data-application="${GHOST}"`);
    expect(svc).toBeGreaterThan(0);
    expect(admin).toBeGreaterThan(svc);
    expect(ghost).toBeGreaterThan(admin);
    expect(at('data-domain="D1"')).toBeGreaterThan(ghost);
    expect(at(`data-system="${SLACK}"`)).toBeGreaterThan(at('data-domain="D2"'));
    expect(rail).not.toContain('/feature/');
  });

  it('the rail is one scroll container that holds every group', () => {
    for (const hash of ['#/technical', '#/product']) {
      const html = render(data, hash);
      const rail = html.slice(html.indexOf('<nav class="rail"'), html.indexOf('</nav>', html.indexOf('<nav class="rail"')));
      expect(rail.match(/class="rail-scroll"/g)).toHaveLength(1);
      expect(rail).toMatch(/^<nav class="rail"[^>]*><div class="rail-scroll"><section class="rail-group"/);
      expect(rail.endsWith('</a></section></div>')).toBe(true);
    }
  });

  it('the product navigation is by domain: no application in the rail', () => {
    const html = render(data, '#/product');
    const rail = html.slice(html.indexOf('<nav class="rail"'), html.indexOf('</nav>', html.indexOf('<nav class="rail"')));
    expect(rail).toContain('data-view-nav="product"');
    expect(rail).not.toContain('data-application');
    expect(rail).toContain('href="#/product/domain/D1"');
    expect(rail).not.toContain('href="#/product/matrix/applications"');
  });
});

describe('pages of the two views', () => {
  const data = dataFor(BOTH);

  it('the feature page shows each cited item with the file and lines in the technical view, and nothing of the kind in the product view', () => {
    const technical = render(data, '#/technical/feature/F1');
    expect(technical).toContain(marked['md.locations.heading']);
    expect(technical).toContain('<details class="loc-details" data-part="locations-details">');
    expect(technical).not.toContain('<details class="loc-details" data-part="locations-details" open');
    expect(technical).toContain(`<code class="loc-chip">${d('src/')}<wbr/>a.js:3</code>`);
    expect(technical).toContain(`<code class="loc-chip">${d('src/')}<wbr/>b.js:5-9</code>`);
    expect(technical).toContain(`${MARK}${d('src/c.js')}, lines not located</code>`);
    const product = render(data, '#/product/feature/F1');
    expect(product).not.toContain('data-part="locations"');
    expect(product).not.toContain(d('src/a.js'));
  });

  it('the overview in the technical view adds the source locations of the system overview; the product overview has none', () => {
    expect(render(data, '#/technical')).toContain(d('package.json'));
    expect(render(data, '#/product')).not.toContain(d('package.json'));
  });

  it('an application page names its relations for what was checked and keeps the two external-system relations apart', () => {
    const html = render(data, `#/technical/application/${enc(ADMIN)}`);
    const part = (key: string) => html.slice(html.indexOf(marked[key]));
    expect(html).toContain(marked['md.entities.app.featuresHeading']);
    expect(html).toContain(marked['md.entities.app.shownHeading']);
    expect(html).toContain(marked['md.entities.app.namedHeading']);
    // svc/admin holds F1 (1 passage) and F3 (2); the system's name is in its source (1 file) but it is not a shown caller.
    expect(html).toMatch(/<tr><th scope="row"[^>]*><a href="#\/technical\/feature\/F1">[^<]*<\/a><\/th><td class="num">1<\/td><\/tr>/);
    expect(html).toMatch(/<td class="num">2<\/td>/);
    const shown = part('md.entities.app.shownHeading');
    expect(shown.slice(0, shown.indexOf(marked['md.entities.app.namedHeading']))).toContain(marked['md.none']);
    expect(part('md.entities.app.namedHeading')).toContain(`${MARK}${SLACK} (1 files)`);
    const svc = render(data, `#/technical/application/${enc(SVC)}`);
    expect(svc.slice(svc.indexOf(marked['md.entities.app.shownHeading']), svc.indexOf(marked['md.entities.app.namedHeading']))).toContain(`href="#/technical/system/${enc(SLACK)}"`);
  });

  it('an external system page lists the shown callers and the applications whose source holds the name apart, and says the name does not mean a call', () => {
    const html = render(data, `#/technical/system/${enc(SLACK)}`);
    expect(html).toContain(marked['md.entities.systems.note']);
    const shown = html.slice(html.indexOf('id="sys-shown"'), html.indexOf('id="sys-named"'));
    expect(shown).toContain(d('Service'));
    expect(shown).not.toContain(d('Admin'));
    const named = html.slice(html.indexOf('id="sys-named"'));
    expect(named).toContain(`${MARK}${d('Admin')} (1 files)`);
    expect(named).toContain(`${MARK}${d('Service')} (2 files)`);
  });

  it('the roles-by-feature matrix has a row per role and a column per verified feature, with an empty cell where the entry says nothing', () => {
    const html = render(data, '#/product/matrix/roles');
    expect(html).toContain(marked['md.matrix.roleFeature.heading']);
    expect((html.match(/<tbody>[\s\S]*<\/tbody>/)?.[0].match(/<tr>/g) ?? []).length).toBe(2);
    expect(html).toContain(d('approves'));
    expect(html).toContain('data-empty="true"');
  });

  it('the applications-by-domain matrix counts the quoted passages per application, with the passages in no application as a last row', () => {
    const html = render(data, '#/technical/matrix/applications');
    expect(html).toContain(marked['md.matrix.applicationDomain.outside']);
    expect((html.match(/<tbody>[\s\S]*<\/tbody>/)?.[0].match(/<tr>/g) ?? []).length).toBe(4);
  });

  it('a role page lists what the verified entries say it can do; a domain page lists its purposes and, in the technical view, its applications', () => {
    const role = render(data, `#/product/role/${enc(APPROVER)}`);
    expect(role).toContain(`${MARK}${MARK}F3 ${d('name F3')}: ${d('approves')}`);
    const domain = render(data, '#/technical/domain/D1');
    expect(domain).toContain(d('purpose one'));
    expect(domain).toContain('data-view="domain"');
    expect(domain).toContain(marked['md.entities.applications.heading']);
    expect(render(data, '#/product/domain/D1')).not.toContain(marked['md.entities.applications.heading']);
  });

  it('a page, a view or an entity the data does not have is the not-found page', () => {
    for (const [views, hash] of [
      [['product'], '#/technical/feature/F1'],
      [['product'], `#/application/${enc(SVC)}`],
      [BOTH, `#/product/application/${enc(SVC)}`],
      [BOTH, '#/technical/application/missing'],
      [BOTH, '#/technical/system/missing'],
      [BOTH, '#/product/role/missing'],
      [BOTH, '#/product/domain/missing'],
    ] as [View[], string][]) {
      expect(render(dataFor(views), hash), hash).toContain('data-view="not-found"');
    }
  });
});

describe('every fixed text of the new pages comes from the ui table', () => {
  const both = dataFor(BOTH);
  const hashes = [
    '#/technical', '#/product', '#/technical/feature/F1', '#/technical/feature/F2', '#/product/feature/F3',
    '#/technical/domain/D1', '#/product/domain/D2', `#/technical/role/${enc(CLERK)}`, `#/product/role/${enc(APPROVER)}`,
    `#/technical/application/${enc(SVC)}`, `#/technical/application/${enc(ADMIN)}`, `#/technical/application/${enc(GHOST)}`, `#/technical/system/${enc(SLACK)}`,
    '#/product/matrix/roles', '#/technical/matrix/roles', '#/technical/matrix/applications', '#/technical/notifications', '#/product/jobs', '#/technical/coverage',
    `#/product/application/${enc(SVC)}`, '#/nowhere',
  ];
  for (const hash of hashes) {
    it(`${hash}: no text without the marker or the data prefix`, () => {
      const html = render(both, hash);
      expect(visibleTexts(html).length).toBeGreaterThan(3);
      expect(unmarked(html)).toEqual([]);
    });
  }

  it('a page with only the technical view is complete too', () => {
    const technical = dataFor(['technical']);
    for (const hash of ['#/', `#/application/${enc(SVC)}`, '#/matrix/applications', '#/feature/F1']) expect(unmarked(render(technical, hash)), hash).toEqual([]);
  });
});

// O1 (page) of openspec change handbook-map-by-domain: the page navigates by the
// business domains, which cross the map's areas; the area stays a property of
// the feature; without a domains file the page groups by area and says so.
describe('the page groups the features by business domain', () => {
  const data = dataFor(['product']);
  const railOf = (html: string) => html.slice(html.indexOf('<nav class="rail"'), html.indexOf('</nav>', html.indexOf('<nav class="rail"')));

  it('draws the navigation by domain: on a feature page the link of its domain is marked, whatever area the feature sits in', () => {
    const rail = railOf(render(data, '#/'));
    const one = rail.indexOf('href="#/domain/D1"');
    const two = rail.indexOf('href="#/domain/D2"');
    expect(one).toBeGreaterThan(0);
    expect(two).toBeGreaterThan(one);
    expect(rail).not.toContain('href="#/domain/A1"');
    // F2 is in area A2 and in domain D1.
    expect(railOf(render(data, '#/feature/F2'))).toContain('<a class="rail-link" data-domain="D1" href="#/domain/D1" aria-current="true">');
  });

  it('the overview count line gives the area count and the business domain count', () => {
    const html = render(data, '#/');
    const line = html.slice(html.indexOf('class="summary-counts"'), html.indexOf('</p>', html.indexOf('class="summary-counts"')));
    expect(line).toContain('Areas: 2. Business domains: 2. Features: 4.');
  });

  it('the overview lists the domains and counts them under the domains label, with no fallback text', () => {
    const html = render(data, '#/');
    expect(html).toContain(marked['page.overview.domainsStat']);
    expect(html).not.toContain(marked['page.overview.areasStat']);
    expect(html).toContain(marked['md.domains.heading']);
    expect(html).not.toContain(marked['md.domains.fromAreas']);
    expect(html).toContain(marked['md.overview.domainsHeading']);
    expect(html).not.toContain(marked['md.overview.areasHeading']);
    expect(html).toContain('href="#/domain/D1"');
  });

  it('a domain page takes the domain\'s features and says what a domain is', () => {
    const html = render(data, '#/domain/D1');
    const main = html.slice(html.indexOf('<main'));
    expect(main).toContain('data-domain="D1"');
    expect(main).toContain(d('domain one'));
    expect(main).toContain('href="#/feature/F2"');
    expect(main).not.toContain('href="#/feature/F3"');
    // D11: the page lists the features, with no line counting them.
    expect(main).not.toContain('class="lede"');
    expect(html).toContain(marked['md.entities.domains.note']);
    expect(html).not.toContain(marked['md.domains.fromAreas']);
  });

  it('a feature page crumbs to its domain and shows the area it sits in as a property', () => {
    const html = render(data, '#/feature/F2');
    expect(html).toContain('href="#/domain/D1"');
    expect(html).toContain(`${MARK}Navigation area: ${d('area two')}`);
  });

  it('keeps the technical navigation by application, with the domains inside, over the domain ids', () => {
    expect(technicalNav(dataFor(BOTH)).applications[1].domains.map((domain) => domain.id)).toEqual(['D1', 'D2']);
  });

  it('every text of the domain pages comes from the ui table', () => {
    for (const hash of ['#/', '#/domain/D1', '#/domain/D2', '#/feature/F2', '#/feature/F3']) expect(unmarked(render(data, hash)), hash).toEqual([]);
  });
});

describe('without business domains the page groups by area and says so', () => {
  /** The data of a handbook with no domains file: the domains are the areas, and every feature's domain is its area. */
  function fallbackData(): PageData {
    const base = dataFor(['product']);
    return {
      ...base,
      domains: base.areas,
      domainBasis: 'areas',
      features: base.features.map((item) => ({ ...item, domain: item.area })),
      system: { ...base.system, counts: { ...base.system.counts, domains: null }, domains: base.system.areas },
      entities: {
        ...base.entities,
        domains: [
          { id: 'A1', name: d('area one'), features: ['F1', 'F3'], purposes: [] },
          { id: 'A2', name: d('area two'), features: ['F2', 'F4'], purposes: [] },
        ],
      },
    };
  }
  const data = fallbackData();

  it('writes the fixed text that these are areas drawn by the navigation on the overview and on a domain page', () => {
    for (const hash of ['#/', '#/domain/A1']) expect(render(data, hash), hash).toContain(marked['md.domains.fromAreas']);
    expect(render(data, '#/domain/A1')).not.toContain(marked['md.entities.domains.note']);
  });

  it('the overview count line is the one without a domain count', () => {
    const html = render(data, '#/');
    expect(html).toContain('Areas: 2. Features: 4.');
    expect(html).not.toContain('Business domains:');
  });

  it('uses the areas label for the count, the heading and the overview table, and navigates by area', () => {
    const html = render(data, '#/');
    expect(html).toContain(marked['page.overview.areasStat']);
    expect(html).not.toContain(marked['page.overview.domainsStat']);
    expect(html).toContain(marked['md.overview.areasHeading']);
    expect(html).toContain('href="#/domain/A1"');
    expect(railOf(html)).toContain('href="#/domain/A2"');
  });

  it('shows no separate area line on a feature page: the domain is the area', () => {
    const html = render(data, '#/feature/F2');
    expect(html).toContain('href="#/domain/A2"');
    expect(html).not.toContain(marked['md.feature.area'].replace('{area}', ''));
  });

  it('every text of the fallback pages comes from the ui table', () => {
    for (const hash of ['#/', '#/domain/A1', '#/feature/F2']) expect(unmarked(render(data, hash)), hash).toEqual([]);
  });

  function railOf(html: string): string {
    return html.slice(html.indexOf('<nav class="rail"'), html.indexOf('</nav>', html.indexOf('<nav class="rail"')));
  }
});

// O6 of openspec change handbook-deep-entry (design D11): the rail has two levels, a group name and its links, all
// shown, none folding or numbered: the system, (technical) the applications, the business domains, (technical) the
// external systems, the cross-cutting pages, health and findings, and the appendix. No feature is in the rail; on a
// feature page the link of its domain is marked as the current place.
describe('the rail is two levels: groups and their links', () => {
  const product = dataFor(['product']);
  const both = dataFor(BOTH);
  const railOf = (html: string) => html.slice(html.indexOf('<nav class="rail"'), html.indexOf('</nav>', html.indexOf('<nav class="rail"')));
  const groupOf = (rail: string, name: string) => {
    const start = rail.indexOf(`data-group="${name}"`);
    return start < 0 ? '' : rail.slice(start, rail.indexOf('</section>', start));
  };
  const order = (rail: string) => Array.from(rail.matchAll(/data-group="([a-z]+)"/g), (match) => match[1]);

  it('has the groups in order, each named from the ui table', () => {
    const rail = railOf(render(product, '#/'));
    expect(order(rail)).toEqual(['system', 'domains', 'topics', 'health', 'appendix']);
    for (const name of order(rail)) expect(groupOf(rail, name), name).toContain(`<h2 class="rail-group-name" id="rail-group-${name}">${marked[`page.nav.group.${name}`]}</h2>`);
    expect(order(railOf(render(both, '#/technical')))).toEqual(['system', 'applications', 'domains', 'systems', 'topics', 'health', 'appendix']);
  });

  it('puts each page link in its group, and the three technical pages in the system group of the technical view', () => {
    const rail = railOf(render(product, '#/'));
    for (const href of ['#/', '#/matrix/roles']) expect(groupOf(rail, 'system'), href).toContain(`href="${href}"`);
    for (const href of ['#/domain/D1', '#/domain/D2']) expect(groupOf(rail, 'domains'), href).toContain(`href="${href}"`);
    for (const href of ['#/notifications', '#/jobs', '#/topics']) expect(groupOf(rail, 'topics'), href).toContain(`href="${href}"`);
    for (const href of ['#/history', '#/findings', '#/recommendations', '#/open-questions']) expect(groupOf(rail, 'health'), href).toContain(`href="${href}"`);
    for (const href of ['#/glossary', '#/sources', '#/coverage']) expect(groupOf(rail, 'appendix'), href).toContain(`href="${href}"`);
    expect(groupOf(rail, 'system')).not.toContain('#/data');
    const technical = railOf(render(both, '#/technical'));
    for (const href of ['#/technical/matrix/applications', '#/technical/data', '#/technical/dictionaries']) expect(groupOf(technical, 'system'), href).toContain(`href="${href}"`);
    expect(groupOf(technical, 'systems')).toContain(`data-system="${SLACK}"`);
  });

  it('folds nothing, numbers nothing and lists no feature', () => {
    for (const rail of [railOf(render(product, '#/feature/F3')), railOf(render(both, '#/technical/feature/F3'))]) {
      expect(rail).not.toContain('<details');
      expect(rail).not.toContain('/feature/');
      expect(rail).not.toContain('rail-key');
      expect(rail).not.toContain('rail-count');
    }
  });

  it('marks the current page, and on a feature page the link of its domain', () => {
    expect(railOf(render(product, '#/findings'))).toContain('<a class="rail-link" href="#/findings" aria-current="page">');
    expect(railOf(render(product, '#/domain/D2'))).toContain('<a class="rail-link" data-domain="D2" href="#/domain/D2" aria-current="page">');
    const onFeature = railOf(render(product, '#/feature/F3'));
    expect(onFeature).toContain('<a class="rail-link" data-domain="D2" href="#/domain/D2" aria-current="true">');
    expect(onFeature.match(/aria-current=/g)).toHaveLength(1);
  });

  it('every text of the rail comes from the ui table', () => {
    for (const hash of ['#/', '#/feature/F3', '#/findings']) expect(unmarked(railOf(render(product, hash))), hash).toEqual([]);
    for (const hash of ['#/technical', '#/technical/feature/F3']) expect(unmarked(railOf(render(both, hash))), hash).toEqual([]);
  });
});

describe('the domain page has the sections of the reference handbook (handbook-domain-page D2)', () => {
  /** D1 holds F1 (menu, verified) and F2 (made automatic here); its relations, states, findings, hotspots, cited files and tables are set here. */
  const withDomain = (views: View[]): PageData => {
    const data = dataFor(views);
    data.features[1] = { ...data.features[1], reach: 'automated' };
    data.entities.domains[0] = {
      ...data.entities.domains[0],
      relations: [
        { direction: 'out', domain: 'D2', from: 'F1', to: 'F3', text: d('hands the order on') },
        { direction: 'in', domain: 'D2', from: 'F3', to: 'F1', text: d('sends it back') },
      ],
      states: [{ feature: 'F1', label: d('Draft'), meaning: d('not sent yet') }],
      transitions: [{ feature: 'F1', from: d('Draft'), to: d('Sent'), by: d('the clerk sends it') }],
    };
    const owner = (id: string) => ({ kind: 'feature' as const, id, name: d(`name ${id}`) });
    data.findings = [
      { category: 'calculation', owners: [owner('F1')], items: [{ id: 'F1.findings[0]', owner: owner('F1'), text: d('finding of one') }], priority: { level: 'P1', consequence: 'wrongResult', reason: d('wrong total') } },
      { category: 'display', owners: [owner('F3')], items: [{ id: 'F3.findings[0]', owner: owner('F3'), text: d('finding of three') }], priority: null },
    ];
    const hot = (name: string, features: string[]) => ({ name: d(name), app: SVC, commits: 7, authors: 2, lines: 50, last: d('2024-05-01'), uncertain: 0, features });
    data.history = { ...NO_HISTORY, state: 'ok', hotspots: [hot('a.js', ['F1']), hot('z.js', ['F3'])] } as PageData['history'];
    if (data.technical !== undefined) {
      data.technical.history = { hotspots: [d('src/a.js'), d('src/z.js')], coChange: [] };
      data.technical.domainFiles = [{ domain: 'D1', files: [{ file: d('src/a.js'), citations: 3 }, { file: d('src/b.js'), citations: 1 }] }, { domain: 'D2', files: [] }];
      const table = (name: string, file: string) => ({ name: d(name), sources: [], createdBy: null, lastChangedBy: null, mentions: { [SVC]: [{ file: d(file), line: 1, rule: 'a' as const }] } });
      data.technical.data = { tables: [table('orders', 'src/b.js'), table('audit', 'src/q.js')] } as unknown as NonNullable<NonNullable<PageData['technical']>['data']>;
      data.technical.dataState = 'ok';
    }
    return data;
  };
  const mainOf = (html: string) => html.slice(html.indexOf('<main'));
  const sectionOf = (html: string, part: string) => {
    const start = html.indexOf(`data-part="${part}"`);
    return start < 0 ? '' : html.slice(start, html.indexOf('</section>', start));
  };
  const technical = mainOf(render(withDomain(BOTH), '#/technical/domain/D1'));
  const product = mainOf(render(withDomain(BOTH), '#/product/domain/D1'));

  it('puts the sections in the order of the reference handbook, the code only in the technical view', () => {
    const order = ['domain-does', 'domain-features', 'domain-states', 'domain-code', 'domain-relations', 'domain-findings'];
    const at = order.map((part) => technical.indexOf(`data-part="${part}"`));
    expect(at.every((position) => position > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(product).not.toContain('data-part="domain-code"');
    for (const part of order.filter((name) => name !== 'domain-code')) expect(product).toContain(`data-part="${part}"`);
  });

  it('groups the features by how readers reach them, with a count per group', () => {
    const features = sectionOf(technical, 'domain-features');
    expect(features).toContain(`${MARK}Menu (1)`);
    expect(features).toContain(`${MARK}Automatic (1)`);
    expect(features.indexOf('href="#/technical/feature/F1"')).toBeLessThan(features.indexOf('href="#/technical/feature/F2"'));
  });

  it('lists the states and transitions by feature', () => {
    const states = sectionOf(technical, 'domain-states');
    expect(states).toContain('href="#/technical/feature/F1"');
    expect(decode(states)).toContain(`${MARK}${d('Draft')}: ${d('not sent yet')}`);
    expect(decode(states)).toContain(`${MARK}${d('Draft')} to ${d('Sent')}: ${d('the clerk sends it')}`);
  });

  it('shows where the code is: the hotspots of its features, the files its entries quote, and the tables named in those files', () => {
    const code = decode(sectionOf(technical, 'domain-code'));
    expect(code).toContain(d('src/a.js'));
    expect(code).not.toContain(d('src/z.js'));
    expect(code).toContain(`${MARK}${d('src/b.js')}: 1 passages`);
    expect(code).toContain(d('orders'));
    expect(code).not.toContain(d('audit'));
    expect(code).toContain(marked['page.domain.tablesNote']);
  });

  it('lists the relations on two sides, each linking both features and the other domain', () => {
    const relations = sectionOf(technical, 'domain-relations');
    const gives = relations.slice(relations.indexOf(marked['md.entities.domain.gives']), relations.indexOf(marked['md.entities.domain.gets']));
    const gets = relations.slice(relations.indexOf(marked['md.entities.domain.gets']));
    expect(gives).toContain('href="#/technical/feature/F3"');
    expect(decode(gives)).toContain(d('hands the order on'));
    expect(gives).toContain('href="#/technical/domain/D2"');
    expect(decode(gets)).toContain(d('sends it back'));
    expect(decode(gives)).not.toContain(d('sends it back'));
  });

  it('lists only the findings of its own features, and links the findings page', () => {
    const findings = decode(sectionOf(technical, 'domain-findings'));
    expect(findings).toContain(d('finding of one'));
    expect(findings).not.toContain(d('finding of three'));
    expect(findings).toContain('href="#/technical/findings"');
  });

  it('writes none for an empty section, and every text comes from the ui table or the data', () => {
    const empty = mainOf(render(dataFor(BOTH), '#/technical/domain/D2'));
    for (const part of ['domain-states', 'domain-relations', 'domain-findings']) expect(sectionOf(empty, part)).toContain(marked['md.none']);
    for (const html of [technical, product, empty]) expect(unmarked(html)).toEqual([]);
  });
});

describe('the overview draws the business flow between domains and the technical structure (handbook-domain-page D4, D5)', () => {
  const withFlows = (views: View[]): PageData => {
    const data = dataFor(views);
    data.entities.domainFlows = [{ from: 'D1', to: 'D2', count: 3 }];
    return data;
  };
  const partOf = (html: string, part: string) => {
    const start = html.indexOf(`data-part="${part}"`);
    return start < 0 ? '' : html.slice(start, html.indexOf('</section>', start));
  };

  it('draws a node for each domain with a flow, linking its page, and an edge labelled with the count', () => {
    const flow = partOf(render(withFlows(BOTH), '#/product'), 'overview-flow');
    expect(flow).toContain(marked['md.entities.domains.flowHeading']);
    expect(flow).toContain('href="#/product/domain/D1"');
    expect(flow).toContain('href="#/product/domain/D2"');
    expect(flow).toContain('data-edge="D1 D2"');
    expect(flow).toContain('>3<');
  });

  it('writes a fixed text and draws nothing when no handoff crosses domains', () => {
    const flow = partOf(render(dataFor(BOTH), '#/product'), 'overview-flow');
    expect(flow).toContain(marked['md.entities.domains.flowNone']);
    expect(flow).not.toContain('<svg');
  });

  it('draws the applications and the systems they are shown calling, only in the technical view', () => {
    expect(render(withFlows(BOTH), '#/product')).not.toContain('data-part="overview-architecture"');
    const architecture = partOf(render(withFlows(BOTH), '#/technical'), 'overview-architecture');
    expect(architecture).toContain(marked['md.entities.systems.diagramHeading']);
    expect(architecture).toContain(`href="#/technical/application/${enc(SVC)}"`);
    expect(architecture).toContain(`href="#/technical/system/${enc(SLACK)}"`);
  });

  it('takes every text from the ui table or the data', () => {
    for (const hash of ['#/product', '#/technical']) expect(unmarked(render(withFlows(BOTH), hash)), hash).toEqual([]);
  });
});
