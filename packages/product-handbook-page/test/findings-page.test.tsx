// O2 (page) of openspec changes handbook-feature-findings and handbook-system-findings:
// the route #/findings in both views with a sidebar link, the counts (groups,
// statements, groups merged), the groups by category with their owners and the
// other statements collapsed, filterable by category and by owner (a feature, or
// "System" for the application roots), the file and lines of each statement in
// the technical view only, the feature page listing its own findings, the
// coverage page listing the units (features and application roots) not
// verified and the removed findings, and every fixed text coming from the ui table.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AppView } from '../src/App';
import { countByCategory, filterGroups } from '../src/components/FindingsPage';
import { parseHash, routeHash } from '../src/lib/route';
import { FINDING_CATEGORIES, findingCategoryKey } from '../src/lib/types';
import type { Feature, FindingCategory, FindingGroup, FindingOwner, PageData, View } from '../src/lib/types';
import { switchTarget } from '../src/lib/views';

const MARK = '@@';
const DATA = 'd~';
const shipped = JSON.parse(readFileSync(fileURLToPath(new URL('../../../skills/excavator-product-handbook/ui-strings.json', import.meta.url)), 'utf-8')) as { strings: Record<string, string> };
const marked = Object.fromEntries(Object.entries(shipped.strings).map(([key, value]) => [key, `${MARK}${value}`]));
const d = (text: string): string => `${DATA}${text}`;

const feature = (id: string, status: Feature['status'], findingsStatus: Feature['findingsStatus']): Feature => ({
  id, name: d(`name ${id}`), area: 'A1', domain: 'D1', reach: 'menu', status, entry: null, findingsStatus,
});

const owner = (id: string): FindingOwner => (id.startsWith('app') ? { kind: 'application', id, name: d(id === 'app1' ? 'backend' : 'web') } : { kind: 'feature', id, name: d(`name ${id}`) });
const item = (id: string, who: string, text: string) => ({ id, owner: owner(who), text: d(text) });

/** Four groups: F1 and F3 merged (authorization), F1 alone (hard-coded), the application app1 alone (notification), F3 and app1 merged (time). */
const FINDINGS: FindingGroup[] = [
  { category: 'authorization', owners: [owner('F1'), owner('F3')], items: [item('F1.findings[0]', 'F1', 'first statement'), item('F3.findings[0]', 'F3', 'third statement')] },
  { category: 'hard-coded', owners: [owner('F1')], items: [item('F1.findings[1]', 'F1', 'second statement')] },
  { category: 'notification', owners: [owner('app1')], items: [item('app1.system[0]', 'app1', 'system statement')] },
  { category: 'time', owners: [owner('F3'), owner('app1')], items: [item('F3.findings[1]', 'F3', 'fourth statement'), item('app1.system[1]', 'app1', 'fifth statement')] },
];

/** F1 and F3 have verified findings, F2 verified with none, F4 failed, F5 planned; one finding of F1 was removed. */
function dataFor(views: View[], findings: FindingGroup[] = FINDINGS): PageData {
  return {
    format: 'excavator-product-handbook-page/10',
    project: d('project'),
    language: d('language'),
    languageTag: 'xx',
    ui: { strings: marked },
    views,
    areas: [{ id: 'A1', name: d('area') }],
    domains: [{ id: 'D1', name: d('domain') }],
    domainBasis: 'domains',
    features: [feature('F1', 'planned', 'verified'), feature('F2', 'planned', 'verified'), feature('F3', 'planned', 'verified'), feature('F4', 'planned', 'failed'), feature('F5', 'planned', 'planned')],
    findings,
    coverage: {
      candidateTotal: 0, assigned: 0, unassigned: [], reachCounts: [], removedOverview: [], removed: [],
      findingsUnfinished: [{ feature: 'F4', status: 'failed' }],
      findingsNotWritten: 1,
      findingsRemoved: [{ feature: 'F1', items: [{ claim: d('removed claim'), verdict: 'contradicted', reason: d('removed reason') }] }],
      systemFindingsTotal: 3,
      systemFindingsUnfinished: [{ id: 'app2', name: d('web'), status: 'failed' }],
      systemFindingsNotWritten: 1,
      systemFindingsRemoved: [{ id: 'app1', name: d('backend'), items: [{ claim: d('system removed claim'), verdict: 'unverified', reason: d('system removed reason') }] }],
    },
    summary: { notifications: [], jobs: [], counts: { featureTotal: 5, featuresWithEntry: 1, notificationRows: 0, jobRows: 0, schedule: { literal: 0, computed: 0, absent: 0 }, described: 0 } },
    system: { status: 'planned', overview: null, applications: [], counts: { applications: 0, files: 0, lines: 0, areas: 1, domains: 1, features: 5, featuresWithEntry: 1, roles: 0 }, areas: [], domains: [] },
    entities: { domains: [{ id: 'D1', name: d('domain'), features: [], purposes: [] }], roles: [], roleFeature: { roles: [], features: [], cells: [] } },
    ...(views.includes('technical') ? {
      technical: {
        featureApplication: [], unattributed: [], applicationDomain: { applications: [], domains: [], cells: [], unattributed: [] },
        integrations: [], jobs: [], locations: [],
        findingLocations: [
          { id: 'F1.findings[0]', citations: [{ file: d('src/one.js'), startLine: 7, endLine: 7 }] },
          { id: 'F1.findings[1]', citations: [{ file: d('src/two.js'), startLine: 5, endLine: 9 }, { file: d('src/three.js'), startLine: null, endLine: null }] },
          { id: 'F3.findings[0]', citations: [{ file: d('src/four.js'), startLine: 4, endLine: 4 }] },
          { id: 'app1.system[0]', citations: [{ file: d('src/five.js'), startLine: 1, endLine: 2 }] },
          { id: 'F3.findings[1]', citations: [{ file: d('src/six.js'), startLine: 10, endLine: 10 }] },
          { id: 'app1.system[1]', citations: [{ file: d('src/seven.js'), startLine: 11, endLine: 12 }] },
        ],
        data: null, dataState: 'missing' as const, dictionaries: null, dictionariesState: 'missing' as const,
      },
    } : {}),
  };
}

const BOTH: View[] = ['product', 'technical'];
const render = (data: PageData, hash: string): string => renderToStaticMarkup(<AppView data={data} route={parseHash(hash)} />);
const decode = (text: string): string => text.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function visibleTexts(html: string): string[] {
  const nodes = html.split(/<[^>]*>/).map((text) => decode(text).trim()).filter((text) => text !== '');
  const attributes = Array.from(html.matchAll(/\s(?:aria-label|title|alt|placeholder|aria-description)="([^"]*)"/g), (match) => decode(match[1]).trim());
  return [...nodes, ...attributes];
}
const unmarked = (html: string): string[] => visibleTexts(html).filter((text) => !text.includes(MARK) && !(text.startsWith(DATA) && !text.includes('@')) && !/^\d+$/.test(text));
const main = (html: string): string => html.slice(html.indexOf('<main'));
const railOf = (html: string) => html.slice(html.indexOf('<nav class="rail"'), html.indexOf('</nav>', html.indexOf('<nav class="rail"')));
const name = (key: FindingCategory): string => marked[findingCategoryKey(key)];

describe('the findings route and link', () => {
  it('parses #/findings with and without the view and builds it back', () => {
    expect(parseHash('#/findings')).toEqual({ name: 'findings' });
    expect(parseHash('#/technical/findings')).toEqual({ name: 'findings', view: 'technical' });
    expect(parseHash('#/product/findings/x').name).toBe('not-found');
    expect(routeHash({ name: 'findings' }, null)).toBe('#/findings');
    expect(routeHash({ name: 'findings' }, 'technical')).toBe('#/technical/findings');
  });

  it('both views have the sidebar link, between the tables and the coverage page, and the page', () => {
    const data = dataFor(BOTH);
    for (const view of BOTH) {
      const html = render(data, `#/${view}`);
      const rail = railOf(html);
      expect(rail).toContain(`href="#/${view}/findings"`);
      expect(rail.indexOf(`href="#/${view}/findings"`)).toBeGreaterThan(rail.indexOf(`href="#/${view}/jobs"`));
      expect(rail.indexOf(`href="#/${view}/findings"`)).toBeLessThan(rail.indexOf(`href="#/${view}/coverage"`));
      expect(render(data, `#/${view}/findings`)).toContain('data-view="findings"');
    }
    expect(render(dataFor(['product']), '#/findings')).toContain('data-view="findings"');
    expect(switchTarget(data, parseHash('#/technical/findings'), 'product')).toBe('#/product/findings');
  });
});

describe('the findings page', () => {
  it('shows the counts line (groups, statements, groups merged), the groups in the order of the categories and each group with its owners and its first statement', () => {
    const body = main(render(dataFor(['product']), '#/findings'));
    const counted = (key: string): number => (['authorization', 'notification', 'hard-coded', 'time'].includes(key) ? 1 : 0);
    expect(body).toContain(`${MARK}Findings: 4. Statements: 6. Groups merged: 2. Findings units verified: 3 of 5. System findings units verified: 1 of 3. By category: ${FINDING_CATEGORIES.map((key) => `${MARK}${name(key)}: ${counted(key)}`).join('; ')}.`);
    expect([...body.matchAll(/data-category="([a-z-]+)"/g)].map((match) => match[1])).toEqual(['authorization', 'notification', 'hard-coded', 'time']);
    for (const text of ['first statement', 'second statement', 'system statement', 'fourth statement']) expect(body).toContain(d(text));
    expect(body).toContain(`${MARK}F1 ${d('name F1')}`);
    expect(body).toContain(`${MARK}${d('backend')} (application)`);
    expect(body).toContain(marked['md.findings.note']);
    expect((body.match(/<tbody>[\s\S]*?<\/tbody>/g) ?? []).map((part) => (part.match(/<tr[ >]/g) ?? []).length)).toEqual([1, 1, 1, 1]);
  });

  it('a merged group lists every owner and keeps its other statements under a details element, each with its owner; a single finding has none', () => {
    const body = main(render(dataFor(['product']), '#/findings'));
    const rows = body.match(/<tr data-group="[a-z]+">[\s\S]*?<\/tr>/g) ?? [];
    expect(rows).toHaveLength(4);
    const authorization = rows.find((row) => row.includes(d('first statement'))) ?? '';
    expect(authorization).toContain('data-group="merged"');
    expect(authorization).toContain(`${MARK}F1 ${d('name F1')}`);
    expect(authorization).toContain(`${MARK}F3 ${d('name F3')}`);
    expect(authorization).toContain('<details');
    expect(authorization).toContain(`${MARK}Other statements of this finding: 1`);
    const details = authorization.slice(authorization.indexOf('<details'));
    expect(details).toContain(`${MARK}F3 ${d('name F3')}: ${d('third statement')}`);
    expect(authorization.slice(0, authorization.indexOf('<details'))).not.toContain(d('third statement'));
    const time = rows.find((row) => row.includes(d('fourth statement'))) ?? '';
    expect(time.slice(time.indexOf('<details'))).toContain(`${MARK}${d('backend')} (application): ${d('fifth statement')}`);
    const single = rows.find((row) => row.includes(d('second statement'))) ?? '';
    expect(single).toContain('data-group="single"');
    expect(single).not.toContain('<details');
  });

  it('counts equal the length of the lists, and say so with the fixed text when there is no finding', () => {
    const list = dataFor(['product']).findings;
    expect(countByCategory(list).map((entry) => entry.count).reduce((sum, count) => sum + count, 0)).toBe(list.length);
    expect(countByCategory(list).map((entry) => entry.category)).toEqual([...FINDING_CATEGORIES]);
    const empty = main(render(dataFor(['product'], []), '#/findings'));
    expect(empty).toContain(marked['md.findings.none']);
    expect(empty).not.toContain('<table');
    expect(empty).not.toContain('<select');
  });

  it('the technical view adds the file and lines of each statement, the others inside the details; the product view never carries a path', () => {
    const data = dataFor(BOTH);
    const technical = main(render(data, '#/technical/findings'));
    expect(technical).toContain(`<th scope="col">${marked['md.locations.heading']}</th>`);
    expect(technical).toContain(`${MARK}${d('src/one.js')}, line 7`);
    expect(technical).toContain(`${MARK}F3 ${d('name F3')}: ${d('third statement')} (${MARK}${d('src/four.js')}, line 4)`);
    expect(technical).toContain(`${MARK}${d('backend')} (application): ${d('fifth statement')} (${MARK}${d('src/seven.js')}, lines 11-12)`);
    expect(technical).toContain(`${MARK}${d('src/two.js')}, lines 5-9; ${MARK}${d('src/three.js')}, lines not located`);
    const product = render(data, '#/product/findings');
    for (const file of ['src/one.js', 'src/two.js', 'src/three.js', 'src/four.js', 'src/five.js', 'src/seven.js']) expect(product).not.toContain(file);
    expect(product).not.toContain(marked['md.locations.heading']);
  });

  it('has the category filter with every category and its count, and the owner filter with all owners, System and each feature that owns a group', () => {
    const html = render(dataFor(['product']), '#/findings');
    expect(html).toContain(marked['page.findings.filter.category']);
    expect(html).toContain(marked['page.findings.filter.all']);
    expect(html).toContain(marked['page.findings.filter.owner']);
    expect(html).toContain(marked['page.findings.filter.allOwners']);
    expect(html).toContain(`>${marked['page.findings.filter.system']}</option>`);
    const owners = html.slice(html.indexOf('data-part="findings-owner-filter"'));
    expect(owners.slice(0, owners.indexOf('</select>')).match(/<option/g)).toHaveLength(2 + 2);
    expect(owners).toContain(`${MARK}F1 ${d('name F1')}</option>`);
    expect(owners).toContain(`${MARK}F3 ${d('name F3')}</option>`);
    expect((html.slice(0, html.indexOf('data-part="findings-owner-filter"')).match(/<option/g) ?? []).length).toBe(1 + FINDING_CATEGORIES.length);
    expect(html).toContain(`${MARK}Showing 4 of 4 findings`);
  });

  it('filterGroups keeps the groups of a category, of an owner (System is every application owner), or both, and changes nothing it is given', () => {
    const list = dataFor(['product']).findings;
    const ids = (groups: FindingGroup[]): string[] => groups.map((group) => group.items[0].id);
    expect(filterGroups(list, null)).toEqual(list);
    expect(filterGroups(list, null)).not.toBe(list);
    expect(ids(filterGroups(list, 'authorization'))).toEqual(['F1.findings[0]']);
    expect(filterGroups(list, 'error-handling')).toEqual([]);
    expect(ids(filterGroups(list, null, 'system'))).toEqual(['app1.system[0]', 'F3.findings[1]']);
    expect(ids(filterGroups(list, null, 'feature:F3'))).toEqual(['F1.findings[0]', 'F3.findings[1]']);
    expect(ids(filterGroups(list, null, 'feature:F1'))).toEqual(['F1.findings[0]', 'F1.findings[1]']);
    expect(ids(filterGroups(list, 'time', 'system'))).toEqual(['F3.findings[1]']);
    expect(filterGroups(list, 'hard-coded', 'system')).toEqual([]);
    expect(filterGroups(list, null, 'feature:F9')).toEqual([]);
  });
});

describe('the feature page and the coverage page', () => {
  it('lists the findings of the feature with their category, also those in a merged group, and no statement of another owner', () => {
    const html = main(render(dataFor(['product']), '#/feature/F1'));
    expect(html).toContain(`${MARK}${name('authorization')}: ${d('first statement')}`);
    expect(html).toContain(`${MARK}${name('hard-coded')}: ${d('second statement')}`);
    expect(html).not.toContain(d('third statement'));
    expect(html).toContain(`id="sec-findings"`);
    const f3 = main(render(dataFor(['product']), '#/feature/F3'));
    expect(f3).toContain(`${MARK}${name('authorization')}: ${d('third statement')}`);
    expect(f3).toContain(`${MARK}${name('time')}: ${d('fourth statement')}`);
    expect(f3).not.toContain(d('fifth statement'));
    expect(f3).not.toContain(d('first statement'));
  });

  it('a feature with verified findings and no entry shows them under the notice; a verified unit with none says so; an unverified unit has no section', () => {
    expect(main(render(dataFor(['product']), '#/feature/F3'))).toContain(d('third statement'));
    expect(main(render(dataFor(['product']), '#/feature/F3'))).toContain(marked['page.feature.noEntry']);
    const none = main(render(dataFor(['product']), '#/feature/F2'));
    expect(none.slice(none.indexOf('id="sec-findings"'))).toContain(marked['md.none']);
    for (const id of ['F4', 'F5']) expect(main(render(dataFor(['product']), `#/feature/${id}`))).not.toContain('id="sec-findings"');
  });

  it('the coverage page lists the units that are not verified with where they stopped and the removed findings with their reasons', () => {
    const html = main(render(dataFor(['product']), '#/coverage'));
    const unfinished = html.slice(html.indexOf('id="cov-findings-unfinished"'), html.indexOf('id="cov-findings-removed"'));
    expect(unfinished).toContain(`${MARK}${d('name F4')} (F4, ${d('area')})`);
    expect(unfinished).toContain(`${MARK}Findings were not written for 1 features.`);
    expect(unfinished).not.toContain('name F5');
    // Two tables: the features (header and F4) and the application roots (header and the one not verified).
    expect((unfinished.match(/<tr>/g) ?? []).length).toBe(4);
    expect(unfinished).toContain(marked['md.status.failed']);
    expect(unfinished).not.toContain('name F1');
    const removed = html.slice(html.indexOf('id="cov-findings-removed"'));
    for (const text of ['removed claim', 'removed reason']) expect(removed).toContain(d(text));
    expect(removed).toContain(marked['md.verdict.contradicted']);
    expect(removed).toContain(`${MARK}F1 ${d('name F1')} (${d('area')}): findings removed: 1`);
  });

  it('the coverage page lists the application roots whose system findings are not verified, the roots never written as one count, and the removed system findings', () => {
    const html = main(render(dataFor(['product']), '#/coverage'));
    const unfinished = html.slice(html.indexOf('id="cov-findings-unfinished"'), html.indexOf('id="cov-findings-removed"'));
    expect(unfinished).toContain(`${MARK}The system findings of 1 application roots were not written.`);
    expect(unfinished).toContain(`${MARK}${d('web')} (application)`);
    expect(unfinished.match(/<tr>/g)).toHaveLength(2 + 2);
    const removed = html.slice(html.indexOf('id="cov-findings-removed"'));
    expect(removed).toContain(`${MARK}${d('backend')} (application): findings removed: 1`);
    for (const text of ['system removed claim', 'system removed reason']) expect(removed).toContain(d(text));
    const done = dataFor(['product']);
    done.coverage.systemFindingsUnfinished = [];
    done.coverage.systemFindingsNotWritten = 0;
    done.coverage.systemFindingsRemoved = [];
    const clean = main(render(done, '#/coverage'));
    expect(clean).toContain(marked['md.coverage.systemFindingsAllVerified']);
    expect(clean).not.toContain('system-findings-not-written');
    expect(unmarked(render(done, '#/coverage'))).toEqual([]);
  });
});

describe('every fixed text of the findings pages comes from the ui table', () => {
  const data = dataFor(BOTH);
  const pages: [string, string][] = [
    ['the findings page, product view', '#/product/findings'],
    ['the findings page, technical view', '#/technical/findings'],
    ['a feature with findings', '#/product/feature/F1'],
    ['a feature with verified findings and no entry, technical view', '#/technical/feature/F3'],
    ['the coverage page', '#/product/coverage'],
  ];
  for (const [label, hash] of pages) {
    it(`${label}: no text without the marker or the data prefix`, () => {
      expect(unmarked(render(data, hash))).toEqual([]);
    });
  }

  it('shows one count line and no table when every findings unit is planned, and nothing of the sort when all are verified', () => {
    const planned = dataFor(['product']);
    planned.coverage.findingsUnfinished = [];
    planned.coverage.findingsNotWritten = 5;
    planned.coverage.systemFindingsUnfinished = [];
    planned.coverage.systemFindingsNotWritten = 0;
    planned.coverage.systemFindingsRemoved = [];
    planned.coverage.systemFindingsTotal = 0;
    const html = render(planned, '#/coverage');
    const part = html.slice(html.indexOf('id="cov-findings-unfinished"'), html.indexOf('id="cov-findings-removed"'));
    expect(part).toContain(`${MARK}Findings were not written for 5 features.`);
    expect(part).not.toContain('<table');
    expect(unmarked(html)).toEqual([]);
    planned.coverage.findingsNotWritten = 0;
    const done = render(planned, '#/coverage');
    expect(done).toContain(marked['md.coverage.findingsAllVerified']);
    expect(done).not.toContain('findings-not-written');
  });

  it('the page without a finding', () => {
    expect(unmarked(render(dataFor(['product'], []), '#/findings'))).toEqual([]);
  });

  it('has no apostrophe in a fixed text of the findings, since the page escapes it', () => {
    // The word lists are matched by scripts and shown nowhere; they may hold won't and can't.
    const matched = ['md.findings.adviceWords', 'md.findings.scopeWords'];
    for (const [key, value] of Object.entries(shipped.strings)) if ((key.startsWith('md.findings.') || key.startsWith('page.findings.') || key === 'page.nav.findings') && !matched.includes(key)) expect(value, key).not.toContain("'");
  });
});
