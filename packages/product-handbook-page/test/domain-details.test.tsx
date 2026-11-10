// @vitest-environment happy-dom
// O3 (page) of openspec change handbook-outline, design D7: a domain page lists, after the features, the full detail of each
// verified feature of the domain, the same as the feature's page with headings one level lower, each under an anchor
// `feature-<id>` that the features list links to; a feature without a verified entry has none; the detail of a chunked page
// loads the way the feature page's does and a missing part shows the chunk notice for that feature only.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';

import { splitPageData } from '../../../skills/excavator-product-handbook/lib/page-units.mjs';
import { AppView } from '../src/App';
import { LoaderContext, createLoader, installPartRegistry } from '../src/lib/chunks';
import type { PartWindow, Piece } from '../src/lib/chunks';
import { parseHash } from '../src/lib/route';
import { PAGE_FORMAT } from '../src/lib/types';
import type { Entry, Feature, PageData, Summary, System, Technical } from '../src/lib/types';
import { cleanup, mount, settle } from './dom';
import { NO_APPENDIX, NO_HISTORY } from './empty-parts';
import { defaultOutline } from './outline-fixture';

afterEach(cleanup);

const MARK = '@@';
const shipped = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../skills/excavator-product-handbook/ui-strings.json'), 'utf-8')) as { strings: Record<string, string> };
const marked = Object.fromEntries(Object.entries(shipped.strings).map(([key, value]) => [key, `${MARK}${value}`]));

const entry = (tag: string): Entry => ({
  purpose: `purpose ${tag}`,
  who: [{ role: `role ${tag}`, can: `can ${tag}` }],
  where: [`menu ${tag}`],
  screens: [{ name: `screen ${tag}`, fields: [{ label: `field ${tag}`, rules: [{ side: 'backend', text: `rule ${tag}` }] }] }],
  operations: [{
    name: `operation ${tag}`,
    sentences: [`step ${tag}`],
    triggers: [`trigger ${tag}`], calculations: [], changes: [], edges: [], handoffs: [],
    sequence: { participants: ['A', 'B'], steps: [{ from: 0, to: 1 }] },
  }],
  states: [{ label: `state ${tag}`, meaning: `meaning ${tag}` }],
  transitions: [{ from: `from ${tag}`, to: `to ${tag}`, by: `by ${tag}` }],
  notifications: [{ trigger: `ntrigger ${tag}`, recipient: `recipient ${tag}`, channel: `channel ${tag}`, content: `content ${tag}` }],
  automatic: [{ when: `when ${tag}`, effect: `effect ${tag}` }],
  unknowns: [{ item: `unknown ${tag}`, searched: `searched ${tag}` }],
});

const feature = (id: string, domain: string, status: Feature['status'], entryValue: Entry | null): Feature => ({
  id, name: `name ${id}`, area: 'A1', domain, reach: 'menu', status, entry: entryValue, findingsStatus: 'verified',
});

const summary: Summary = {
  notifications: [], jobs: [],
  counts: { featureTotal: 0, featuresWithEntry: 0, notificationRows: 0, jobRows: 0, schedule: { literal: 0, computed: 0, absent: 0 }, described: 0 },
};
const system: System = { status: 'planned', overview: null, applications: [], counts: { applications: 0, files: 0, lines: 0, areas: 0, features: 0, featuresWithEntry: 0, roles: 0 }, areas: [], domains: [] };
const technical: Technical = {
  featureApplication: [], unattributed: [], applicationDomain: { applications: [], domains: [], cells: [], unattributed: [] }, integrations: [], jobs: [],
  locations: [
    { id: 'F1', items: [{ claim: 'claim F1', citations: [{ file: 'src/f1.js', startLine: 3, endLine: 3 }] }] },
    { id: 'F2', items: [{ claim: 'claim F2', citations: [{ file: 'src/f2.js', startLine: 5, endLine: 6 }] }] },
  ] as unknown as Technical['locations'],
  data: null, dataState: 'missing', dictionaries: null, dictionariesState: 'missing', findingLocations: [], topicLocations: [], history: { hotspots: [], coChange: [] },
};

/** Domain D1 holds F1 and F2 (verified, with entries), F3 (planned, no entry); D2 holds F4 (verified). */
function dataFor(): PageData {
  return {
    format: PAGE_FORMAT,
    chunks: { parts: [], units: {} },
    project: 'proj',
    language: 'language',
    languageTag: 'xx',
    ui: { strings: marked },
    views: ['product', 'technical'],
    areas: [{ id: 'A1', name: 'area one' }],
    domains: [{ id: 'D1', name: 'domain one' }, { id: 'D2', name: 'domain two' }],
    domainBasis: 'domains',
    outline: defaultOutline(marked),
    features: [
      feature('F1', 'D1', 'verified', entry('F1')),
      feature('F2', 'D1', 'verified', entry('F2')),
      feature('F3', 'D1', 'planned', null),
      feature('F4', 'D2', 'verified', entry('F4')),
    ],
    findings: [{ category: 'quality', owners: [{ kind: 'feature', id: 'F1', name: 'name F1' }], items: [{ id: 'X1', owner: { kind: 'feature', id: 'F1', name: 'name F1' }, text: 'finding F1' }], priority: null }] as unknown as PageData['findings'],
    remedies: { categories: [], recommendations: [] },
    topics: { approval: [], time: [], handoffs: [], access: [], repeated: [] },
    history: NO_HISTORY,
    appendix: NO_APPENDIX,
    coverage: { candidateTotal: 0, assigned: 0, unassigned: [], reachCounts: [], removedOverview: [], removed: [], findingsUnfinished: [], findingsNotWritten: 0, findingsRemoved: [], systemFindingsTotal: 0, systemFindingsUnfinished: [], systemFindingsNotWritten: 0, systemFindingsRemoved: [], priority: { finished: true, unranked: [] }, remedies: { finished: true, stale: false, dropped: [] }, topics: { finished: true, stale: false, entriesRead: 0, groupsRead: 0, lanes: [], dropped: [] } },
    summary,
    system,
    entities: {
      domains: [
        { id: 'D1', name: 'domain one', features: ['F1', 'F2', 'F3'], purposes: [{ feature: 'F1', text: 'purpose F1' }, { feature: 'F2', text: 'purpose F2' }] },
        { id: 'D2', name: 'domain two', features: ['F4'], purposes: [{ feature: 'F4', text: 'purpose F4' }] },
      ],
      roles: [], roleFeature: { roles: [], features: [], cells: [] },
    },
    technical,
  };
}

const render = (data: PageData, hash: string): string => renderToStaticMarkup(<AppView data={data} route={parseHash(hash)} />).replace(/<wbr\/>/g, '');
const anchorOf = (html: string, id: string): string => {
  const start = html.indexOf(`id="feature-${id}"`);
  if (start < 0) return '';
  const further = html.slice(start + 10).search(/id="feature-[A-Z0-9]+"/);
  const ends = [further < 0 ? -1 : further + start + 10, html.indexOf('data-part="domain-states"', start + 10)].filter((at) => at >= 0);
  return html.slice(start, ends.length === 0 ? undefined : Math.min(...ends));
};

describe('the domain page lists the detail of each verified feature', () => {
  const html = render(dataFor(), '#/product/domain/D1');

  it('has one element with the anchor feature-<id> for each verified feature of the domain, in the domain\'s order, after the features list', () => {
    const ids = Array.from(html.matchAll(/id="(feature-[A-Z0-9]+)"/g), (m) => m[1]);
    expect(ids).toEqual(['feature-F1', 'feature-F2']);
    expect(html.indexOf('data-part="domain-features"')).toBeLessThan(html.indexOf('id="feature-F1"'));
    expect(html.indexOf('id="feature-F1"')).toBeLessThan(html.indexOf('id="feature-F2"'));
  });

  it('shows the same content as the feature page: purpose, people, place, screens, operations, states, notifications, automatic, unknowns, findings', () => {
    for (const id of ['F1', 'F2']) {
      const part = anchorOf(html, id);
      for (const text of [`purpose ${id}`, `role ${id}`, `menu ${id}`, `screen ${id}`, `rule ${id}`, `operation ${id}`, `step ${id}`, `trigger ${id}`, `state ${id}`, `meaning ${id}`, `to ${id}`, `recipient ${id}`, `when ${id}`, `unknown ${id}`]) {
        expect(part, `${id} ${text}`).toContain(text);
      }
      expect(part).toContain('data-part="operation"');
    }
    expect(anchorOf(html, 'F1')).toContain('finding F1');
    expect(anchorOf(html, 'F2')).not.toContain('finding F1');
  });

  it('leaves out a feature without a verified entry, and the features of other domains', () => {
    expect(html).not.toContain('id="feature-F3"');
    expect(html).not.toContain('id="feature-F4"');
    expect(html).not.toContain('purpose F4</p>');
  });

  it('puts a heading of the feature\'s name and the sections one level lower than the feature page', () => {
    const page = render(dataFor(), '#/product/feature/F1');
    const levels = (text: string) => Array.from(text.matchAll(/<h([1-6]) class="(section-title|screen-title|operation-title|part-label)"/g), (m) => `${m[2]}:${m[1]}`);
    const own = levels(anchorOf(html, 'F1'));
    const alone = levels(page);
    expect(alone.length).toBeGreaterThan(5);
    expect(own).toEqual(alone.map((item) => item.replace(/:(\d)/, (_, n) => `:${Math.min(6, Number(n) + 1)}`)));
    expect(anchorOf(html, 'F1')).toMatch(/<h2 class="[^"]*" id="[^"]*" data-part="feature-title">name F1<\/h2>/);
  });

  it('has no duplicate id on the page', () => {
    const ids = Array.from(html.matchAll(/ id="([^"]+)"/g), (m) => m[1]);
    expect(ids.filter((id, at) => ids.indexOf(id) !== at)).toEqual([]);
  });

  it('links each feature of the list to its anchor in the page, and still offers its own page', () => {
    const list = /data-part="domain-features"[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';
    expect(list).toContain('href="#feature-F1"');
    expect(list).toContain('href="#feature-F2"');
    expect(list).toContain('href="#/product/feature/F1"');
    expect(list).toContain('href="#/product/feature/F3"');
    expect(list).not.toContain('href="#feature-F3"');
  });

  it('shows the source positions of each feature in the technical view only', () => {
    expect(html).not.toContain('src/f1.js');
    const technicalHtml = render(dataFor(), '#/technical/domain/D1');
    expect(anchorOf(technicalHtml, 'F1')).toContain('src/f1.js');
    expect(anchorOf(technicalHtml, 'F1')).not.toContain('src/f2.js');
    expect(anchorOf(technicalHtml, 'F2')).toContain('src/f2.js');
  });
});

describe('a chunked page', () => {
  function chunked(parts: (ids: string[]) => Record<string, Record<string, Piece[]>>) {
    const { core, units } = splitPageData(dataFor()) as { core: PageData; units: () => Iterable<{ key: string; pieces: Piece[] }> };
    const listed = [...units()];
    const ids = listed.map((_, at) => `part-000${at + 1}`);
    const held = parts(ids);
    core.chunks = { parts: ids, units: Object.fromEntries(listed.map((unit, at) => [unit.key, [ids[at]]])) };
    const files = Object.fromEntries(listed.map((unit, at) => [ids[at], { [unit.key]: unit.pieces }]));
    return { core, listed, ids, files: { ...files, ...held } };
  }
  const loaderFor = (core: PageData, files: Record<string, Record<string, Piece[]>>) => {
    const win = {} as PartWindow;
    installPartRegistry(win);
    return createLoader(core.chunks, {
      win,
      insert: (src, onload, onerror) => {
        const id = src.replace(/^.*\//, '').replace(/\.js$/, '');
        setTimeout(() => {
          if (id in files) { win.__xvHandbookPart?.(id, files[id]); onload(); } else onerror();
        }, 0);
      },
    });
  };

  it('shows a loading line for each feature and then the same detail as the page without part files', async () => {
    const { core, files } = chunked(() => ({}));
    const host = mount(<LoaderContext.Provider value={loaderFor(core, files)}><AppView data={core} route={parseHash('#/product/domain/D1')} /></LoaderContext.Provider>);
    expect(host.querySelectorAll('[data-part="chunk-loading"]').length).toBe(2);
    await settle();
    expect(host.querySelectorAll('[data-part="chunk-loading"]').length).toBe(0);
    expect(host.querySelector('#feature-F1')?.textContent).toContain('purpose F1');
    expect(host.querySelector('#feature-F2')?.textContent).toContain('operation F2');
    expect(host.innerHTML).toBe(mount(<AppView data={dataFor()} route={parseHash('#/product/domain/D1')} />).innerHTML);
  });

  it('names the missing part for that feature only, and the rest of the domain page still works', async () => {
    const { core, files, ids } = chunked(() => ({}));
    delete files[ids[0]];
    const host = mount(<LoaderContext.Provider value={loaderFor(core, files)}><AppView data={core} route={parseHash('#/product/domain/D1')} /></LoaderContext.Provider>);
    await settle();
    expect(host.querySelector('#feature-F1')?.querySelector('[data-part="chunk-missing"]')).not.toBeNull();
    expect(host.querySelector('#feature-F2')?.querySelector('[data-part="chunk-missing"]')).toBeNull();
    expect(host.querySelector('#feature-F2')?.textContent).toContain('purpose F2');
    expect(host.querySelector('[data-part="domain-features"]')).not.toBeNull();
    expect(host.querySelector('[data-part="domain-relations"]')).not.toBeNull();
  });
});
