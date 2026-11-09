// @vitest-environment happy-dom
// O2 (page) of openspec changes handbook-feature-findings and handbook-system-findings:
// the route #/findings in both views with a sidebar link, the counts (groups,
// statements, groups merged), the groups by category with their owners and the
// other statements collapsed, filterable by category and by owner (a feature, or
// "System" for the application roots), the file and lines of each statement in
// the technical view only, the feature page listing its own findings, the
// coverage page listing the units (features and application roots) not
// verified and the removed findings, and every fixed text coming from the ui table.
// O2 of handbook-findings-priority: each group has its level and reason (or the word for none), the counts
// and each category heading say how many groups have which level, the findings page filters by level, the
// feature page shows the levels and the coverage page lists the groups without a priority.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';

import { AppView } from '../src/App';
import { countByCategory, countByLevel, filterGroups } from '../src/components/FindingsPage';
import { parseHash, routeHash } from '../src/lib/route';
import { FINDING_CATEGORIES, findingCategoryKey } from '../src/lib/types';
import type { Feature, FindingCategory, FindingGroup, FindingOwner, PageData, Priority, Remedies, View } from '../src/lib/types';
import { switchTarget } from '../src/lib/views';
import { choose, cleanup, mount, moveAndConfirm, openWithKeyboard, optionTexts, pressActive, selectByLabel, status } from './dom';
import { NO_APPENDIX, NO_HISTORY } from './empty-parts';

const MARK = '@@';
const DATA = 'd~';
const shipped = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../skills/excavator-product-handbook/ui-strings.json'), 'utf-8')) as { strings: Record<string, string> };
const marked = Object.fromEntries(Object.entries(shipped.strings).map(([key, value]) => [key, `${MARK}${value}`]));
const d = (text: string): string => `${DATA}${text}`;

const feature = (id: string, status: Feature['status'], findingsStatus: Feature['findingsStatus']): Feature => ({
  id, name: d(`name ${id}`), area: 'A1', domain: 'D1', reach: 'menu', status, entry: null, findingsStatus,
});

const owner = (id: string): FindingOwner => (id.startsWith('app') ? { kind: 'application', id, name: d(id === 'app1' ? 'backend' : 'web') } : { kind: 'feature', id, name: d(`name ${id}`) });
const item = (id: string, who: string, text: string) => ({ id, owner: owner(who), text: d(text) });

const priority = (level: Priority['level'], consequence: Priority['consequence'], reason: string): Priority => ({ level, consequence, reason: d(reason) });

/**
 * Four groups: F1 and F3 merged (authorization, P0), F1 alone (hard-coded, P2), the application app1 alone (notification, no priority),
 * F3 and app1 merged (time, P1).
 */
const FINDINGS: FindingGroup[] = [
  { category: 'authorization', owners: [owner('F1'), owner('F3')], items: [item('F1.findings[0]', 'F1', 'first statement'), item('F3.findings[0]', 'F3', 'third statement')], priority: priority('P0', 'othersRecords', 'reason one') },
  { category: 'hard-coded', owners: [owner('F1')], items: [item('F1.findings[1]', 'F1', 'second statement')], priority: priority('P2', 'display', 'reason two') },
  { category: 'notification', owners: [owner('app1')], items: [item('app1.system[0]', 'app1', 'system statement')], priority: null },
  { category: 'time', owners: [owner('F3'), owner('app1')], items: [item('F3.findings[1]', 'F3', 'fourth statement'), item('app1.system[1]', 'app1', 'fifth statement')], priority: priority('P1', 'wrongResult', 'reason four') },
];

/** F1 and F3 have verified findings, F2 verified with none, F4 failed, F5 planned; one finding of F1 was removed. */
function dataFor(views: View[], findings: FindingGroup[] = FINDINGS, remedies: Remedies = { categories: [], recommendations: [] }, remediesCoverage: PageData['coverage']['remedies'] = { finished: true, stale: false, dropped: [] }): PageData {
  return {
    format: 'excavator-product-handbook-page/14',
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
    remedies,
    topics: { approval: [], time: [], handoffs: [], access: [], repeated: [] },
    history: NO_HISTORY,
    appendix: NO_APPENDIX,
    coverage: {
      candidateTotal: 0, assigned: 0, unassigned: [], reachCounts: [], removedOverview: [], removed: [],
      findingsUnfinished: [{ feature: 'F4', status: 'failed' }],
      findingsNotWritten: 1,
      findingsRemoved: [{ feature: 'F1', items: [{ claim: d('removed claim'), verdict: 'contradicted', reason: d('removed reason') }] }],
      systemFindingsTotal: 3,
      systemFindingsUnfinished: [{ id: 'app2', name: d('web'), status: 'failed' }],
      systemFindingsNotWritten: 1,
      systemFindingsRemoved: [{ id: 'app1', name: d('backend'), items: [{ claim: d('system removed claim'), verdict: 'unverified', reason: d('system removed reason') }] }],
      priority: { finished: true, unranked: [{ id: 'app1.system[0]', category: 'notification', text: d('system statement'), reasons: [d('judge reason')] }] },
      remedies: remediesCoverage,
      topics: { finished: true, stale: false, entriesRead: 0, groupsRead: 0, lanes: [], dropped: [] },
    },
    summary: { notifications: [], jobs: [], counts: { featureTotal: 5, featuresWithEntry: 1, notificationRows: 0, jobRows: 0, schedule: { literal: 0, computed: 0, absent: 0 }, described: 0 } },
    system: { status: 'planned', overview: null, applications: [], counts: { applications: 0, files: 0, lines: 0, areas: 1, domains: 1, features: 5, featuresWithEntry: 1, roles: 0 }, areas: [], domains: [] },
    entities: { domains: [{ id: 'D1', name: d('domain'), features: [], purposes: [] }], roles: [], roleFeature: { roles: [], features: [], cells: [] } },
    ...(views.includes('technical') ? {
      technical: {
        featureApplication: [], unattributed: [], applicationDomain: { applications: [], domains: [], cells: [], unattributed: [] },
        integrations: [], jobs: [], locations: [], topicLocations: [], history: { hotspots: [], coChange: [] },
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
  const nodes = html.replace(/<wbr\/>/g, '').split(/<[^>]*>/).map((text) => decode(text).trim()).filter((text) => text !== '');
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
  it('shows the count cards (groups, statements, groups merged), the groups in the order of the categories and each group with its owners and its first statement', () => {
    const body = main(render(dataFor(['product']), '#/findings'));
    expect(body).toContain('data-part="findings-stats"');
    expect(body).not.toContain('class="summary-counts"');
    expect(body).toContain(`<dt>${marked['page.stat.findings']}</dt><dd>4</dd>`);
    expect(body).toContain(`<dt>${marked['page.stat.statements']}</dt><dd>6</dd>`);
    expect(body).toContain(`<dt>${marked['page.stat.merged']}</dt><dd>2</dd>`);
    expect(body).toContain(`<dt>${marked['page.stat.featuresVerified']}</dt><dd>${MARK}3 of 5</dd>`);
    expect(body).toContain(`<dt>${marked['page.stat.systemVerified']}</dt><dd>${MARK}1 of 3</dd>`);
    expect([...body.matchAll(/data-category="([a-z-]+)"/g)].map((match) => match[1])).toEqual(['authorization', 'notification', 'hard-coded', 'time']);
    for (const text of ['first statement', 'second statement', 'system statement', 'fourth statement']) expect(body).toContain(d(text));
    expect(body).toContain(`${MARK}F1 ${d('name F1')}`);
    expect(body).toContain(`${MARK}${d('backend')} (application)`);
    expect(body).toContain(marked['md.findings.note']);
    expect((body.match(/<tbody>[\s\S]*?<\/tbody>/g) ?? []).map((part) => (part.match(/<tr[ >]/g) ?? []).length)).toEqual([1, 1, 1, 1]);
  });

  it('a merged group lists every owner and keeps its other statements under a details element, each with its owner; a single finding has none', () => {
    const body = main(render(dataFor(['product']), '#/findings'));
    const rows = body.match(/<tr data-group="[a-z]+" data-level="[A-Za-z0-9]+">[\s\S]*?<\/tr>/g) ?? [];
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
    expect(technical).toContain(`<code class="loc-chip">${d('src/')}<wbr/>one.js:7</code>`);
    expect(technical).toContain(`${MARK}${MARK}F3 ${d('name F3')}: ${d('third statement')}<span class="loc-chips" data-part="location-chips"><code class="loc-chip">${d('src/')}<wbr/>four.js:4</code>`);
    expect(technical).toContain(`${MARK}${MARK}${d('backend')} (application): ${d('fifth statement')}<span class="loc-chips" data-part="location-chips"><code class="loc-chip">${d('src/')}<wbr/>seven.js:11-12</code>`);
    expect(technical).toContain(`<code class="loc-chip">${d('src/')}<wbr/>two.js:5-9</code>`);
    expect(technical).toContain(`${MARK}${d('src/three.js')}, lines not located</code>`);
    const product = render(data, '#/product/findings');
    for (const file of ['src/one.js', 'src/two.js', 'src/three.js', 'src/four.js', 'src/five.js', 'src/seven.js']) expect(product).not.toContain(file);
    expect(product).not.toContain(marked['md.locations.heading']);
  });

  it('shows the three filter labels and the status line before any interaction', () => {
    const html = render(dataFor(['product']), '#/findings');
    for (const key of ['page.findings.filter.category', 'page.findings.filter.level', 'page.findings.filter.owner']) expect(html).toContain(marked[key]);
    expect(html).toContain(`${MARK}Showing 4 of 4 findings`);
    expect(html).toContain('data-part="findings-toolbar"');
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

describe('the priority of each group (handbook-findings-priority)', () => {
  const rowOf = (body: string, statement: string): string => (body.match(/<tr data-group="[a-z]+" data-level="[A-Za-z0-9]+">[\s\S]*?<\/tr>/g) ?? []).find((row) => row.includes(d(statement))) ?? '';

  it('shows the level as a badge with the name of the consequence as its tooltip, and the reason under the statement; a group with no priority shows the word for none and no reason', () => {
    const body = main(render(dataFor(['product']), '#/findings'));
    const authorization = rowOf(body, 'first statement');
    expect(authorization).toContain('data-level="P0"');
    expect(authorization).toContain(`<span class="priority-badge" data-level="P0" title="${marked['md.priority.consequence.othersRecords']}">${MARK}P0</span>`);
    expect(authorization).toContain(`${MARK}Reason: ${d('reason one')}`);
    const none = rowOf(body, 'system statement');
    expect(none).toContain('data-level="none"');
    expect(none).toContain(`<span class="priority-badge" data-level="none">${marked['md.priority.unranked']}</span>`);
    expect(none).not.toContain('Reason:');
    expect(rowOf(body, 'second statement')).toContain('data-level="P2"');
    expect(rowOf(body, 'fourth statement')).toContain('data-level="P1"');
  });

  it('writes the number of groups and of P0 groups in the heading of each category', () => {
    const body = main(render(dataFor(['product']), '#/findings'));
    expect(body).toContain(`${MARK}${name('authorization')} (1 findings; P0: 1)`);
    expect(body).toContain(`${MARK}${name('hard-coded')} (1 findings; P0: 0)`);
    expect(body).toContain(`${MARK}${name('notification')} (1 findings; P0: 0)`);
  });

  it('filterGroups keeps the groups of a level, or the groups without a priority, together with the other filters, and countByLevel counts them', () => {
    const list = dataFor(['product']).findings;
    const ids = (groups: FindingGroup[]): string[] => groups.map((group) => group.items[0].id);
    expect(ids(filterGroups(list, null, 'all', 'P0'))).toEqual(['F1.findings[0]']);
    expect(ids(filterGroups(list, null, 'all', 'P1'))).toEqual(['F3.findings[1]']);
    expect(ids(filterGroups(list, null, 'all', 'P2'))).toEqual(['F1.findings[1]']);
    expect(ids(filterGroups(list, null, 'all', 'none'))).toEqual(['app1.system[0]']);
    expect(filterGroups(list, null, 'all', 'all')).toEqual(list);
    expect(filterGroups(list, 'time', 'all', 'P0')).toEqual([]);
    expect(ids(filterGroups(list, null, 'feature:F3', 'P1'))).toEqual(['F3.findings[1]']);
    expect(countByLevel(list)).toEqual([{ level: 'P0', count: 1 }, { level: 'P1', count: 1 }, { level: 'P2', count: 1 }, { level: 'none', count: 1 }]);
    expect(countByLevel(list).reduce((sum, entry) => sum + entry.count, 0)).toBe(list.length);
  });

  it('the feature page shows the level of each finding of the feature, and the word for none', () => {
    const f1 = main(render(dataFor(['product']), '#/feature/F1'));
    expect(f1).toContain(`${MARK}P0</span> ${MARK}${name('authorization')}: ${d('first statement')}`);
    expect(f1).toContain(`${MARK}P2</span> ${MARK}${name('hard-coded')}: ${d('second statement')}`);
    const f3 = main(render(dataFor(['product']), '#/feature/F3'));
    expect(f3).toContain(`${MARK}P1</span> ${MARK}${name('time')}: ${d('fourth statement')}`);
    const data = dataFor(['product'], structuredClone(FINDINGS));
    data.findings[1].priority = null;
    expect(main(render(data, '#/feature/F1'))).toContain(`${marked['md.priority.unranked']}</span> ${MARK}${name('hard-coded')}: ${d('second statement')}`);
  });

  it('the coverage page lists the groups without a priority with the reasons of the judges, and the fixed reason for a group no judge saw', () => {
    const data = dataFor(['product']);
    const html = main(render(data, '#/coverage'));
    const part = html.slice(html.indexOf('id="cov-priority"'));
    expect(part).toContain(marked['md.coverage.priorityHeading']);
    expect(part).toContain(`${MARK}Groups of findings without a priority: 1.`);
    expect(part).toContain(`${MARK}${name('notification')}: ${d('system statement')}`);
    expect(part).toContain(d('judge reason'));
    data.coverage.priority.unranked[0].reasons = [];
    expect(main(render(data, '#/coverage'))).toContain(marked['md.priority.notJudged']);
  });

  it('the coverage page says that the ranking did not finish, or that every group has a priority, or none when there is no finding', () => {
    const unfinished = dataFor(['product']);
    unfinished.coverage.priority = { finished: false, unranked: [] };
    expect(main(render(unfinished, '#/coverage'))).toContain(`${MARK}The ranking did not finish: 4 groups of findings have no priority.`);
    const all = dataFor(['product']);
    all.coverage.priority = { finished: true, unranked: [] };
    expect(main(render(all, '#/coverage'))).toContain(marked['md.coverage.priorityAllRanked']);
    const empty = dataFor(['product'], []);
    empty.coverage.priority = { finished: true, unranked: [] };
    const html = main(render(empty, '#/coverage'));
    expect(html.slice(html.indexOf('id="cov-priority"'))).toContain(marked['md.none']);
    for (const data of [unfinished, all, empty]) expect(unmarked(render(data, '#/coverage'))).toEqual([]);
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

// O2 (page) of openspec change handbook-remedies: the route #/recommendations in both views with a sidebar link after the findings,
// the common cause and the measure under each category of the findings page, the recommendations in order with the groups (level and
// statement) and the facts they rest on, the places of a statement in the technical view only, what the judges left out on the coverage page,
// and every fixed text coming from the ui table.
const REMEDIES: Remedies = {
  categories: [
    { category: 'authorization', cause: d('Nothing asks who calls.'), measure: d('Check the caller first.') },
    { category: 'time', cause: d('One fixed hour for all.'), measure: d('Read the hour of the recipient.') },
  ],
  recommendations: [
    {
      title: d('Check the caller'),
      text: d('Start with the finding of the highest level.'),
      groups: [{ id: 'F1.findings[0]', category: 'authorization', level: 'P0', text: d('first statement') }, { id: 'app1.system[0]', category: 'notification', level: null, text: d('system statement') }],
      facts: [
        { kind: 'counts', groups: 4, levels: { P0: 1, P1: 1, P2: 1, unranked: 1 }, categories: [{ category: 'authorization', count: 1 }, { category: 'time', count: 1 }] },
        { kind: 'app', name: d('backend'), language: d('Go'), files: 12, lines: 3400, commits: 50, authors: 3 },
      ],
    },
    {
      title: d('Share fewer tables'),
      text: d('Split the tables that several applications use.'),
      groups: [],
      facts: [
        { kind: 'tables', count: 2, tables: [{ name: d('orders'), applications: [d('backend'), d('web')] }, { name: d('carts'), applications: [d('backend'), d('web')] }] },
        { kind: 'app', name: d('web'), language: null, files: 0, lines: 0, commits: null, authors: null },
        { kind: 'tables', count: null, tables: [] },
      ],
    },
  ],
};
const DROPPED: PageData['coverage']['remedies'] = {
  finished: true,
  stale: false,
  dropped: [
    { id: 'category:time', kind: 'category', category: 'time', text: d('One fixed hour for all.'), reasons: [d('The cause is wider than one statement.')] },
    { id: 'recommendation:3', kind: 'recommendation', title: d('Third'), text: d('Third text.'), reasons: [d('No cited fact says three.')] },
  ],
};

describe('the recommendations route and link', () => {
  it('parses #/recommendations with and without the view and builds it back', () => {
    expect(parseHash('#/recommendations')).toEqual({ name: 'recommendations' });
    expect(parseHash('#/technical/recommendations')).toEqual({ name: 'recommendations', view: 'technical' });
    expect(parseHash('#/product/recommendations/x').name).toBe('not-found');
    expect(routeHash({ name: 'recommendations' }, null)).toBe('#/recommendations');
    expect(routeHash({ name: 'recommendations' }, 'technical')).toBe('#/technical/recommendations');
  });

  it('both views have the sidebar link right after the findings link and the page', () => {
    const data = dataFor(BOTH, FINDINGS, REMEDIES);
    for (const view of BOTH) {
      const rail = railOf(render(data, `#/${view}`));
      expect(rail.indexOf(`href="#/${view}/recommendations"`)).toBeGreaterThan(rail.indexOf(`href="#/${view}/findings"`));
      expect(rail.indexOf(`href="#/${view}/recommendations"`)).toBeLessThan(rail.indexOf(`href="#/${view}/coverage"`));
      expect(render(data, `#/${view}/recommendations`)).toContain('data-view="recommendations"');
    }
    expect(switchTarget(data, parseHash('#/technical/recommendations'), 'product')).toBe('#/product/recommendations');
  });
});

describe('the recommendations page', () => {
  it('lists the recommendations in order, each with its text, the groups it rests on (level and statement) and the facts in words', () => {
    const body = main(render(dataFor(['product'], FINDINGS, REMEDIES), '#/recommendations'));
    expect(body).toContain(`${MARK}Recommendations: 2. Groups of findings they rest on: 2 of 4.`);
    expect(body.indexOf(`${MARK}1. ${d('Check the caller')}`)).toBeGreaterThan(-1);
    expect(body.indexOf(`${MARK}2. ${d('Share fewer tables')}`)).toBeGreaterThan(body.indexOf(`${MARK}1. ${d('Check the caller')}`));
    expect(body).toContain(`${MARK}[${MARK}P0] ${name('authorization')}: ${d('first statement')}`);
    expect(body).toContain(`${MARK}[${MARK}Unranked] ${name('notification')}: ${d('system statement')}`);
    expect(body).toContain(`${MARK}Groups of findings: 4. By priority: ${MARK}${MARK}P0: 1; ${MARK}${MARK}P1: 1; ${MARK}${MARK}P2: 1; ${MARK}${MARK}Unranked: 1. By category: ${MARK}${name('authorization')}: 1; ${MARK}${name('time')}: 1.`);
    expect(body).toContain(`${MARK}Application ${d('backend')}: main language ${d('Go')}, 12 source files, 3400 lines, 50 commits by 3 authors.`);
    expect(body).toContain(`${MARK}Application ${d('web')}: main language ${MARK}none, 0 source files, 0 lines, no version history.`);
    expect(body).toContain(`${MARK}Tables mentioned by two or more applications: 2 (${MARK}${d('orders')} in ${d('backend')}, ${d('web')}; ${MARK}${d('carts')} in ${d('backend')}, ${d('web')}).`);
    expect(body).toContain(`${MARK}Tables mentioned by two or more applications: not known, the data section was not written.`);
  });

  it('writes no file or line in the product view and the file and line of each cited statement in the technical view', () => {
    const data = dataFor(BOTH, FINDINGS, REMEDIES);
    expect(main(render(data, '#/product/recommendations'))).not.toContain('src/one.js');
    expect(main(render(data, '#/technical/recommendations'))).toContain(`<code class="loc-chip">${d('src/')}<wbr/>one.js:7</code>`);
  });

  it('says there is no recommendation when none is left, and has no text of its own', () => {
    const body = main(render(dataFor(['product']), '#/recommendations'));
    expect(body).toContain(marked['md.remedies.none']);
    expect(unmarked(render(dataFor(['product']), '#/recommendations'))).toEqual([]);
  });

  it('shows no text that is not from the ui table or the data, in either view', () => {
    for (const hash of ['#/product/recommendations', '#/technical/recommendations', '#/technical/findings', '#/product/findings', '#/product/coverage', '#/technical/coverage']) {
      expect(unmarked(render(dataFor(BOTH, FINDINGS, REMEDIES, DROPPED), hash)), hash).toEqual([]);
    }
  });
});

describe('the findings page with remedies', () => {
  it('shows the common cause and the measure under the heading of a category that has them, and nothing under the others', () => {
    const body = main(render(dataFor(['product'], FINDINGS, REMEDIES), '#/findings'));
    const authorization = body.slice(body.indexOf('data-category="authorization"'), body.indexOf('data-category="hard-coded"'));
    expect(authorization).toContain(`${MARK}Common cause:</span> ${d('Nothing asks who calls.')}`);
    expect(authorization).toContain(`${MARK}Measure:</span> ${d('Check the caller first.')}`);
    expect(authorization.indexOf('Common cause')).toBeLessThan(authorization.indexOf('<table'));
    const hardCoded = body.slice(body.indexOf('data-category="hard-coded"'), body.indexOf('data-category="notification"'));
    expect(hardCoded).not.toContain('category-remedy');
    expect(body.match(/data-part="category-remedy"/g)).toHaveLength(2);
  });
});

describe('the coverage page about the remedies', () => {
  const part = (data: PageData): string => {
    const body = main(render(data, '#/coverage'));
    return body.slice(body.indexOf('id="cov-remedies"'));
  };

  it('lists what the judges left out with their reasons', () => {
    const text = part(dataFor(['product'], FINDINGS, REMEDIES, DROPPED));
    expect(text).toContain(`${MARK}Left out because a judge found a statement of how things are now that the cited findings and facts do not hold: 2.`);
    expect(text).toContain(`${name('time')}: ${d('One fixed hour for all.')}`);
    expect(text).toContain(d('The cause is wider than one statement.'));
    expect(text).toContain(`${d('Third')}: ${d('Third text.')}`);
    expect(text).toContain(d('No cited fact says three.'));
  });

  it('says that the remedies did not finish, that they were written for other findings, or that everything written is in the handbook', () => {
    expect(part(dataFor(['product'], FINDINGS, REMEDIES, { finished: false, stale: false, dropped: [] }))).toContain(marked['md.coverage.remediesNotFinished']);
    expect(part(dataFor(['product'], FINDINGS, REMEDIES, { finished: false, stale: true, dropped: [] }))).toContain(marked['md.coverage.remediesStale']);
    expect(part(dataFor(['product'], FINDINGS, REMEDIES))).toContain(marked['md.coverage.remediesAllKept']);
    expect(part(dataFor(['product'], []))).toContain(marked['md.none']);
  });
});


describe('the styled selects and the filter toolbar (handbook-page-layout)', () => {
  afterEach(cleanup);
  const page = (views: View[] = ['product']): HTMLElement => mount(<AppView data={dataFor(views, structuredClone(FINDINGS))} route={parseHash('#/findings')} />);
  const label = (key: string): string => marked[key];
  const CATEGORY = label('page.findings.filter.category');
  const LEVEL = label('page.findings.filter.level');
  const OWNER = label('page.findings.filter.owner');
  const shown = (host: HTMLElement): string => status(host);
  const rows = (host: HTMLElement): number => host.querySelectorAll('tbody tr').length;

  it('uses no native select: each filter is a combobox that shows its current choice', () => {
    const host = page();
    expect(host.querySelectorAll('select')).toHaveLength(0);
    expect(host.querySelectorAll('[role="combobox"]')).toHaveLength(3);
    for (const name of [CATEGORY, LEVEL, OWNER]) expect(selectByLabel(host, name).getAttribute('aria-expanded')).toBe('false');
    expect(selectByLabel(host, LEVEL).textContent).toContain(label('page.findings.filter.allLevels'));
  });

  it('opens with the keyboard and lists every category with its count, every level with the unranked one, and the owners', async () => {
    const host = page();
    await openWithKeyboard(selectByLabel(host, CATEGORY));
    expect(optionTexts()).toHaveLength(1 + FINDING_CATEGORIES.length);
    expect(optionTexts()[0]).toBe(label('page.findings.filter.all'));
    cleanup();
    const levels = page();
    await openWithKeyboard(selectByLabel(levels, LEVEL));
    expect(optionTexts()).toEqual([label('page.findings.filter.allLevels'), `${MARK}${MARK}P0: 1`, `${MARK}${MARK}P1: 1`, `${MARK}${MARK}P2: 1`, `${MARK}${marked['md.priority.unranked']}: 1`]);
    cleanup();
    const owners = page();
    await openWithKeyboard(selectByLabel(owners, OWNER));
    expect(optionTexts()).toEqual([label('page.findings.filter.allOwners'), label('page.findings.filter.system'), `${MARK}F1 ${d('name F1')}`, `${MARK}F3 ${d('name F3')}`]);
  });

  it('moving with the arrow keys and confirming with Enter changes the filter and the shown count', async () => {
    const host = page();
    expect(shown(host)).toBe(`${MARK}Showing 4 of 4 findings`);
    await openWithKeyboard(selectByLabel(host, LEVEL));
    await moveAndConfirm(2);
    expect(selectByLabel(host, LEVEL).textContent).toContain(`${MARK}${MARK}P1: 1`);
    expect(shown(host)).toBe(`${MARK}Showing 1 of 4 findings`);
    expect(rows(host)).toBe(1);
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });

  it('the three filters combine: category, level and owner each narrow the same list', async () => {
    const host = page();
    await choose(host, OWNER, `${MARK}F3 ${d('name F3')}`);
    expect(shown(host)).toBe(`${MARK}Showing 2 of 4 findings`);
    await choose(host, LEVEL, `${MARK}${MARK}P1: 1`);
    expect(shown(host)).toBe(`${MARK}Showing 1 of 4 findings`);
    await choose(host, CATEGORY, `${MARK}${name('time')}: 1`);
    expect(shown(host)).toBe(`${MARK}Showing 1 of 4 findings`);
    await choose(host, CATEGORY, `${MARK}${name('authorization')}: 1`);
    expect(shown(host)).toBe(`${MARK}Showing 0 of 4 findings`);
    expect(host.querySelector('[data-part="findings-no-match"]')).not.toBeNull();
    await choose(host, LEVEL, label('page.findings.filter.allLevels'));
    expect(shown(host)).toBe(`${MARK}Showing 1 of 4 findings`);
    await choose(host, OWNER, label('page.findings.filter.system'));
    expect(shown(host)).toBe(`${MARK}Showing 0 of 4 findings`);
  });

  it('Escape closes the list and keeps the choice', async () => {
    const host = page();
    await openWithKeyboard(selectByLabel(host, LEVEL));
    expect(document.querySelector('[role="listbox"]')).not.toBeNull();
    await pressActive('ArrowDown');
    await pressActive('Escape');
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(shown(host)).toBe(`${MARK}Showing 4 of 4 findings`);
  });

  it('the toolbar holds the three filters and the status in one row group, each filter with a label', () => {
    const host = page();
    const toolbar = host.querySelector('[data-part="findings-toolbar"]');
    expect(toolbar).not.toBeNull();
    expect(toolbar?.querySelectorAll('[data-part="filter-field"]')).toHaveLength(3);
    expect(toolbar?.querySelector('[role="status"]')).not.toBeNull();
  });
});

describe('the counts as a grid of labelled cards (handbook-page-layout)', () => {
  afterEach(cleanup);
  const cards = (host: HTMLElement, part: string): Record<string, string> => Object.fromEntries(
    Array.from(host.querySelectorAll(`[data-part="${part}"] [data-part="stat"]`)).map((card) => [card.querySelector('dt')?.textContent ?? '', card.querySelector('dd')?.textContent ?? '']),
  );

  it('renders the findings counts as label and value pairs, not as one sentence', () => {
    const host = mount(<AppView data={dataFor(['product'], structuredClone(FINDINGS))} route={parseHash('#/findings')} />);
    expect(cards(host, 'findings-stats')).toEqual({
      [marked['page.stat.findings']]: '4',
      [marked['page.stat.statements']]: '6',
      [marked['page.stat.merged']]: '2',
      [marked['page.stat.featuresVerified']]: `${MARK}3 of 5`,
      [marked['page.stat.systemVerified']]: `${MARK}1 of 3`,
    });
    expect(host.querySelector('p.summary-counts')).toBeNull();
    const byLevel = cards(host, 'findings-level-stats');
    expect(Object.values(byLevel)).toEqual(['1', '1', '1', '1']);
    expect(Object.keys(byLevel)).toEqual([`${MARK}P0`, `${MARK}P1`, `${MARK}P2`, marked['md.priority.unranked']]);
    expect(Object.values(cards(host, 'findings-category-stats')).filter((value) => value === '1')).toHaveLength(4);
    expect(Object.keys(cards(host, 'findings-category-stats'))).toHaveLength(FINDING_CATEGORIES.length);
  });
});
