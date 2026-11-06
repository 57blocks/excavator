// O2 (page) of openspec change handbook-feature-findings: the route #/findings
// in both views with a sidebar link, the counts by category, the findings
// grouped by category and filterable by category, the file and lines of each
// finding in the technical view only, the feature page listing its own
// findings, the coverage page listing the units not verified and the removed
// findings, and every fixed text coming from the ui table.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AppView } from '../src/App';
import { countByCategory, filterFindings } from '../src/components/FindingsPage';
import { parseHash, routeHash } from '../src/lib/route';
import { FINDING_CATEGORIES, findingCategoryKey } from '../src/lib/types';
import type { Feature, Finding, FindingCategory, PageData, View } from '../src/lib/types';
import { switchTarget } from '../src/lib/views';

const MARK = '@@';
const DATA = 'd~';
const shipped = JSON.parse(readFileSync(fileURLToPath(new URL('../../../skills/excavator-product-handbook/ui-strings.json', import.meta.url)), 'utf-8')) as { strings: Record<string, string> };
const marked = Object.fromEntries(Object.entries(shipped.strings).map(([key, value]) => [key, `${MARK}${value}`]));
const d = (text: string): string => `${DATA}${text}`;

const feature = (id: string, status: Feature['status'], findingsStatus: Feature['findingsStatus']): Feature => ({
  id, name: d(`name ${id}`), area: 'A1', domain: 'D1', reach: 'menu', status, entry: null, findingsStatus,
});

const FINDINGS: Finding[] = [
  { id: 'F1.findings[0]', feature: 'F1', category: 'authorization', text: d('first statement') },
  { id: 'F1.findings[1]', feature: 'F1', category: 'hard-coded', text: d('second statement') },
  { id: 'F3.findings[0]', feature: 'F3', category: 'authorization', text: d('third statement') },
];

/** F1 and F3 have verified findings, F2 verified with none, F4 failed, F5 planned; one finding of F1 was removed. */
function dataFor(views: View[], findings: Finding[] = FINDINGS): PageData {
  return {
    format: 'excavator-product-handbook-page/8',
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
  it('shows the counts line, the groups in the order of the categories and each finding with its feature and statement', () => {
    const body = main(render(dataFor(['product']), '#/findings'));
    expect(body).toContain(`${MARK}Findings: 3. Findings units verified: 3 of 5. By category: ${FINDING_CATEGORIES.map((key) => `${MARK}${name(key)}: ${key === 'authorization' ? 2 : key === 'hard-coded' ? 1 : 0}`).join('; ')}.`);
    const headings = [...body.matchAll(/data-category="([a-z-]+)"/g)].map((match) => match[1]);
    expect(headings).toEqual(['authorization', 'hard-coded']);
    for (const text of ['first statement', 'second statement', 'third statement']) expect(body).toContain(d(text));
    expect(body).toContain(`${MARK}F1 ${d('name F1')}`);
    expect(body).toContain(marked['md.findings.note']);
    expect((body.match(/<tbody>[\s\S]*?<\/tbody>/g) ?? []).map((part) => (part.match(/<tr>/g) ?? []).length)).toEqual([2, 1]);
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

  it('the technical view adds the file and lines of each finding; the product view never carries a path', () => {
    const data = dataFor(BOTH);
    const technical = main(render(data, '#/technical/findings'));
    expect(technical).toContain(`<th scope="col">${marked['md.locations.heading']}</th>`);
    expect(technical).toContain(`${MARK}${d('src/one.js')}, line 7`);
    expect(technical).toContain(`${MARK}${d('src/two.js')}, lines 5-9; ${MARK}${d('src/three.js')}, lines not located`);
    const product = render(data, '#/product/findings');
    for (const file of ['src/one.js', 'src/two.js', 'src/three.js', 'src/four.js']) expect(product).not.toContain(file);
    expect(product).not.toContain(marked['md.locations.heading']);
  });

  it('filters by category: the select lists every category with its count, and a filter keeps only that category', () => {
    const html = render(dataFor(['product']), '#/findings');
    expect(html).toContain(marked['page.findings.filter.category']);
    expect(html).toContain(marked['page.findings.filter.all']);
    expect((html.match(/<option/g) ?? []).length).toBe(1 + FINDING_CATEGORIES.length);
    expect(html).toContain(`${MARK}Showing 3 of 3 findings`);
    const list = dataFor(['product']).findings;
    expect(filterFindings(list, null)).toEqual(list);
    expect(filterFindings(list, 'authorization').map((finding) => finding.id)).toEqual(['F1.findings[0]', 'F3.findings[0]']);
    expect(filterFindings(list, 'time')).toEqual([]);
    expect(filterFindings(list, null)).not.toBe(list);
  });
});

describe('the feature page and the coverage page', () => {
  it('lists the findings of the feature with their category, and nothing of another feature', () => {
    const html = main(render(dataFor(['product']), '#/feature/F1'));
    expect(html).toContain(`${MARK}${name('authorization')}: ${d('first statement')}`);
    expect(html).toContain(`${MARK}${name('hard-coded')}: ${d('second statement')}`);
    expect(html).not.toContain(d('third statement'));
    expect(html).toContain(`id="sec-findings"`);
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
    expect((unfinished.match(/<tr>/g) ?? []).length).toBe(2);
    expect(unfinished).toContain(marked['md.status.failed']);
    expect(unfinished).not.toContain('name F1');
    const removed = html.slice(html.indexOf('id="cov-findings-removed"'));
    for (const text of ['removed claim', 'removed reason']) expect(removed).toContain(d(text));
    expect(removed).toContain(marked['md.verdict.contradicted']);
    expect(removed).toContain(`${MARK}F1 ${d('name F1')} (${d('area')}): findings removed: 1`);
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
    for (const [key, value] of Object.entries(shipped.strings)) if (key.startsWith('md.findings.') || key.startsWith('page.findings.') || key === 'page.nav.findings') expect(value, key).not.toContain("'");
  });
});
