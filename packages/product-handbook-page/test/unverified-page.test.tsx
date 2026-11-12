// O1 (page half) of openspec change handbook-free-chapter: a feature written but not verified (a checked /3 entry) is marked with
// the fixed text on its page, in its domain's feature list and in the detail on its domain's page; its chapter is drawn (paragraphs,
// lists, tables, and each sequence diagram with its arrows numbered and their texts listed under it) without any citation; the coverage
// page counts it; a verified feature carries no mark; the chunk pieces of the chapter put back the same entry.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { splitPageData } from '../../../skills/excavator-product-handbook/lib/page-units.mjs';
import { AppView } from '../src/App';
import { assembleFeature } from '../src/lib/chunks';
import type { Piece } from '../src/lib/chunks';
import { parseHash } from '../src/lib/route';
import { PAGE_FORMAT } from '../src/lib/types';
import type { ChapterBlock, Entry, Feature, PageData } from '../src/lib/types';
import { NO_APPENDIX, NO_HISTORY } from './empty-parts';
import { defaultOutline } from './outline-fixture';

const MARK = '@@';
const shipped = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../skills/excavator-product-handbook/ui-strings.json'), 'utf-8')) as { strings: Record<string, string> };
const marked = Object.fromEntries(Object.entries(shipped.strings).map(([key, value]) => [key, `${MARK}${value}`]));
const NOTICE = marked['md.feature.unverified'];
const CHIP = marked['md.status.unverified'];

const chapter: ChapterBlock[] = [
  { kind: 'heading', level: 1, text: 'Chapter title' },
  { kind: 'paragraph', text: 'The clerk fills in the name. The count is limited.' },
  { kind: 'paragraph', text: 'Who can do what:' },
  { kind: 'list', ordered: false, text: 'First item' },
  { kind: 'list', ordered: false, text: 'Second item' },
  { kind: 'table', header: ['Role', 'Can do'], rows: [['Clerk', 'Creates an order']] },
  { kind: 'diagram', sequence: { participants: ['Clerk', 'System'], steps: [{ from: 0, to: 1 }, { from: 1, to: 0 }] }, arrows: ['Sends the order', 'Confirms the order'] },
];

const entry = (withChapter: boolean): Entry => ({
  purpose: 'a purpose',
  who: [{ role: 'a role', can: 'a thing' }],
  where: ['a menu'],
  screens: [{ name: 'a screen', fields: [] }],
  operations: [],
  states: [{ label: 'a state', meaning: 'a meaning' }],
  transitions: [],
  notifications: [],
  automatic: [],
  unknowns: [],
  ...(withChapter ? { handoffs: [{ feature: 'F1', text: 'goes to the first' }], chapter } : {}),
});

const feature = (id: string, unverified: boolean): Feature => ({
  id, name: `name ${id}`, area: 'A1', domain: 'D1', reach: 'menu', status: unverified ? 'checked' : 'verified', unverified, entry: entry(unverified), findingsStatus: 'planned',
});

function dataFor(): PageData {
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
      remedies: { finished: true, stale: false, dropped: [] }, topics: { finished: true, stale: false, entriesRead: 0, groupsRead: 0, lanes: [], dropped: [] },
      unverified: [{ feature: 'F2', notes: { number: 3, quote: 0, code: 1, advice: 0, language: 0 } }],
    },
    summary: { notifications: [], jobs: [], counts: { featureTotal: 2, featuresWithEntry: 2, notificationRows: 0, jobRows: 0, schedule: { literal: 0, computed: 0, absent: 0 }, described: 0 } },
    system: { status: 'planned', overview: null, applications: [], counts: { applications: 0, files: 0, lines: 0, areas: 0, features: 0, featuresWithEntry: 0, roles: 0 }, areas: [], domains: [] },
    entities: {
      domains: [{ id: 'D1', name: 'domain one', features: ['F1', 'F2'], purposes: [] }],
      roles: [], roleFeature: { roles: [], features: [], cells: [] },
    },
  } as unknown as PageData;
}

const render = (hash: string): string => renderToStaticMarkup(<AppView data={dataFor()} route={parseHash(hash)} />).replace(/<wbr\/>/g, '');
const anchorOf = (html: string, id: string): string => {
  const start = html.indexOf(`id="feature-${id}"`);
  if (start < 0) return '';
  const further = html.slice(start + 10).search(/id="feature-[A-Z0-9]+"/);
  const ends = [further < 0 ? -1 : further + start + 10, html.indexOf('data-part="domain-states"', start + 10)].filter((at) => at >= 0);
  return html.slice(start, ends.length === 0 ? undefined : Math.min(...ends));
};

describe('a feature written but not verified', () => {
  it('is marked on its page, with its chapter drawn and no operations section', () => {
    const html = render('#/product/feature/F2');
    expect(html).toContain(NOTICE);
    expect(html).toContain(CHIP);
    expect(html).toContain('The clerk fills in the name. The count is limited.');
    expect(html).toContain('Chapter title');
    expect(html).toMatch(/<ul class="plain-list"><li>First item<\/li><li>Second item<\/li><\/ul>/);
    expect(html).toContain('Creates an order');
    expect(html).toContain('data-part="chapter-diagram"');
    expect(html.match(/data-step="/g)).toHaveLength(2);
    expect(html).toContain('Sends the order');
    expect(html).toContain('Confirms the order');
    expect(html).not.toContain('data-part="operation"');
    expect(html).toContain('goes to the first');
  });

  it('has the mark in its domain\'s feature list row and in its detail there, and a verified feature has none', () => {
    const html = render('#/product/domain/D1');
    const list = /data-part="domain-features"[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';
    const rows = list.split('<li>').slice(1);
    expect(rows.find((row) => row.includes('name F2'))).toContain(CHIP);
    expect(rows.find((row) => row.includes('name F1'))).not.toContain(CHIP);
    expect(anchorOf(html, 'F2')).toContain(NOTICE);
    expect(anchorOf(html, 'F1')).not.toContain(NOTICE);
    expect(list).toContain('href="#feature-F2"');
  });

  it('is counted on the coverage page with the count of each kind of note, and is not listed as unwritten', () => {
    const html = render('#/product/coverage');
    expect(html).toContain('data-part="unverified-coverage"');
    expect(html).toContain('F2 name F2: number 3, quote 0, code 1, advice 0, language 0');
    expect(html).toContain('1 of 2 features are written but not verified.');
    const unwritten = /id="cov-unwritten"[\s\S]*?<\/section>/.exec(html)?.[0] ?? '';
    expect(unwritten).not.toContain('name F2');
  });

  it('puts the chapter back from its pieces as it was in the data', () => {
    const { units } = splitPageData(dataFor()) as { units: () => Iterable<{ key: string; pieces: Piece[] }> };
    const unit = [...units()].find((one) => one.key === 'feature:F2');
    expect(unit).toBeDefined();
    expect(unit!.pieces.filter((piece) => 'chapterBlock' in piece)).toHaveLength(chapter.length);
    expect(assembleFeature(undefined, unit!.pieces).entry).toEqual(entry(true));
  });
});
