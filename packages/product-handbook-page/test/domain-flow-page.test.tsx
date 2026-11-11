// O1 (page half) of openspec change handbook-free-chapter, domain flow diagrams: the page draws a checked diagram as an inline SVG in the
// layered layout of the overview diagrams, right after what the domain does; a diagram that failed its checks says the fixed text; a
// domain with no diagram says the none text; the same data gives the same markup.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AppView } from '../src/App';
import { parseHash } from '../src/lib/route';
import { PAGE_FORMAT } from '../src/lib/types';
import type { DomainFlow, Feature, PageData } from '../src/lib/types';
import { NO_APPENDIX, NO_HISTORY } from './empty-parts';
import { defaultOutline } from './outline-fixture';

const MARK = '@@';
const shipped = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../skills/excavator-product-handbook/ui-strings.json'), 'utf-8')) as { strings: Record<string, string> };
const marked = Object.fromEntries(Object.entries(shipped.strings).map(([key, value]) => [key, `${MARK}${value}`]));

const feature = (id: string, unverified: boolean): Feature => ({
  id, name: `name ${id}`, area: 'A1', domain: 'D1', reach: 'menu', status: unverified ? 'checked' : 'verified', ...(unverified ? { unverified: true } : {}), entry: null, findingsStatus: 'planned',
} as unknown as Feature);

const DRAWN: DomainFlow = {
  status: 'drawn',
  nodes: [
    { id: 'n1', kind: 'feature', feature: 'F1', label: 'name F1' },
    { id: 'n2', kind: 'feature', feature: 'F2', label: 'name F2' },
    { id: 'n3', kind: 'state', feature: 'F2', label: 'Draft' },
  ],
  edges: [{ from: 'n1', to: 'n2', text: 'archive' }, { from: 'n2', to: 'n3' }],
};

function dataFor(flow: DomainFlow | undefined): PageData {
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
    features: [feature('F1', false), feature('F2', true)],
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
    summary: { notifications: [], jobs: [], counts: { featureTotal: 2, featuresWithEntry: 2, notificationRows: 0, jobRows: 0, schedule: { literal: 0, computed: 0, absent: 0 }, described: 0 } },
    system: { status: 'planned', overview: null, applications: [], counts: { applications: 0, files: 0, lines: 0, areas: 0, features: 0, featuresWithEntry: 0, roles: 0 }, areas: [], domains: [] },
    entities: {
      domains: [{ id: 'D1', name: 'domain one', features: ['F1', 'F2'], purposes: [], ...(flow === undefined ? {} : { flow }) }],
      roles: [], roleFeature: { roles: [], features: [], cells: [] },
    },
  } as unknown as PageData;
}

const render = (flow: DomainFlow | undefined): string => renderToStaticMarkup(<AppView data={dataFor(flow)} route={parseHash('#/product/domain/D1')} />).replace(/<wbr\/>/g, '');
const FAILED = marked['md.entities.domain.flowFailed'];
const NONE = marked['md.entities.domain.flowNone'];

describe('the flow diagram on the domain page', () => {
  it('is an inline SVG with a box for each node and the text of an edge, right after what the domain does and before the features', () => {
    const html = render(DRAWN);
    const flow = html.indexOf('data-part="domain-flow"');
    expect(flow).toBeGreaterThan(html.indexOf('data-part="domain-does"'));
    expect(flow).toBeLessThan(html.indexOf('data-part="domain-features"'));
    const section = /data-part="domain-flow"[\s\S]*?<\/section>/.exec(html)![0];
    expect(section).toContain('<svg');
    expect(section.match(/<a [^>]*class="flow-node"/g)).toHaveLength(3);
    expect(section.match(/class="flow-edge"/g)).toHaveLength(2);
    expect(section).toContain('>archive</text>');
    expect(section).toContain(marked['md.entities.domain.flowNote']);
    expect(section).not.toContain(FAILED);
    expect(section).not.toContain(NONE);
  });

  it('lays the boxes out in layers, so a chain runs from the left to the right', () => {
    const section = /data-part="domain-flow"[\s\S]*?<\/section>/.exec(render(DRAWN))![0];
    const lefts = [...section.matchAll(/class="flow-node"[^>]*style="left:(\d+)px/g)].map((match) => Number(match[1]));
    expect(lefts).toHaveLength(3);
    expect(lefts[0]).toBeLessThan(lefts[1]);
    expect(lefts[1]).toBeLessThan(lefts[2]);
  });

  it('marks a box of an unverified feature and not that of a verified one', () => {
    const section = /data-part="domain-flow"[\s\S]*?<\/section>/.exec(render(DRAWN))![0];
    const boxes = section.split('<a ').slice(1);
    expect(boxes.find((box) => box.includes('>name F1<'))).not.toContain('data-unverified');
    expect(boxes.find((box) => box.includes('>name F2<'))).toContain('data-unverified');
  });

  it('says the fixed failed text and draws nothing when the diagram failed its checks', () => {
    const section = /data-part="domain-flow"[\s\S]*?<\/section>/.exec(render({ status: 'failed' }))![0];
    expect(section).toContain(FAILED);
    expect(section).not.toContain('<svg');
  });

  it('says the none text for a domain with no diagram', () => {
    const section = /data-part="domain-flow"[\s\S]*?<\/section>/.exec(render(undefined))![0];
    expect(section).toContain(NONE);
    expect(section).not.toContain('<svg');
  });

  it('gives the same markup for the same data', () => {
    expect(render(DRAWN)).toBe(render(DRAWN));
  });
});
