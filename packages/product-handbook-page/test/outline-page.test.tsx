// O3 (page) of openspec change handbook-outline: the rail has one group per part of the outline with the part's title and the
// chapters' own titles, the previous and the next chapter follow the outline, the heading and the browser title of a block's
// page are its chapter's title, the product view skips the technical chapters and a part that becomes empty, a list chapter
// expands into its entity pages, and the coverage page says which outline was used and lists what the outline left out.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AppView, documentTitle } from '../src/App';
import { parseHash } from '../src/lib/route';
import { PAGE_FORMAT } from '../src/lib/types';
import type { Outline, OutlineChapter, PageData, Summary, System, Technical } from '../src/lib/types';
import { NO_APPENDIX, NO_HISTORY } from './empty-parts';
import { defaultOutline } from './outline-fixture';

const MARK = '@@';
const shipped = JSON.parse(readFileSync(fileURLToPath(new URL('../../../skills/excavator-product-handbook/ui-strings.json', import.meta.url)), 'utf-8')) as { strings: Record<string, string> };
const marked = Object.fromEntries(Object.entries(shipped.strings).map(([key, value]) => [key, `${MARK}${value}`]));

const summary: Summary = {
  notifications: [],
  jobs: [],
  counts: { featureTotal: 0, featuresWithEntry: 0, notificationRows: 0, jobRows: 0, schedule: { literal: 0, computed: 0, absent: 0 }, described: 0 },
};
const system: System = {
  status: 'planned', overview: null, applications: [{ dir: 'svc', name: null, does: null, languages: [], frameworks: [], files: 0, lines: 0, history: null }] as unknown as System['applications'],
  counts: { applications: 1, files: 0, lines: 0, areas: 0, features: 0, featuresWithEntry: 0, roles: 0 }, areas: [], domains: [],
};
const technical: Technical = {
  featureApplication: [], unattributed: [], applicationDomain: { applications: [], domains: [], cells: [], unattributed: [] },
  integrations: [{ system: 'Slack', use: 'x', callers: [], shown: [], named: [], namedOutside: 0 }] as unknown as Technical['integrations'],
  jobs: [], locations: [], data: null, dataState: 'missing', dictionaries: null, dictionariesState: 'missing', findingLocations: [], topicLocations: [], history: { hotspots: [], coChange: [] },
};

const chapter = (id: string, title: string, technicalOnly = false): OutlineChapter => (['domains', 'applications', 'systems'].includes(id) ? { title, list: id, technical: technicalOnly } : { title, block: id, technical: technicalOnly });
/** An outline the way a project's own might read: the order and the names are the test's. */
const OUTLINE: Outline = {
  source: 'outline',
  problems: [],
  parts: [
    { title: 'P-one', chapters: [chapter('findings', 'C-findings'), chapter('overview', 'C-overview'), chapter('domains', 'C-domains')] },
    { title: 'P-tech', chapters: [chapter('architecture', 'C-architecture', true), chapter('applications', 'C-applications', true), chapter('data', 'C-data', true)] },
    { title: 'P-last', chapters: [chapter('history', 'C-history'), chapter('systems', 'C-systems', true), chapter('business', 'C-business')] },
  ],
  unplaced: [{ block: 'glossary', title: 'The glossary', reason: 'R-glossary' }, { block: 'dictionaries', title: 'The dictionaries', reason: 'R-dictionaries' }],
};

const dataFor = (outline: Outline): PageData => ({
  format: PAGE_FORMAT,
  chunks: { parts: [], units: {} },
  project: 'proj',
  language: 'language',
  languageTag: 'xx',
  ui: { strings: marked },
  views: ['product', 'technical'],
  areas: [],
  domains: [{ id: 'D1', name: 'domain one' }, { id: 'D2', name: 'domain two' }],
  domainBasis: 'domains',
  outline,
  features: [],
  findings: [],
  remedies: { categories: [], recommendations: [] },
  topics: { approval: [], time: [], handoffs: [], access: [], repeated: [] },
  history: NO_HISTORY,
  appendix: NO_APPENDIX,
  coverage: { candidateTotal: 0, assigned: 0, unassigned: [], reachCounts: [], removedOverview: [], removed: [], findingsUnfinished: [], findingsNotWritten: 0, findingsRemoved: [], systemFindingsTotal: 0, systemFindingsUnfinished: [], systemFindingsNotWritten: 0, systemFindingsRemoved: [], priority: { finished: true, unranked: [] }, remedies: { finished: true, stale: false, dropped: [] }, topics: { finished: true, stale: false, entriesRead: 0, groupsRead: 0, lanes: [], dropped: [] } },
  summary,
  system,
  entities: { domains: [], roles: [], roleFeature: { roles: [], features: [], cells: [] } },
  technical,
});

const render = (data: PageData, hash: string): string => renderToStaticMarkup(<AppView data={data} route={parseHash(hash)} />);
const railOf = (html: string) => html.slice(html.indexOf('<nav class="rail"'), html.indexOf('</nav>', html.indexOf('<nav class="rail"')));
const links = (html: string): string[] => Array.from(railOf(html).matchAll(/<a class="rail-link"[^>]*>([^<]*)<\/a>/g), (match) => match[1]);
const groups = (html: string): string[] => Array.from(railOf(html).matchAll(/<h2 class="rail-group-name"[^>]*>([^<]*)<\/h2>/g), (match) => match[1]);
const h1 = (html: string): string => /<h1 class="page-title">([^<]*)<\/h1>/.exec(html)?.[1] ?? '';
const chapterNav = (html: string) => ({
  previous: /data-side="previous"[^>]*>.*?<span class="chapter-name">([^<]*)<\/span>/.exec(html)?.[1],
  next: /data-side="next"[^>]*>.*?<span class="chapter-name">([^<]*)<\/span>/.exec(html)?.[1],
});

describe('the rail follows the outline', () => {
  it('has one group per part with its title, the chapters under their own titles in the outline order, the coverage page last', () => {
    const html = render(dataFor(OUTLINE), '#/technical');
    expect(groups(html)).toEqual(['P-one', 'P-tech', 'P-last']);
    expect(links(html)).toEqual([
      'C-findings', 'C-overview', 'domain one', 'domain two',
      'C-architecture', 'svc', 'C-data',
      'C-history', 'Slack', 'C-business',
      `${MARK}Coverage`,
    ]);
  });

  it('skips the technical chapters in the product view, and a part with nothing left', () => {
    const html = render(dataFor(OUTLINE), '#/product');
    expect(groups(html)).toEqual(['P-one', 'P-last']);
    expect(links(html)).toEqual(['C-findings', 'C-overview', 'domain one', 'domain two', 'C-history', 'C-business', `${MARK}Coverage`]);
    expect(railOf(html)).not.toContain('P-tech');
  });

  it('names a list chapter whose title is not its part\'s above its entity pages', () => {
    const html = railOf(render(dataFor(OUTLINE), '#/technical'));
    expect(html).toContain('<h3 class="rail-subgroup-name">C-domains</h3>');
    const own = defaultOutline(marked);
    expect(railOf(render(dataFor(own), '#/technical'))).not.toContain('rail-subgroup-name');
  });

  it('links each block to its page', () => {
    const html = railOf(render(dataFor(OUTLINE), '#/technical'));
    expect(html).toContain('href="#/technical/findings"');
    expect(html).toContain('href="#/technical/architecture"');
    expect(html).toContain('href="#/technical/domain/D1"');
    expect(html).toContain('href="#/technical/application/svc"');
  });
});

describe('the previous and the next chapter follow the outline', () => {
  it('the first chapter has only a next one, in the outline\'s order', () => {
    expect(chapterNav(render(dataFor(OUTLINE), '#/product/findings'))).toEqual({ previous: undefined, next: 'C-overview' });
  });

  it('a middle chapter has both: the domain pages come between the overview and the history in the product view', () => {
    expect(chapterNav(render(dataFor(OUTLINE), '#/product'))).toEqual({ previous: 'C-findings', next: 'domain one' });
    expect(chapterNav(render(dataFor(OUTLINE), '#/product/domain/D2'))).toEqual({ previous: 'domain one', next: 'C-history' });
  });

  it('skips a technical chapter in the product view and not in the technical view', () => {
    expect(chapterNav(render(dataFor(OUTLINE), '#/product/domain/D2')).next).toBe('C-history');
    expect(chapterNav(render(dataFor(OUTLINE), '#/technical/domain/D2')).next).toBe('C-architecture');
  });

  it('the last chapter before the coverage page has the coverage page as its next one', () => {
    expect(chapterNav(render(dataFor(OUTLINE), '#/product/business')).next).toBe(`${MARK}Coverage`);
    expect(chapterNav(render(dataFor(OUTLINE), '#/product/coverage'))).toEqual({ previous: 'C-business', next: undefined });
  });
});

describe('the heading and the browser title of a block\'s page are its chapter\'s title', () => {
  const cases: [string, string, string][] = [
    ['findings', '#/product/findings', 'C-findings'],
    ['overview', '#/product', 'C-overview'],
    ['history', '#/product/history', 'C-history'],
    ['business', '#/product/business', 'C-business'],
    ['architecture', '#/technical/architecture', 'C-architecture'],
    ['data', '#/technical/data', 'C-data'],
  ];
  for (const [name, hash, title] of cases) {
    it(`${name}: the h1 and the document title`, () => {
      const data = dataFor(OUTLINE);
      const hashed = hash;
      expect(h1(render(data, hashed)), name).toBe(title);
      expect(documentTitle(data, parseHash(hashed))).toContain(title);
    });
  }

  it('keeps the entity\'s own name on an entity page', () => {
    const data = dataFor(OUTLINE);
    expect(h1(render(data, '#/product/domain/D1'))).toBe('domain one');
    expect(documentTitle(data, parseHash('#/product/domain/D1'))).toContain('domain one');
  });

  it('shows the chapter title in the crumbs of a page that has them', () => {
    const html = render(dataFor(OUTLINE), '#/product/business');
    expect(/<nav class="crumbs"[\s\S]*?<\/nav>/.exec(html)?.[0]).toContain('>C-overview</a>');
    expect(/<nav class="crumbs"[\s\S]*?<\/nav>/.exec(html)?.[0]).toContain('>C-business<');
  });

  it('falls back to the fixed title for a block the outline leaves out', () => {
    expect(h1(render(dataFor(OUTLINE), '#/product/glossary'))).toBe(`${MARK}${shipped.strings['md.appendix.glossaryHeading']}`);
    expect(h1(render(dataFor(OUTLINE), '#/technical/dictionaries'))).toBe(`${MARK}${shipped.strings['md.dict.heading']}`);
  });
});

describe('the coverage page and the outline', () => {
  const coverageOf = (html: string) => /<section class="section" data-part="outline-coverage"[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';

  it('says the written outline was used and lists each block it left out, with the reason', () => {
    const html = coverageOf(render(dataFor(OUTLINE), '#/technical/coverage'));
    expect(html).toContain(marked['md.coverage.outlineUsed']);
    expect(html).toContain('The glossary: R-glossary');
    expect(html).toContain('The dictionaries: R-dictionaries');
    expect(html).not.toContain(marked['md.coverage.outlineDefault']);
  });

  it('does not list a block only the technical view has in the product view', () => {
    const html = coverageOf(render(dataFor(OUTLINE), '#/product/coverage'));
    expect(html).toContain('The glossary: R-glossary');
    expect(html).not.toContain('R-dictionaries');
  });

  it('says the default outline was used when none was written', () => {
    const html = coverageOf(render(dataFor(defaultOutline(marked)), '#/product/coverage'));
    expect(html).toContain(marked['md.coverage.outlineDefault']);
    expect(html).not.toContain('data-part="outline-unplaced"');
  });

  it('says why the written outline was not used, with every problem line', () => {
    const failed: Outline = { ...defaultOutline(marked), problems: ['history: not placed; put it in a chapter', 'weather: is not a block'] };
    const html = coverageOf(render(dataFor(failed), '#/product/coverage'));
    expect(html).toContain(marked['md.coverage.outlineFailed']);
    expect(html).toContain('history: not placed; put it in a chapter');
    expect(html).toContain('weather: is not a block');
    expect(html).not.toContain(marked['md.coverage.outlineUsed']);
  });
});
