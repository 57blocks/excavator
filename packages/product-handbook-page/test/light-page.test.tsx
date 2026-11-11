// O1 (page half) of openspec change handbook-light-scheme: a run whose overview, findings, system findings, ranking, remedies and topics
// are all written but not verified has every block on the page, each under its own fixed not-verified sentence, with the checked
// findings in the findings, ranking and feature pages and a checked lane counted as written in the topics and the coverage page; no block
// reads unfinished; a page without such a part carries no sentence.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AppView } from '../src/App';
import { parseHash } from '../src/lib/route';
import { PAGE_FORMAT } from '../src/lib/types';
import type { PageData, UnverifiedParts } from '../src/lib/types';
import { NO_APPENDIX, NO_HISTORY } from './empty-parts';
import { defaultOutline } from './outline-fixture';

const MARK = '@@';
const shipped = JSON.parse(readFileSync(fileURLToPath(new URL('../../../skills/excavator-product-handbook/ui-strings.json', import.meta.url)), 'utf-8')) as { strings: Record<string, string> };
const marked = Object.fromEntries(Object.entries(shipped.strings).map(([key, value]) => [key, `${MARK}${value}`]));
const sentence = (key: string): string => marked[key];

const PARTS: UnverifiedParts = { overview: true, findings: 1, systemFindings: 1, priority: true, remedies: true, topics: true };

function dataFor(parts: UnverifiedParts | undefined): PageData {
  const light = parts !== undefined;
  return {
    format: PAGE_FORMAT,
    chunks: { parts: [], units: {} },
    project: 'proj',
    language: 'language',
    languageTag: 'xx',
    ui: { strings: marked },
    views: ['product'],
    areas: [{ id: 'A1', name: 'area one' }],
    domains: [{ id: 'D1', name: 'domain one' }],
    domainBasis: 'domains',
    outline: defaultOutline(marked),
    features: [{ id: 'F1', name: 'name F1', area: 'A1', domain: 'D1', reach: 'menu', status: 'planned', entry: null, findingsStatus: light ? 'checked' : 'verified', ...(light ? { findingsUnverified: true } : {}) }],
    findings: [
      { category: 'authorization', owners: [{ kind: 'feature', id: 'F1', name: 'name F1' }], items: [{ id: 'F1.findings[0]', owner: { kind: 'feature', id: 'F1', name: 'name F1' }, text: 'A caller deletes without a check.' }], priority: { level: 'P0', consequence: 'othersRecords', reason: 'Any caller can reach it.' } },
      { category: 'notification', owners: [{ kind: 'application', id: 'app1', name: 'alpha' }], items: [{ id: 'app1.system[0]', owner: { kind: 'application', id: 'app1', name: 'alpha' }, text: 'The mail helper sends nothing.' }], priority: { level: 'P1', consequence: 'notification', reason: 'Nothing arrives.' } },
    ],
    remedies: { categories: [{ category: 'notification', cause: 'No send.', measure: 'Send first.' }], recommendations: [{ title: 'Make the helper honest', text: 'Say sent after sending.', groups: [], facts: [] }] },
    topics: { approval: [], time: [], handoffs: [], access: [], repeated: [{ fields: { mechanism: 'No caller check', places: 'Orders' }, basis: [{ id: 'F1.findings[0]', kind: 'group', category: 'authorization', level: 'P0', text: 'A caller deletes without a check.' }] }] },
    history: NO_HISTORY,
    appendix: NO_APPENDIX,
    coverage: {
      candidateTotal: 0, assigned: 0, unassigned: [], reachCounts: [], removedOverview: [], removed: [], findingsUnfinished: [], findingsNotWritten: 0, findingsRemoved: [],
      systemFindingsTotal: 1, systemFindingsUnfinished: [], systemFindingsNotWritten: 0, systemFindingsRemoved: [], priority: { finished: true, unranked: [] },
      remedies: { finished: true, stale: false, dropped: [] },
      topics: { finished: true, stale: false, entriesRead: 0, groupsRead: 2, lanes: [{ id: 'repeated', name: null, status: light ? 'checked' : 'verified', kept: 1, dropped: 0 }], dropped: [] },
    },
    ...(light ? { unverifiedParts: parts } : {}),
    summary: { notifications: [], jobs: [], counts: { featureTotal: 1, featuresWithEntry: 0, notificationRows: 0, jobRows: 0, schedule: { literal: 0, computed: 0, absent: 0 }, described: 0 } },
    system: {
      status: light ? 'checked' : 'verified',
      overview: { name: 'proj', summary: ['Staff look after orders.'], audiences: [], integrations: [], unknowns: [] },
      applications: [], counts: { applications: 0, files: 0, lines: 0, areas: 1, features: 1, featuresWithEntry: 0, roles: 0 }, areas: [], domains: [],
    },
    entities: { domains: [{ id: 'D1', name: 'domain one', features: ['F1'], purposes: [] }], roles: [], roleFeature: { roles: [], features: [], cells: [] } },
  } as unknown as PageData;
}

const render = (data: PageData, hash: string): string => renderToStaticMarkup(<AppView data={data} route={parseHash(hash)} />).replace(/<wbr\/>/g, '');

describe('a page whose every model-written part is written but not verified', () => {
  const light = dataFor(PARTS);

  it('has the overview with its own sentence', () => {
    const html = render(light, '#/product');
    expect(html).toContain(sentence('md.overview.unverified'));
    expect(html).toContain('Staff look after orders.');
    expect(html).not.toContain(sentence('md.overview.notWritten').split('{')[0]);
  });

  it('has the findings, the system findings, the ranking and the causes under their own sentences, and every group with its level', () => {
    const html = render(light, '#/product/findings');
    for (const key of ['md.findings.unverifiedFeature', 'md.findings.unverifiedSystem', 'md.priority.unverified', 'md.remedies.unverified']) expect(html, key).toContain(sentence(key));
    expect(html).toContain('A caller deletes without a check.');
    expect(html).toContain('The mail helper sends nothing.');
    expect(html).toContain(`${sentence('md.priority.unranked')} <b>0</b>`);
    expect(html).toContain('data-level="P0"');
    expect(html).toContain('data-level="P1"');
  });

  it('shows the written count of units, not zero', () => {
    const html = render(light, '#/product/findings');
    expect(html).toContain(`<dt>${sentence('page.stat.featuresVerified')}</dt><dd>${MARK}1 of 1</dd>`);
    expect(html).toContain(`<dt>${sentence('page.stat.systemVerified')}</dt><dd>${MARK}1 of 1</dd>`);
  });

  it('has the findings of the feature under their sentence', () => {
    const html = render(light, '#/product/feature/F1');
    expect(html).toContain(sentence('md.findings.unverifiedFeature'));
    expect(html).toContain('A caller deletes without a check.');
  });

  it('has the recommendations and the topics under their sentences', () => {
    const recommendations = render(light, '#/product/recommendations');
    expect(recommendations).toContain(sentence('md.remedies.unverified'));
    expect(recommendations).toContain('Make the helper honest');
    const topics = render(light, '#/product/topics');
    expect(topics).toContain(sentence('md.topics.unverified'));
    expect(topics).toContain('No caller check');
    expect(topics).not.toContain(sentence('md.topics.notFinished'));
  });

  it('counts every part as written and not verified on the coverage page, and none as unfinished', () => {
    const html = render(light, '#/product/coverage');
    for (const [key, values] of [
      ['md.coverage.overviewUnverified', {}], ['md.coverage.priorityUnverified', {}], ['md.coverage.remediesUnverified', {}], ['md.coverage.topicsUnverified', {}],
    ] as const) expect(html, key).toContain(sentence(key).replace(/\{[a-z]+\}/gi, (name) => String((values as Record<string, unknown>)[name.slice(1, -1)] ?? name)));
    expect(html).toContain(`${MARK}The findings of 1 of 1 features are written but not verified.`);
    expect(html).toContain(`${MARK}The system findings of 1 of 1 application roots are written but not verified.`);
    expect(html).toContain(sentence('md.topics.laneStatus.checked'));
    expect(html).not.toContain(sentence('md.status.checked'));
    expect(html).not.toContain(sentence('md.coverage.findingsAllVerified'));
    expect(html).not.toContain(sentence('md.coverage.systemFindingsAllVerified'));
  });

  it('a page with nothing written but not verified carries none of the sentences', () => {
    const plain = dataFor(undefined);
    const pages = ['#/product', '#/product/findings', '#/product/feature/F1', '#/product/recommendations', '#/product/topics', '#/product/coverage'].map((hash) => render(plain, hash)).join('\n');
    for (const key of ['md.overview.unverified', 'md.findings.unverifiedFeature', 'md.findings.unverifiedSystem', 'md.priority.unverified', 'md.remedies.unverified', 'md.topics.unverified', 'md.coverage.overviewUnverified', 'md.coverage.priorityUnverified', 'md.coverage.remediesUnverified', 'md.coverage.topicsUnverified']) {
      expect(pages, key).not.toContain(sentence(key));
    }
  });
});
