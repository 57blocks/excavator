// O3 (page) of openspec change handbook-system-name: the top bar, the browser
// title and the eyebrow of every page show the verified system name, or the
// fixed text that says the code has none; never the directory of the project.
// The page is rendered to a string from synthetic data whose fixed texts all
// start with a marker and whose own text starts with another.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AppView, documentTitle } from '../src/App';
import { parseHash } from '../src/lib/route';
import { PAGE_FORMAT } from '../src/lib/types';
import type { PageData, Summary, System, Technical } from '../src/lib/types';

const MARK = '@@';
const DATA = 'd~';
const shipped = JSON.parse(readFileSync(fileURLToPath(new URL('../../../skills/excavator-product-handbook/ui-strings.json', import.meta.url)), 'utf-8')) as { strings: Record<string, string> };
const marked = Object.fromEntries(Object.entries(shipped.strings).map(([key, value]) => [key, `${MARK}${value}`]));
const d = (text: string): string => `${DATA}${text}`;

const summary: Summary = {
  notifications: [],
  jobs: [],
  counts: { featureTotal: 0, featuresWithEntry: 0, notificationRows: 0, jobRows: 0, schedule: { literal: 0, computed: 0, absent: 0 }, described: 0 },
};
const system: System = {
  status: 'planned',
  overview: null,
  applications: [],
  counts: { applications: 0, files: 0, lines: 0, areas: 0, features: 0, featuresWithEntry: 0, roles: 0 },
  areas: [],
  domains: [],
};
const technical: Technical = {
  featureApplication: [],
  unattributed: [],
  applicationDomain: { applications: [], domains: [], cells: [], unattributed: [] },
  integrations: [],
  jobs: [],
  locations: [],
  data: null,
  dataState: 'missing',
  dictionaries: null,
  dictionariesState: 'missing',
  findingLocations: [],
  topicLocations: [],
};

const dataFor = (project: string | null): PageData => ({
  format: PAGE_FORMAT,
  project,
  language: d('language'),
  languageTag: 'xx',
  ui: { strings: marked },
  views: ['product', 'technical'],
  areas: [],
  domains: [],
  domainBasis: 'areas',
  features: [],
  findings: [],
  remedies: { categories: [], recommendations: [] },
  topics: { approval: [], time: [], handoffs: [], access: [], repeated: [] },
  coverage: { candidateTotal: 0, assigned: 0, unassigned: [], reachCounts: [], removedOverview: [], removed: [], findingsUnfinished: [], findingsNotWritten: 0, findingsRemoved: [], systemFindingsTotal: 0, systemFindingsUnfinished: [], systemFindingsNotWritten: 0, systemFindingsRemoved: [], priority: { finished: true, unranked: [] }, remedies: { finished: true, stale: false, dropped: [] }, topics: { finished: true, stale: false, entriesRead: 0, groupsRead: 0, lanes: [], dropped: [] } },
  summary,
  system,
  entities: { domains: [], roles: [], roleFeature: { roles: [], features: [], cells: [] } },
  technical,
});

const render = (data: PageData, hash: string): string => renderToStaticMarkup(<AppView data={data} route={parseHash(hash)} />);
const decode = (text: string): string => text.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const textsOf = (html: string, pattern: RegExp): string[] => Array.from(html.matchAll(pattern), (match) => decode(match[1]));
const eyebrows = (html: string): string[] => textsOf(html, /<p class="eyebrow">([^<]*)<\/p>/g);
const brand = (html: string): string[] => textsOf(html, /<span class="brand-project">([^<]*)<\/span>/g);

const NAMED = d('Acme Portal');
const MISSING = `${MARK}${shipped.strings['page.systemNameMissing']}`;
const HASHES = ['#/product', '#/product/coverage', '#/product/notifications', '#/product/jobs', '#/product/matrix/roles', '#/technical/matrix/applications', '#/technical/data', '#/technical/dictionaries'];

describe('the page data format', () => {
  it('is version 10: the project is the system name or null, the findings are groups', () => {
    expect(PAGE_FORMAT).toBe('excavator-product-handbook-page/13');
  });
});

describe('the top bar and the eyebrows show the system name', () => {
  for (const hash of HASHES) {
    it(`${hash}: the verified name in the bar and in the eyebrow`, () => {
      const html = render(dataFor(NAMED), hash);
      expect(brand(html)).toEqual([NAMED]);
      expect(eyebrows(html)).toEqual([NAMED]);
    });

    it(`${hash}: the fixed text that says there is no name when the project is null, and no other word of it`, () => {
      const html = render(dataFor(null), hash);
      expect(brand(html)).toEqual([MISSING]);
      expect(eyebrows(html)).toEqual([MISSING]);
      expect(html).not.toContain('null');
    });
  }

  it('the overview page has the name too (the first page, with its own route)', () => {
    expect(eyebrows(render(dataFor(NAMED), '#/product'))).toEqual([NAMED]);
    expect(eyebrows(render({ ...dataFor(NAMED), views: ['product'] }, '#/'))).toEqual([NAMED]);
  });
});

describe('the browser title', () => {
  it('has the name between the page and the handbook when there is one', () => {
    const title = documentTitle(dataFor(NAMED), parseHash('#/product'));
    expect(title).toBe(`${MARK}${MARK}Overview - ${NAMED} - Product handbook`);
  });

  it('has no name, no directory and no placeholder when there is none: the variant that holds only the page', () => {
    const title = documentTitle(dataFor(null), parseHash('#/product'));
    expect(title).toBe(`${MARK}${MARK}Overview - Product handbook`);
    expect(title).not.toContain(DATA);
    expect(title).not.toContain('{');
  });

  it('writes the title of a page that does not exist the same way, with the name or without it', () => {
    expect(documentTitle(dataFor(NAMED), parseHash('#/nowhere'))).toBe(`${MARK}${MARK}Page not found - ${NAMED} - Product handbook`);
    expect(documentTitle(dataFor(null), parseHash('#/nowhere'))).toBe(`${MARK}${MARK}Page not found - Product handbook`);
  });
});

describe('the new fixed texts', () => {
  it('are in the shipped table, with no apostrophe, and the title patterns keep their placeholders', () => {
    for (const key of ['page.systemNameMissing', 'page.documentTitleNoName', 'md.titleNamed', 'md.titleTechnicalNamed', 'md.overview.nameMissing', 'md.overview.systemName']) {
      expect(Object.prototype.hasOwnProperty.call(shipped.strings, key), key).toBe(true);
      expect(shipped.strings[key].includes("'"), key).toBe(false);
      expect(/^[\x20-\x7E]+$/.test(shipped.strings[key]), key).toBe(true);
    }
    expect(shipped.strings['page.documentTitleNoName']).toContain('{page}');
    expect(shipped.strings['page.documentTitleNoName']).not.toContain('{project}');
    expect(shipped.strings['md.titleNamed']).toContain('{name}');
    expect(shipped.strings['md.titleTechnicalNamed']).toContain('{name}');
  });
});
