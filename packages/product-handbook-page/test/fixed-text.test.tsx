// Oracle O8, node half (R8) of openspec change product-handbook-map: every
// fixed text the page shows comes from the data's ui table. The page is
// rendered to a string from data whose ui strings all start with a marker;
// the data's own text (names, labels, sentences) is given a different
// recognisable prefix. A visible text or a text attribute that carries neither
// is a fixed text the code wrote itself.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AppView } from '../src/App';
import { parseHash } from '../src/lib/route';
import type { Entry, Feature, PageData, Reach } from '../src/lib/types';

const MARK = '@@';
const DATA = 'd~';
const shipped = JSON.parse(readFileSync(fileURLToPath(new URL('../../../skills/excavator-product-handbook/ui-strings.json', import.meta.url)), 'utf-8')) as { strings: Record<string, string> };
const marked = Object.fromEntries(Object.entries(shipped.strings).map(([key, value]) => [key, `${MARK}${value}`]));

const d = (text: string): string => `${DATA}${text}`;

const fullEntry: Entry = {
  purpose: d('purpose'),
  who: [{ role: d('role one'), can: d('can one') }, { role: d('role two'), can: d('can two') }],
  where: [d('menu entry'), d('page entry')],
  screens: [
    {
      name: d('screen one'),
      fields: [
        { label: d('field one'), rules: [{ side: 'frontend', text: d('front rule') }, { side: 'backend', text: d('back rule one') }, { side: 'backend', text: d('back rule two') }] },
        { label: d('field two'), rules: [] },
      ],
    },
    { name: d('screen two'), fields: [] },
  ],
  operations: [{ name: d('operation'), sentences: [d('first sentence.'), d('second sentence.')] }],
  states: [{ label: d('state'), meaning: d('state meaning') }],
  notifications: [{ trigger: d('trigger'), recipient: d('recipient'), channel: d('channel'), content: d('content') }],
  automatic: [{ when: d('when'), effect: d('effect') }],
  unknowns: [{ item: d('unknown item'), searched: d('searched place') }],
};

const emptyEntry: Entry = { purpose: d('purpose'), who: [], where: [], screens: [], operations: [], states: [], notifications: [], automatic: [], unknowns: [] };

const reaches: Reach[] = ['menu', 'link', 'automated', 'interface', 'operator'];

function feature(id: string, reach: Reach, status: Feature['status'], entry: Entry | null, label?: string): Feature {
  return { id: d(id), name: d(`name ${id}`), area: d('A1'), reach, label: label === undefined ? undefined : d(label), status, entry };
}

function dataFor(features: Feature[], unassigned: PageData['coverage']['unassigned'] = []): PageData {
  return {
    format: 'excavator-product-handbook-page/1',
    project: d('project'),
    language: d('language'),
    languageTag: 'xx',
    ui: { strings: marked },
    areas: [{ id: d('A1'), name: d('area one') }, { id: d('A2'), name: d('area two') }],
    features,
    coverage: {
      candidateTotal: 9,
      assigned: 9 - unassigned.length,
      unassigned,
      reachCounts: reaches.map((reach) => ({ reach, count: features.filter((item) => item.reach === reach).length })),
    },
  };
}

const populated = dataFor(
  [
    feature('F1', 'menu', 'checked', fullEntry, 'menu label'),
    feature('F2', 'link', 'planned', null, 'link label'),
    feature('F3', 'automated', 'dispatched', null),
    feature('F4', 'interface', 'failed', null),
    feature('F5', 'operator', 'checked', emptyEntry),
  ],
  [{ candidate: d('c7'), kind: 'route', reason: d('why') }, { candidate: d('c8'), kind: 'job', reason: d('why too') }],
);
const allWritten = dataFor([feature('F1', 'menu', 'checked', emptyEntry)]);

/** Decode the few entities React writes into markup. */
const decode = (text: string): string => text.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Every visible text node and every text attribute of the markup. */
function visibleTexts(html: string): string[] {
  const nodes = html.split(/<[^>]*>/).map((text) => decode(text).trim()).filter((text) => text !== '');
  const attributes = Array.from(html.matchAll(/\s(?:aria-label|title|alt|placeholder|aria-description)="([^"]*)"/g), (match) => decode(match[1]).trim());
  return [...nodes, ...attributes];
}

/** The texts that carry neither the ui marker nor the data prefix (a bare number, a count, is data). */
function unmarked(html: string): string[] {
  return visibleTexts(html).filter((text) => !text.includes(MARK) && !(text.startsWith(DATA) && !text.includes('@')) && !/^\d+$/.test(text));
}

const render = (data: PageData, hash: string): string => renderToStaticMarkup(<AppView data={data} route={parseHash(hash)} />);

const featureId = (data: PageData, index: number): string => encodeURIComponent(data.features[index].id);

describe('every fixed text of the page comes from the ui table (O8, node half)', () => {
  const views: [string, PageData, string][] = [
    ['the overview', populated, '#/'],
    ['a feature with every section filled', populated, `#/feature/${featureId(populated, 0)}`],
    ['a feature whose sections are all empty', populated, `#/feature/${featureId(populated, 4)}`],
    ['a feature with no checked entry (planned)', populated, `#/feature/${featureId(populated, 1)}`],
    ['a feature with no checked entry (failed)', populated, `#/feature/${featureId(populated, 3)}`],
    ['the coverage view with unassigned candidates and unwritten features', populated, '#/coverage'],
    ['the coverage view with nothing unassigned and every feature written', allWritten, '#/coverage'],
    ['an address that is not a page', populated, '#/nowhere'],
    ['a feature id the handbook does not have', populated, '#/feature/missing'],
  ];

  for (const [name, data, hash] of views) {
    it(`${name}: no text without the marker or the data prefix`, () => {
      const html = render(data, hash);
      expect(visibleTexts(html).length).toBeGreaterThan(3);
      expect(unmarked(html)).toEqual([]);
    });
  }

  it('shows the data text and the marked fixed text together (the fixture reaches the page)', () => {
    const html = render(populated, `#/feature/${featureId(populated, 0)}`);
    for (const text of ['purpose', 'role one', 'front rule', 'back rule two', 'operation', 'trigger', 'searched place', 'menu label']) expect(html).toContain(d(text));
    for (const key of ['md.section.purpose', 'md.table.frontendRules', 'md.table.channel', 'md.section.unknowns', 'page.breadcrumb.label']) expect(html).toContain(marked[key]);
  });

  it('the instrument sees a fixed text the code wrote itself', () => {
    expect(unmarked('<main><button>Save</button><p>@@Purpose</p><p>d~name</p><a aria-label="Menu">x</a></main>')).toEqual(['Save', 'x', 'Menu']);
  });
});
