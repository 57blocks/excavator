// O1 (page half) of openspec change handbook-architecture-chapter: the architecture page draws a checked chapter under the fixed
// not-verified text and a layered chart whose columns follow the kind of each component (users, frontends, backends, then databases
// and external services), with the text of each link; a section that is not there (not selected, failed, a file missing) keeps the
// old chart of the applications and the external systems with one fixed text; the applications and external systems tables stay.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AppView } from '../src/App';
import { parseHash } from '../src/lib/route';
import { PAGE_FORMAT } from '../src/lib/types';
import type { ArchitectureSection, PageData } from '../src/lib/types';
import { NO_APPENDIX, NO_HISTORY } from './empty-parts';
import { defaultOutline } from './outline-fixture';

const MARK = '@@';
const shipped = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../skills/excavator-product-handbook/ui-strings.json'), 'utf-8')) as { strings: Record<string, string> };
const marked = Object.fromEntries(Object.entries(shipped.strings).map(([key, value]) => [key, `${MARK}${value}`]));

const CHECKED: ArchitectureSection = {
  status: 'checked',
  chapter: [
    { kind: 'heading', level: 1, text: 'Architecture' },
    { kind: 'paragraph', text: 'The web application is a browser client.' },
    { kind: 'list', ordered: false, text: 'First point' },
  ],
  components: [
    { id: 'c1', label: 'Clerks', kind: 'users', layer: 0 },
    { id: 'c2', label: 'Web client', kind: 'frontend', layer: 1, application: 'web' },
    { id: 'c3', label: 'Api service', kind: 'backend', layer: 2, application: 'api' },
    { id: 'c4', label: 'Job runner', kind: 'backend', layer: 2, application: 'jobs' },
    { id: 'c5', label: 'Order store', kind: 'database', layer: 3 },
    { id: 'c6', label: 'Mail service', kind: 'external', layer: 3 },
  ],
  links: [
    { from: 'c1', to: 'c2', text: 'uses' },
    { from: 'c2', to: 'c3', text: 'calls' },
    { from: 'c3', to: 'c4', text: 'queues work' },
    { from: 'c3', to: 'c5', text: 'reads and writes' },
    { from: 'c4', to: 'c6', text: 'sends mail' },
  ],
};

function dataFor(architecture: ArchitectureSection): PageData {
  return {
    format: PAGE_FORMAT,
    chunks: { parts: [], units: {} },
    project: 'proj',
    language: 'language',
    languageTag: 'xx',
    ui: { strings: marked },
    views: ['product', 'technical'],
    areas: [{ id: 'A1', name: 'area one' }],
    domains: [{ id: 'D1', name: 'domain one' }],
    domainBasis: 'domains',
    outline: defaultOutline(marked),
    features: [],
    findings: [],
    remedies: { categories: [], recommendations: [] },
    topics: { approval: [], time: [], handoffs: [], access: [], repeated: [] },
    history: NO_HISTORY,
    appendix: NO_APPENDIX,
    coverage: {
      candidateTotal: 0, assigned: 0, unassigned: [], reachCounts: [], removedOverview: [], removed: [], findingsUnfinished: [], findingsNotWritten: 0, findingsRemoved: [],
      systemFindingsTotal: 0, systemFindingsUnfinished: [], systemFindingsNotWritten: 0, systemFindingsRemoved: [], priority: { finished: true, unranked: [] },
      remedies: { finished: true, stale: false, dropped: [] }, topics: { finished: true, stale: false, entriesRead: 0, groupsRead: 0, lanes: [], dropped: [] }, unverified: [],
    },
    summary: { notifications: [], jobs: [], counts: { featureTotal: 0, featuresWithEntry: 0, notificationRows: 0, jobRows: 0, schedule: { literal: 0, computed: 0, absent: 0 }, described: 0 } },
    system: {
      status: 'verified',
      overview: null,
      applications: [{ dir: 'web', name: 'Web app', does: 'shows', languages: [], frameworks: [], files: 1, lines: 1, history: null }],
      counts: { applications: 1, files: 1, lines: 1, areas: 0, features: 0, featuresWithEntry: 0, roles: 0 }, areas: [], domains: [],
    },
    entities: { domains: [{ id: 'D1', name: 'domain one', features: [], purposes: [] }], roles: [], roleFeature: { roles: [], features: [], cells: [] } },
    technical: {
      featureApplication: [], unattributed: [], applicationDomain: { applications: [], domains: [], cells: [], unattributed: [] },
      integrations: [{ system: 'Slack', use: 'messages', shown: ['web'], named: [], namedOutside: 0 }],
      jobs: [], locations: [], topicLocations: [], history: { hotspots: [], coChange: [] }, findingLocations: [], data: null, dataState: 'missing', dictionaries: null, dictionariesState: 'missing',
      architecture,
    },
  } as unknown as PageData;
}

const render = (architecture: ArchitectureSection, hash = '#/technical/architecture'): string => renderToStaticMarkup(<AppView data={dataFor(architecture)} route={parseHash(hash)} />).replace(/<wbr\/>/g, '');
const lefts = (html: string): Record<string, number> => Object.fromEntries([...html.matchAll(/<a class="flow-node"[^>]*title="([^"]+)" style="left:(\d+)px;top:(\d+)px/g)].map((match) => [match[1], Number(match[2])]));
const tops = (html: string): Record<string, number> => Object.fromEntries([...html.matchAll(/<a class="flow-node"[^>]*title="([^"]+)" style="left:(\d+)px;top:(\d+)px/g)].map((match) => [match[1], Number(match[3])]));

describe('the architecture page with a checked chapter', () => {
  const html = render(CHECKED);

  it('has the fixed not-verified text and the chapter without its own title level clash', () => {
    expect(html).toContain(`data-part="architecture-unverified"`);
    expect(html).toContain(marked['md.architecture.unverified']);
    expect(html).toContain('The web application is a browser client.');
    expect(html).toContain('First point');
  });

  it('draws a chart with a column for each layer, the components of a layer in the order of the file, and the old chart gone', () => {
    const x = lefts(html);
    expect(Object.keys(x)).toEqual(['Clerks', 'Web client', 'Api service', 'Job runner', 'Order store', 'Mail service']);
    expect(x['Clerks']).toBeLessThan(x['Web client']);
    expect(x['Web client']).toBeLessThan(x['Api service']);
    expect(x['Api service']).toBe(x['Job runner']);
    expect(x['Api service']).toBeLessThan(x['Order store']);
    expect(x['Order store']).toBe(x['Mail service']);
    const y = tops(html);
    expect(y['Api service']).toBeLessThan(y['Job runner']);
    expect(y['Order store']).toBeLessThan(y['Mail service']);
    expect(html).toContain('data-part="architecture-structure"');
    expect(html).not.toContain('data-part="architecture-calls"');
  });

  it('writes the text of each link, also one between two components of a layer, and draws an arrow for each', () => {
    for (const text of ['uses', 'calls', 'queues work', 'reads and writes', 'sends mail']) expect(html).toContain(`>${text}</text>`);
    expect(html.match(/class="flow-edge"/g)).toHaveLength(5);
  });

  it('keeps the applications table and the external systems table', () => {
    expect(html).toContain('data-part="architecture-applications"');
    expect(html).toContain('data-part="architecture-systems"');
  });

  it('gives the same markup for the same data', () => {
    expect(render(CHECKED)).toBe(html);
  });
});

describe('the architecture page without a checked chapter', () => {
  for (const [status, key] of [['none', 'notSelected'], ['failed', 'failed'], ['missing', 'missing']] as const) {
    it(`says why for ${status} and keeps the old chart`, () => {
      const out = render({ status });
      expect(out).toContain(marked[`md.architecture.${key}`]);
      expect(out).toContain('data-part="architecture-calls"');
      expect(out).not.toContain('data-part="architecture-structure"');
      expect(out).not.toContain(marked['md.architecture.unverified']);
    });
  }
});
