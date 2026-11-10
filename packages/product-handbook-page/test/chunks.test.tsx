// @vitest-environment happy-dom
// O2 of openspec change handbook-page-chunked-data: one loading function gives the same data in both forms of
// the page (from the core when the page has no part files, from the parts when it has), a feature page, the
// dictionaries page and the data page show a loading state and then their detail, a part that is missing is
// named on the page that needs it and the other pages still work, and a table or list of more than 200 rows is
// shown 200 rows at a time. The expectations are written by hand; the part files are made by the script's own
// split (page-units.mjs), so the two merges are held together.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';

import { splitPageData } from '../../../skills/excavator-product-handbook/lib/page-units.mjs';
import { AppView } from '../src/App';
import { Cell, TableScroll } from '../src/components/Tables';
import { Item, ItemList } from '../src/components/ui/ItemList';
import { LoaderContext, assembleDictionaries, assembleFeature, createLoader, installPartRegistry } from '../src/lib/chunks';
import type { Loader, PartWindow, Piece } from '../src/lib/chunks';
import { TextContext, makeText } from '../src/lib/text';
import { parseHash } from '../src/lib/route';
import type { DictionariesSection, Entry, PageData } from '../src/lib/types';
import { cleanup, mount, settle } from './dom';
import { NO_APPENDIX, NO_HISTORY } from './empty-parts';

const MARK = '@@';
const DATA = 'd~';
const shipped = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../skills/excavator-product-handbook/ui-strings.json'), 'utf-8')) as { strings: Record<string, string> };
const marked = Object.fromEntries(Object.entries(shipped.strings).map(([key, value]) => [key, `${MARK}${value}`]));
const d = (text: string): string => `${DATA}${text}`;

afterEach(cleanup);

const entry: Entry = {
  purpose: d('purpose'),
  who: [{ role: d('role'), can: d('can') }],
  where: [d('menu')],
  screens: [{ name: d('screen one'), fields: [] }, { name: d('screen two'), fields: [] }],
  operations: [{ name: d('operation one'), sentences: [d('a sentence.')], triggers: [], calculations: [], changes: [], edges: [], handoffs: [], sequence: { participants: [d('starter'), d('app')], steps: [{ from: 0, to: 1 }] } }],
  states: [],
  transitions: [],
  notifications: [],
  automatic: [],
  unknowns: [],
};
const locations = { id: 'F1', items: [{ claim: d('claim one'), citations: [{ file: d('a.js'), startLine: 1, endLine: 2 }] }, { claim: d('claim two'), citations: [{ file: d('b.js'), startLine: 3, endLine: 3 }] }] };
const dictionary = (id: string) => ({ id: d(id), application: d('app'), form: 'ts-enum' as const, name: d(id), file: d('a.ts'), line: 1, members: [{ name: d('M'), value: 1, computed: true, file: d('a.ts'), line: 2, comments: [], labels: [] }], skippedMembers: 0 });
const counts: DictionariesSection['counts'] = {
  dictionaries: { total: 2, goType: 0, tsEnum: 2, tsConstObject: 0, jsObject: 0 },
  members: { total: 2, computed: 2, notComputed: 0 },
  comments: 0,
  labels: 0,
  skippedMembers: 0,
  candidates: {
    goTypes: { total: 0, dictionary: 0, noConstants: 0, duplicate: 0 },
    goConstants: { total: 0, member: 0, untypedIota: 0, otherType: 0, plain: 0 },
    goVars: { total: 0, member: 0, otherType: 0 },
    tsEnums: { total: 2, dictionary: 2 },
    tsConstObjects: { total: 0, dictionary: 0, noLiteralMembers: 0 },
    jsObjects: { total: 0, dictionary: 0, noLiteralMembers: 0 },
    mapEntries: { total: 0, label: 0, unmatchedKey: 0, ambiguousKey: 0 },
  },
  mismatches: 0,
};
const section: DictionariesSection = { recognized: ['ts-enum'], applications: [{ directory: d('app'), dictionaries: 2 }], dictionaries: [dictionary('Alpha'), dictionary('Beta')], mismatches: [], counts };

/** A page whose F1 has a verified entry with source locations and whose dictionaries are written; F2 has no entry. */
function fullData(): PageData {
  return {
    format: 'excavator-product-handbook-page/17',
    chunks: { parts: [], units: {} },
    project: d('project'),
    language: d('language'),
    languageTag: 'xx',
    ui: { strings: marked },
    views: ['product', 'technical'],
    areas: [{ id: 'A1', name: d('area') }],
    domains: [{ id: 'D1', name: d('domain') }],
    domainBasis: 'domains',
    features: [
      { id: 'F1', name: d('feature one'), area: 'A1', domain: 'D1', reach: 'menu', status: 'verified', entry, findingsStatus: 'planned' },
      { id: 'F2', name: d('feature two'), area: 'A1', domain: 'D1', reach: 'menu', status: 'planned', entry: null, findingsStatus: 'planned' },
    ],
    findings: [],
    remedies: { categories: [], recommendations: [] },
    topics: { approval: [], time: [], handoffs: [], access: [], repeated: [] },
    history: NO_HISTORY,
    appendix: NO_APPENDIX,
    coverage: { candidateTotal: 0, assigned: 0, unassigned: [], reachCounts: [], removedOverview: [], removed: [], findingsUnfinished: [], findingsNotWritten: 0, findingsRemoved: [], systemFindingsTotal: 0, systemFindingsUnfinished: [], systemFindingsNotWritten: 0, systemFindingsRemoved: [], priority: { finished: true, unranked: [] }, remedies: { finished: true, stale: false, dropped: [] }, topics: { finished: true, stale: false, entriesRead: 0, groupsRead: 0, lanes: [], dropped: [] } },
    summary: { notifications: [], jobs: [], counts: { featureTotal: 2, featuresWithEntry: 1, notificationRows: 0, jobRows: 0, schedule: { literal: 0, computed: 0, absent: 0 }, described: 0 } },
    system: { status: 'planned', overview: null, applications: [], counts: { applications: 0, files: 0, lines: 0, areas: 1, domains: 1, features: 2, featuresWithEntry: 1, roles: 0 }, areas: [], domains: [] },
    entities: { domains: [{ id: 'D1', name: d('domain'), features: ['F1', 'F2'], purposes: [] }], roles: [], roleFeature: { roles: [], features: [], cells: [] } },
    technical: {
      featureApplication: [], unattributed: [], applicationDomain: { applications: [], domains: [], cells: [], unattributed: [] },
      integrations: [], jobs: [], locations: [locations], findingLocations: [], topicLocations: [], history: { hotspots: [], coChange: [] },
      data: null, dataState: 'missing', dictionaries: section, dictionariesState: 'ok',
    },
  };
}

/** The page data as a chunked run writes it: the core and the parts, the first part holding F1 and the second the dictionaries. */
function chunkedData(): { core: PageData; parts: Record<string, Record<string, Piece[]>> } {
  const { core, units } = splitPageData(fullData()) as { core: PageData; units: () => Iterable<{ key: string; pieces: unknown[] }> };
  const listed = [...units()] as { key: string; pieces: Piece[] }[];
  const parts: Record<string, Record<string, Piece[]>> = {
    'part-0001': { [listed[0].key]: listed[0].pieces.slice(0, 3) },
    'part-0002': { [listed[0].key]: listed[0].pieces.slice(3), [listed[1].key]: listed[1].pieces },
  };
  core.chunks = { parts: Object.keys(parts), units: { [listed[0].key]: ['part-0001', 'part-0002'], [listed[1].key]: ['part-0002'] } };
  return { core, parts };
}

/** A loader whose `insert` answers from `parts` on a later tick, as a script would; a part not in `parts` fails like a missing file. */
function fakeLoader(core: PageData, parts: Record<string, Record<string, Piece[]>>, inserted: string[] = []): { loader: Loader; win: PartWindow } {
  const win = {} as PartWindow;
  installPartRegistry(win);
  const loader = createLoader(core.chunks, {
    win,
    insert: (src, onload, onerror) => {
      inserted.push(src);
      const id = src.replace(/^.*\//, '').replace(/\.js$/, '');
      setTimeout(() => {
        if (id in parts) {
          win.__xvHandbookPart?.(id, parts[id]);
          onload();
        } else onerror();
      }, 0);
    },
  });
  return { loader, win };
}

const page = (data: PageData, hash: string, loader?: Loader) => (
  <LoaderContext.Provider value={loader ?? emptyLoader}>
    <AppView data={data} route={parseHash(hash)} />
  </LoaderContext.Provider>
);
const emptyLoader = createLoader({ parts: [], units: {} }, { win: {} as PartWindow, insert: () => undefined });
const wait = async (): Promise<void> => { await settle(); await settle(); };

describe('the part registry', () => {
  it('the function a part file calls stores the data under the id of the part', () => {
    const win = {} as PartWindow;
    installPartRegistry(win);
    win.__xvHandbookPart?.('part-0001', { a: [{ b: 1 }] });
    expect(win.__xvHandbookParts).toEqual({ 'part-0001': { a: [{ b: 1 }] } });
  });
});

describe('the loader', () => {
  it('a page without part files gives its data at once, from the core, and loads nothing', () => {
    const data = fullData();
    const inserted: string[] = [];
    const loader = createLoader(data.chunks, { win: {} as PartWindow, insert: (src) => { inserted.push(src); } });
    expect(loader.state('feature:F1')).toEqual({ status: 'core' });
    const html = renderToStaticMarkup(page(data, '#/technical/feature/F1', loader));
    expect(html).toContain(d('screen two'));
    expect(html).toContain(d('claim two'));
    expect(inserted).toEqual([]);
  });

  it('loads the parts of a unit by script, once, in order, and the merged unit equals the unit of the single-file page', async () => {
    const { core, parts } = chunkedData();
    const inserted: string[] = [];
    const { loader } = fakeLoader(core, parts, inserted);
    expect(loader.state('feature:F1')).toEqual({ status: 'loading' });
    loader.load('feature:F1');
    loader.load('feature:F1');
    await wait();
    expect(inserted).toEqual(['handbook-data/part-0001.js', 'handbook-data/part-0002.js']);
    const state = loader.state('feature:F1');
    expect(state.status).toBe('ready');
    if (state.status !== 'ready') return;
    const whole = fullData();
    const feature = core.features[0];
    expect(feature.entry).toBeNull();
    expect(assembleFeature(core.technical?.locations[0], state.pieces)).toEqual({ entry: whole.features[0].entry, locations: whole.technical?.locations[0] });
    // The dictionaries are in part 2, which is already loaded: no further script.
    loader.load('dictionaries');
    await wait();
    expect(inserted).toHaveLength(2);
    const dictionaries = loader.state('dictionaries');
    expect(dictionaries.status === 'ready' && assembleDictionaries(core.technical?.dictionaries as DictionariesSection, dictionaries.pieces)).toEqual(section);
  });

  it('a part that fails to load is named, only the units that need it are missing, and the others load', async () => {
    const { core, parts } = chunkedData();
    const { loader } = fakeLoader(core, { 'part-0001': parts['part-0001'] });
    loader.load('feature:F1');
    loader.load('dictionaries');
    await wait();
    expect(loader.state('feature:F1')).toEqual({ status: 'missing', parts: ['part-0002'] });
    expect(loader.state('dictionaries')).toEqual({ status: 'missing', parts: ['part-0002'] });
    const second = fakeLoader(core, { 'part-0002': parts['part-0002'] });
    second.loader.load('dictionaries');
    second.loader.load('feature:F1');
    await wait();
    expect(second.loader.state('dictionaries').status).toBe('ready');
    expect(second.loader.state('feature:F1')).toEqual({ status: 'missing', parts: ['part-0001'] });
  });

  it('a script that runs but does not register its part counts as missing', async () => {
    const { core } = chunkedData();
    const win = {} as PartWindow;
    installPartRegistry(win);
    const loader = createLoader(core.chunks, { win, insert: (_src, onload) => setTimeout(onload, 0) });
    loader.load('dictionaries');
    await wait();
    expect(loader.state('dictionaries')).toEqual({ status: 'missing', parts: ['part-0002'] });
  });
});

describe('the pages', () => {
  it('a feature page shows the loading text, then the entry and the source locations; the findings and the name are there at once', async () => {
    const { core, parts } = chunkedData();
    const { loader } = fakeLoader(core, parts);
    const host = mount(page(core, '#/technical/feature/F1', loader));
    expect(host.textContent).toContain(d('feature one'));
    expect(host.textContent).toContain(`${MARK}${shipped.strings['page.chunk.loading']}`);
    expect(host.textContent).not.toContain(d('screen one'));
    await wait();
    expect(host.textContent).toContain(d('purpose'));
    expect(host.textContent).toContain(d('screen two'));
    expect(host.textContent).toContain(d('claim two'));
    expect(host.textContent).not.toContain(shipped.strings['page.chunk.loading']);
  });

  it('a feature page whose part is missing says which part, and a feature with no entry loads nothing', async () => {
    const { core, parts } = chunkedData();
    const inserted: string[] = [];
    const { loader } = fakeLoader(core, { 'part-0001': parts['part-0001'] }, inserted);
    const host = mount(page(core, '#/technical/feature/F1', loader));
    await wait();
    expect(host.textContent).toContain(`${MARK}A file with data for this page is missing: handbook-data/part-0002.js.`);
    expect(host.textContent).not.toContain(d('screen two'));
    const other = mount(page(core, '#/technical/feature/F2', loader));
    await wait();
    expect(other.textContent).toContain(`${MARK}${shipped.strings['page.feature.noEntry']}`);
    expect(inserted.filter((src) => src.includes('part-0002'))).toHaveLength(1);
  });

  it('the dictionaries page loads its parts and then shows the value sets; the overview loads nothing', async () => {
    const { core, parts } = chunkedData();
    const inserted: string[] = [];
    const { loader } = fakeLoader(core, parts, inserted);
    mount(page(core, '#/technical', loader));
    await wait();
    expect(inserted).toEqual([]);
    const host = mount(page(core, '#/technical/dictionaries', loader));
    expect(host.textContent).toContain(`${MARK}${shipped.strings['page.chunk.loading']}`);
    await wait();
    expect(host.textContent).toContain(d('Alpha'));
    expect(host.textContent).toContain(d('Beta'));
    expect(inserted).toEqual(['handbook-data/part-0002.js']);
  });

  it('the same page in the two forms shows the same text', async () => {
    const single = fullData();
    const singleHost = mount(page(single, '#/technical/feature/F1'));
    const { core, parts } = chunkedData();
    const { loader } = fakeLoader(core, parts);
    const chunkedHost = mount(page(core, '#/technical/feature/F1', loader));
    await wait();
    expect(chunkedHost.innerHTML).toBe(singleHost.innerHTML);
  });
});

describe('paging', () => {
  const rows = (count: number) => Array.from({ length: count }, (_, at) => at + 1);
  const t = makeText(marked);
  const mountItems = (count: number) => mount(
    <TextContext.Provider value={t}>
      <ItemList part="many" label="many">{rows(count).map((n) => <Item key={n}><p>{`row ${n}`}</p></Item>)}</ItemList>
    </TextContext.Provider>,
  );
  const mountTable = (count: number) => mount(
    <TextContext.Provider value={t}>
      <TableScroll label="many"><thead><tr><th scope="col">n</th></tr></thead><tbody>{rows(count).map((n) => <tr key={n}><Cell row>{`row ${n}`}</Cell></tr>)}</tbody></TableScroll>
    </TextContext.Provider>,
  );
  const next = (host: HTMLElement): HTMLButtonElement => host.querySelector('[data-part="pager-next"]') as HTMLButtonElement;
  const previous = (host: HTMLElement): HTMLButtonElement => host.querySelector('[data-part="pager-previous"]') as HTMLButtonElement;
  const press = (button: HTMLButtonElement): void => { act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true }))); };

  it('shows everything and no controls up to 200 rows', () => {
    for (const host of [mountItems(200), mountTable(200)]) {
      expect(host.querySelectorAll('li.item, tbody tr').length).toBe(200);
      expect(host.querySelector('[data-part="pager"]')).toBeNull();
    }
  });

  it('shows 200 rows of a longer list, with the controls under it, and moves a page at a time', () => {
    const host = mountItems(450);
    expect(host.querySelectorAll('li.item')).toHaveLength(200);
    const list = host.querySelector('ul.item-list') as HTMLElement;
    const pager = host.querySelector('[data-part="pager"]') as HTMLElement;
    expect(list.compareDocumentPosition(pager) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(pager.textContent).toContain(`${MARK}Page 1 of 3, rows 1 to 200 of 450`);
    expect(previous(host).disabled).toBe(true);
    press(next(host));
    expect(host.querySelectorAll('li.item')).toHaveLength(200);
    expect(host.querySelector('li.item')?.textContent).toBe('row 201');
    press(next(host));
    expect(host.querySelectorAll('li.item')).toHaveLength(50);
    expect(next(host).disabled).toBe(true);
    expect(host.querySelector('[data-part="pager"]')?.textContent).toContain('rows 401 to 450 of 450');
    press(previous(host));
    expect(host.querySelector('li.item')?.textContent).toBe('row 201');
  });

  it('pages a table by its body rows and keeps the head, and puts the controls after the scroll box', () => {
    const host = mountTable(401);
    expect(host.querySelectorAll('tbody tr')).toHaveLength(200);
    expect(host.querySelectorAll('thead tr')).toHaveLength(1);
    press(next(host));
    press(next(host));
    expect(host.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(host.querySelector('tbody tr')?.textContent).toBe('row 401');
    const box = host.querySelector('.table-scroll') as HTMLElement;
    expect(box.compareDocumentPosition(host.querySelector('[data-part="pager"]') as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('starts again at the first page when the rows change (a filter runs before the paging)', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const view = (count: number) => (
      <TextContext.Provider value={t}>
        <ItemList label="many">{rows(count).map((n) => <Item key={n}><p>{`row ${n}`}</p></Item>)}</ItemList>
      </TextContext.Provider>
    );
    const first = mount(view(450));
    press(next(first));
    expect(first.querySelector('li.item')?.textContent).toBe('row 201');
    // 450 rows filtered to 230 keeps the paging but starts at page 1: a new list is a new page.
    const second = mount(view(230));
    expect(second.querySelector('li.item')?.textContent).toBe('row 1');
    expect(second.querySelector('[data-part="pager"]')?.textContent).toContain('Page 1 of 2');
  });
});
