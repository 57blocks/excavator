// @vitest-environment happy-dom
// O2 (page) of openspec change handbook-status-dictionary: the technical view
// has the route #/dictionaries, a sidebar link and a page of the value sets,
// filterable by application and searchable by name; the product view has
// neither (the route there is not-found); a missing or malformed
// dictionaries.json is one line; every fixed text comes from the ui table.
// The data is written by hand with a prefix on every data text, so a fixed text
// the code wrote itself is found by the absence of both markers.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';

import { AppView } from '../src/App';
import { filterDictionaries } from '../src/components/DictionariesPage';
import { parseHash, routeHash } from '../src/lib/route';
import type { DictionariesSection, DictionaryEntry, PageData, View } from '../src/lib/types';
import { switchTarget } from '../src/lib/views';
import { choose, cleanup, mount, openWithKeyboard, optionTexts, selectByLabel, status as statusOf, typeInto } from './dom';
import { NO_APPENDIX, NO_HISTORY } from './empty-parts';

const MARK = '@@';
const DATA = 'd~';
const shipped = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../skills/excavator-product-handbook/ui-strings.json'), 'utf-8')) as { strings: Record<string, string> };
const marked = Object.fromEntries(Object.entries(shipped.strings).map(([key, value]) => [key, `${MARK}${value}`]));
const d = (text: string): string => `${DATA}${text}`;

const member = (name: string, value: string | number | null, extra: Partial<DictionaryEntry['members'][number]> = {}): DictionaryEntry['members'][number] => ({
  name: d(name), value, computed: value !== null && !extra.reason, file: d('src/a.go'), line: 5, comments: [], labels: [], ...extra,
});
const entry = (id: string, application: string, form: DictionaryEntry['form'], name: string, file: string, members: DictionaryEntry['members'], extra: Partial<DictionaryEntry> = {}): DictionaryEntry => ({
  id: d(id), application: application === '' ? '' : d(application), form, name: d(name), file: d(file), line: 3, members, skippedMembers: 0, ...extra,
});

/** Five value sets in three applications (one of them the "in no application" bucket); `Status` has every kind of member cell. */
const status = entry('go-app/status.go:Status', 'go-app', 'go-type', 'Status', 'go-app/status.go', [
  member('StatusDraft', 1, { comments: [{ text: d('the first state'), file: d('go-app/status.go'), line: 4, where: 'above' }], labels: [{ text: d('Draft'), file: d('go-app/labels.go'), line: 6 }, { text: d('Draft (api)'), file: d('go-app/api.go'), line: 9 }] }),
  member('StatusOpen', d('open'), {}),
  member('StatusLegacy', d('base + 1'), { computed: false, reason: 'expression' }),
  member('StatusAfter', null, { computed: false, reason: 'after-uncomputed' }),
], { baseType: 'int', skippedMembers: 2 });
const web = entry('web-app/src/status.ts:Status', 'web-app', 'ts-enum', 'Status', 'web-app/src/status.ts', [member('Draft', 1), member('Archived', 5)]);
const kind = entry('go-app/kind.go:Kind', 'go-app', 'go-type', 'Kind', 'go-app/kind.go', [member('KindA', d('a'))], { baseType: 'string' });
const retry = entry('web-app/src/consts.ts:RetryMode', 'web-app', 'ts-const-object', 'RetryMode', 'web-app/src/consts.ts', [member('Fast', 1)]);
const loose = entry('tools/states.js:OrderState', '', 'js-object', 'OrderState', 'tools/states.js', [member('open', 1)]);

const section: DictionariesSection = {
  recognized: ['go-named-type', 'go-typed-var', 'ts-enum', 'ts-const-object', 'js-object', 'js-record-member'],
  applications: [{ directory: d('go-app'), dictionaries: 2 }, { directory: d('web-app'), dictionaries: 2 }, { directory: '', dictionaries: 1 }],
  dictionaries: [kind, status, retry, web, loose],
  mismatches: [{
    key: 'status',
    left: { id: d('go-app/status.go:Status'), application: d('go-app'), name: d('Status') },
    right: { id: d('web-app/src/status.ts:Status'), application: d('web-app'), name: d('Status') },
    onlyLeft: [],
    onlyRight: [{ value: 5, members: [d('Archived')] }],
    both: [{ value: 1, left: [d('StatusDraft')], right: [d('Draft')] }],
    uncompared: { left: [d('StatusLegacy')], right: [] },
  }],
  counts: {
    dictionaries: { total: 5, goType: 2, tsEnum: 1, tsConstObject: 1, jsObject: 1 },
    members: { total: 9, computed: 7, notComputed: 2 },
    comments: 1,
    labels: 2,
    skippedMembers: 2,
    candidates: {
      goTypes: { total: 3, dictionary: 2, noConstants: 1, duplicate: 0 },
      goConstants: { total: 8, member: 5, untypedIota: 1, otherType: 1, plain: 1 },
      goVars: { total: 3, member: 2, otherType: 1 },
      tsEnums: { total: 1, dictionary: 1 },
      tsConstObjects: { total: 2, dictionary: 1, noLiteralMembers: 1 },
      jsObjects: { total: 1, dictionary: 1, noLiteralMembers: 0 },
      mapEntries: { total: 3, label: 2, unmatchedKey: 1, ambiguousKey: 0 },
    },
    mismatches: 1,
  },
};

function dataFor(views: View[], dictionaries: DictionariesSection | null = section, dictionariesState: 'ok' | 'missing' | 'malformed' = 'ok'): PageData {
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
    features: [],
    findings: [],
    remedies: { categories: [], recommendations: [] },
    topics: { approval: [], time: [], handoffs: [], access: [], repeated: [] },
    history: NO_HISTORY,
    appendix: NO_APPENDIX,
    coverage: { candidateTotal: 0, assigned: 0, unassigned: [], reachCounts: [], removedOverview: [], removed: [], findingsUnfinished: [], findingsNotWritten: 0, findingsRemoved: [], systemFindingsTotal: 0, systemFindingsUnfinished: [], systemFindingsNotWritten: 0, systemFindingsRemoved: [], priority: { finished: true, unranked: [] }, remedies: { finished: true, stale: false, dropped: [] }, topics: { finished: true, stale: false, entriesRead: 0, groupsRead: 0, lanes: [], dropped: [] } },
    summary: { notifications: [], jobs: [], counts: { featureTotal: 0, featuresWithEntry: 0, notificationRows: 0, jobRows: 0, schedule: { literal: 0, computed: 0, absent: 0 }, described: 0 } },
    system: { status: 'planned', overview: null, applications: [], counts: { applications: 0, files: 0, lines: 0, areas: 1, domains: 1, features: 0, featuresWithEntry: 0, roles: 0 }, areas: [], domains: [] },
    entities: { domains: [{ id: 'D1', name: d('domain'), features: [], purposes: [] }], roles: [], roleFeature: { roles: [], features: [], cells: [] } },
    ...(views.includes('technical') ? {
      technical: {
        featureApplication: [], unattributed: [], applicationDomain: { applications: [], domains: [], cells: [], unattributed: [] },
        integrations: [], jobs: [], locations: [], findingLocations: [], topicLocations: [], history: { hotspots: [], coChange: [] }, data: null, dataState: 'missing' as const, dictionaries, dictionariesState,
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
const setBlock = (body: string, id: string): string => {
  const start = body.indexOf(`data-set="${d(id)}"`);
  expect(start, id).toBeGreaterThan(0);
  return body.slice(start, body.indexOf('</section>', start));
};

describe('the dictionaries route and link', () => {
  it('parses #/dictionaries with and without the view and builds it back', () => {
    expect(parseHash('#/dictionaries')).toEqual({ name: 'dictionaries' });
    expect(parseHash('#/technical/dictionaries')).toEqual({ name: 'dictionaries', view: 'technical' });
    expect(parseHash('#/technical/dictionaries/x').name).toBe('not-found');
    expect(routeHash({ name: 'dictionaries' }, null)).toBe('#/dictionaries');
    expect(routeHash({ name: 'dictionaries' }, 'technical')).toBe('#/technical/dictionaries');
  });

  it('the technical view has the sidebar link and the page; the product view has neither', () => {
    const data = dataFor(BOTH);
    const technical = render(data, '#/technical');
    expect(railOf(technical)).toContain('href="#/technical/dictionaries"');
    expect(railOf(technical)).toContain(marked['md.dict.heading']);
    const product = render(data, '#/product');
    expect(railOf(product)).not.toContain('/dictionaries"');
    expect(product).not.toContain('data-view="dictionaries"');
  });

  it('the route in the product view, or in a page without the technical view, is the not-found page', () => {
    expect(render(dataFor(BOTH), '#/product/dictionaries')).toContain('data-view="not-found"');
    expect(render(dataFor(['product']), '#/dictionaries')).toContain('data-view="not-found"');
    expect(render(dataFor(['product']), '#/technical/dictionaries')).toContain('data-view="not-found"');
    expect(render(dataFor(BOTH), '#/product/dictionaries')).not.toContain(d('RetryMode'));
    expect(render(dataFor(['technical']), '#/dictionaries')).toContain('data-view="dictionaries"');
  });

  it('switching from the page goes to the overview of the product view, and into it stays on the page', () => {
    const data = dataFor(BOTH);
    expect(switchTarget(data, parseHash('#/technical/dictionaries'), 'product')).toBe('#/product');
    expect(switchTarget(data, parseHash('#/product/dictionaries'), 'technical')).toBe('#/technical/dictionaries');
  });
});

describe('the dictionaries page', () => {
  const body = main(render(dataFor(BOTH), '#/technical/dictionaries'));

  it('shows the fixed notes, the recognized forms, the count cards and the candidates line', () => {
    for (const key of ['md.dict.note.nameRule', 'md.dict.note.sources', 'md.dict.note.values']) expect(body, key).toContain(marked[key]);
    expect(body).toContain(`${MARK}Forms of value set recognized in this version: ${['goNamedType', 'goTypedVar', 'tsEnum', 'tsConstObject', 'jsObject', 'jsRecordMember'].map((form) => marked[`md.dict.form.${form}`]).join('; ')}.`);
    expect(body).toContain('data-part="dict-stats"');
    expect(body).toContain(`${MARK}Candidates that are not value sets: 1 Go types without constants or variables, 0 Go types declared again, 1 untyped iota constants, 1 constants of another type, 1 plain constants, 1 variables of another type, 1 TS const objects without literal members, 0 JS objects without literal members. Mapping table entries that name no member: 1. Mapping table entries that name more than one member: 0.`);
  });

  it('lists the same names with different values, with the side that has a value alone, the values both have and the members not compared', () => {
    const start = body.indexOf('data-part="dict-mismatches"');
    const list = body.slice(start, body.indexOf('<h2', start));
    expect(list).toContain(`${MARK}${MARK}${d('go-app/status.go:Status')} (${d('go-app')}) and ${MARK}${d('web-app/src/status.ts:Status')} (${d('web-app')})`);
    expect(list).toContain(`${MARK}Only in ${MARK}${d('web-app/src/status.ts:Status')} (${d('web-app')}): ${MARK}5 (${d('Archived')})`);
    expect(list).toContain(`${MARK}In both: ${MARK}1 (${d('StatusDraft')} / ${d('Draft')})`);
    expect(list).toContain(`${MARK}Not compared, value not computed in ${MARK}${d('go-app/status.go:Status')} (${d('go-app')}): ${d('StatusLegacy')}`);
  });

  it('groups the value sets by application and by file, in the order of the list, each as a table with the members', () => {
    const order = [d('go-app'), d('web-app'), marked['md.data.noApplication']].map((name) => body.indexOf(`${MARK}Application ${name}`));
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const sets = [...body.matchAll(/data-set="([^"]*)"/g)].map((match) => match[1]);
    expect(sets).toEqual([d('go-app/kind.go:Kind'), d('go-app/status.go:Status'), d('web-app/src/consts.ts:RetryMode'), d('web-app/src/status.ts:Status'), d('tools/states.js:OrderState')]);
    expect(body).toContain(`${MARK}Go named type (int), declared at ${MARK}${d('go-app/status.go')}, line 3.`);
    expect(body).toContain(`${MARK}TypeScript object ending in as const, declared at ${MARK}${d('web-app/src/consts.ts')}, line 3.`);
    expect(body).toContain(`${MARK}Parts of the declaration that were not read as members: 2.`);
  });

  it('writes a set whose members carry comments or display names as blocks: name, value and place on the first line, the comment as the body, the display names under it', () => {
    const block = setBlock(body, 'go-app/status.go:Status');
    expect(block).not.toContain('<table');
    const items = block.split('<li class="item"').slice(1);
    expect(items).toHaveLength(4);
    expect(items[0]).toContain(d('StatusDraft'));
    expect(items[0]).toContain('<code class="item-code">1</code>');
    expect(items[0]).toContain(`${MARK}${d('Draft')} (${MARK}${d('go-app/labels.go')}, line 6)`);
    expect(items[0]).toContain(`${MARK}${d('Draft (api)')} (${MARK}${d('go-app/api.go')}, line 9)`);
    expect(items[0]).toContain(d('the first state'));
    expect(items[0]).toContain(`${MARK}${d('src/a.go')}, line 5`);
    expect(items[0].indexOf('item-attrs')).toBeLessThan(items[0].indexOf('item-body'));
    expect(items[0].indexOf('item-body')).toBeLessThan(items[0].indexOf('item-note'));
    expect(items[1]).toContain(`<code class="item-code" data-kind="string">${d('open')}</code>`);
    expect(items[1]).not.toContain('item-body');
    expect(items[2]).toContain(`${MARK}${d('base + 1')} (not computed)`);
    expect(items[3]).toContain(`${MARK}not computed`);
  });

  it('writes a set of bare members, all short values, as a table of member, value and place', () => {
    const block = setBlock(body, 'web-app/src/status.ts:Status');
    expect(block).toContain('<table');
    expect(block).toContain(`<th scope="col">${marked['md.dict.table.member']}</th>`);
    expect(block).not.toContain(marked['md.dict.table.comment']);
    const rows = block.split('<tr>').slice(2).map((row) => row.slice(0, row.indexOf('</tr>')));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('<td class="num">1</td>');
    expect(rows[0]).toContain(`${MARK}${d('src/a.go')}, line 5`);
  });

  it('has the application filter with every application and the search box', () => {
    expect(body).toContain(marked['page.dict.filter.application']);
    expect(body).toContain(marked['page.dict.filter.all']);
    expect(body).toContain(marked['page.dict.filter.search']);
    expect(body).toContain(`${MARK}Showing 5 of 5 value sets`);
  });
});

describe('the styled application select, the search box and the count strip (handbook-page-layout)', () => {
  afterEach(cleanup);
  const page = (): HTMLElement => mount(<AppView data={dataFor(BOTH)} route={parseHash('#/technical/dictionaries')} />);
  const APPLICATION = marked['page.dict.filter.application'];
  const shownSets = (host: HTMLElement): number => host.querySelectorAll('[data-set]').length;

  it('opens with the keyboard, lists every application and filters the value sets', async () => {
    const host = page();
    expect(host.querySelectorAll('select')).toHaveLength(0);
    expect(statusOf(host)).toBe(`${MARK}Showing 5 of 5 value sets`);
    await openWithKeyboard(selectByLabel(host, APPLICATION));
    expect(optionTexts()).toEqual([marked['page.dict.filter.all'], d('go-app'), d('web-app'), marked['md.data.noApplication']]);
    cleanup();
    const again = page();
    await choose(again, APPLICATION, d('web-app'));
    expect(statusOf(again)).toBe(`${MARK}Showing 2 of 5 value sets`);
    expect(shownSets(again)).toBe(2);
  });

  it('the search box is a styled input that narrows the list together with the select', async () => {
    const host = page();
    const input = host.querySelector<HTMLInputElement>('input[type="search"]');
    expect(input?.className).toContain('field-control');
    typeInto(input as HTMLInputElement, 'status');
    expect(statusOf(host)).toBe(`${MARK}Showing 2 of 5 value sets`);
    await choose(host, APPLICATION, d('go-app'));
    expect(statusOf(host)).toBe(`${MARK}Showing 1 of 5 value sets`);
    expect(shownSets(host)).toBe(1);
  });

  it('renders the value set counts as an inline strip, not cards', () => {
    const host = page();
    expect(host.querySelector('[data-part="dict-stats"]')?.className).toBe('stat-strip');
    expect(host.querySelector('.stat-card, .stat-grid')).toBeNull();
    const cards = Object.fromEntries(Array.from(host.querySelectorAll('[data-part="dict-stats"] [data-part="stat"]')).map((card) => [card.querySelector('dt')?.textContent, card.querySelector('dd')?.textContent]));
    expect(cards).toEqual({
      [marked['page.stat.valueSets']]: '5',
      [marked['page.stat.members']]: '9',
      [marked['page.stat.membersComputed']]: '7',
      [marked['page.stat.membersNotComputed']]: '2',
      [marked['page.stat.comments']]: '1',
      [marked['page.stat.displayNames']]: '2',
      [marked['page.stat.mismatches']]: '1',
      [marked['page.stat.skippedMembers']]: '2',
    });
  });
});

describe('the filter', () => {
  const list = section.dictionaries;
  const names = (found: DictionaryEntry[]): string[] => found.map((item) => item.name);

  it('takes every value set with no application and an empty query, and does not change the list', () => {
    const copy = JSON.stringify(list);
    expect(filterDictionaries(list, null, '')).toHaveLength(5);
    expect(JSON.stringify(list)).toBe(copy);
  });

  it('takes the sets of one application, the "in no application" bucket included', () => {
    expect(names(filterDictionaries(list, d('web-app'), ''))).toEqual([d('RetryMode'), d('Status')]);
    expect(names(filterDictionaries(list, '', ''))).toEqual([d('OrderState')]);
    expect(filterDictionaries(list, d('missing-app'), '')).toEqual([]);
  });

  it('takes the sets whose name holds the query, in any case, and a query with spaces around it', () => {
    expect(names(filterDictionaries(list, null, 'STATUS'))).toEqual([d('Status'), d('Status')]);
    expect(names(filterDictionaries(list, null, '  retry '))).toEqual([d('RetryMode')]);
    expect(filterDictionaries(list, null, 'nothing')).toEqual([]);
  });

  it('applies both together', () => {
    expect(names(filterDictionaries(list, d('go-app'), 'status'))).toEqual([d('Status')]);
    expect(filterDictionaries(list, d('go-app'), 'retry')).toEqual([]);
  });
});

describe('a section that is missing or malformed', () => {
  it('is the heading and one line, and no value set', () => {
    for (const [state, key] of [['missing', 'md.dict.notWritten'], ['malformed', 'md.dict.malformed']] as const) {
      const html = render(dataFor(BOTH, null, state), '#/technical/dictionaries');
      expect(main(html)).toContain(marked[key]);
      expect(main(html)).not.toContain('data-set=');
      expect(main(html).match(/data-part="dict-status"/g)?.length, state).toBe(1);
    }
  });
});

describe('every fixed text of the dictionaries page comes from the ui table', () => {
  const empty: DictionariesSection = { ...section, dictionaries: [], mismatches: [], applications: [] };
  for (const [name, data, hash] of [
    ['full', dataFor(BOTH), '#/technical/dictionaries'],
    ['no value set and no mismatch', dataFor(BOTH, empty), '#/technical/dictionaries'],
    ['missing', dataFor(BOTH, null, 'missing'), '#/technical/dictionaries'],
    ['malformed', dataFor(['technical'], null, 'malformed'), '#/dictionaries'],
    ['not found in the product view', dataFor(BOTH), '#/product/dictionaries'],
  ] as const) {
    it(name, () => {
      const html = render(data, hash);
      expect(visibleTexts(html).length).toBeGreaterThan(3);
      expect(unmarked(html)).toEqual([]);
    });
  }
});
