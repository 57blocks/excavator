// @vitest-environment happy-dom
// O2 of openspec change handbook-page-chunked-data, carried over to the page data /19 of openspec change handbook-skill-first:
// one loading function gives the same data in both forms of the page (from the core when the page has no part files, from the
// parts when it has), a chapter page, the coverage page, the dictionaries page and the code health page show a loading state and
// then their detail, a part that is missing is named on the page that needs it and the other pages still work, and a table or list
// of more than 200 rows is shown 200 rows at a time. The expectations are written by hand; the part files are made by the script's
// own split (page-units.mjs), so the two merges are held together.
import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';

import { splitPageData } from '../../../skills/excavator-product-handbook/lib/page-units.mjs';
import { AppView } from '../src/App';
import { Cell, TableScroll } from '../src/components/Tables';
import { Item, ItemList } from '../src/components/ui/ItemList';
import { LoaderContext, assembleChapterTexts, assembleCoverage, assembleDictionaries, assembleHistory, createLoader, installPartRegistry } from '../src/lib/chunks';
import type { Loader, PartWindow, Piece } from '../src/lib/chunks';
import { TextContext, makeText } from '../src/lib/text';
import { parseHash } from '../src/lib/route';
import type { DictionariesSection, History, PageData } from '../src/lib/types';
import { cleanup, mount, settle } from './dom';
import { MARK, chapter, d, marked, pageData, shipped } from './page-fixture';

afterEach(cleanup);

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

const F1_PRODUCT = `# ${d('Orders')}\n\n${d('product words')}\n\n| ${d('Role')} | ${d('Can')} |\n| --- | --- |\n| ${d('Clerk')} | ${d('Creates')} |\n`;
const F1_TECHNICAL = `# ${d('Orders')}\n\n${d('technical words')} \`src/a.js:3-5\`\n`;
const history: History = {
  state: 'ok', noHistory: null,
  years: [{ year: 2022, commits: 3, byApp: { [d('api')]: 3 } }, { year: 2023, commits: 1, byApp: { [d('api')]: 1 } }],
  apps: [{ dir: d('api'), first: '2022-01-01', last: '2023-02-02', commits: 4, authors: 2, authors80: 1, reason: null }],
  hotspots: [{ name: d('orders.js'), app: d('api'), commits: 4, authors: 2, lines: 9, last: '2023-02-02', uncertain: 0, features: ['F1'] }],
  coChange: [{ a: d('orders.js'), appA: d('api'), b: d('page.js'), appB: null, commits: 2 }],
  tests: [{ dir: d('api'), sourceFiles: 3, testFiles: 1 }],
  conventions: ['goTest'],
};

/** A page whose F1 has a table in its text, whose dictionaries and code health are written. */
function fullData(): PageData {
  const data = pageData({
    history,
    technical: { dictionaries: section, dictionariesState: 'ok', history: { hotspots: [d('src/orders.js')], coChange: [{ a: d('src/orders.js'), b: d('src/page.js') }] } },
    chapters: [chapter('system', 'System chapter'), { id: 'F1', texts: { product: F1_PRODUCT, technical: F1_TECHNICAL } }, chapter('F2', 'Reminders')],
  });
  return data;
}

type Listed = { key: string; pieces: Piece[] };

/** The page data as a chunked run writes it: the core and the parts; chapter F1 spans parts 1 and 2, the dictionaries and the code health are in part 2. */
function chunkedData(): { core: PageData; parts: Record<string, Record<string, Piece[]>>; listed: Listed[] } {
  const { core, units } = splitPageData(fullData()) as { core: PageData; units: () => Iterable<Listed> };
  const listed = [...units()];
  const by = (key: string): Listed => listed.find((unit) => unit.key === key) as Listed;
  const f1 = by('chapter:F1');
  const parts: Record<string, Record<string, Piece[]>> = {
    'part-0001': { 'chapter:system': by('chapter:system').pieces, 'chapter:F1': f1.pieces.slice(0, 1), 'chapter:F2': by('chapter:F2').pieces, coverage: by('coverage').pieces },
    'part-0002': { 'chapter:F1': f1.pieces.slice(1), dictionaries: by('dictionaries').pieces, history: by('history').pieces },
  };
  core.chunks = {
    parts: Object.keys(parts),
    units: { 'chapter:system': ['part-0001'], 'chapter:F1': ['part-0001', 'part-0002'], 'chapter:F2': ['part-0001'], coverage: ['part-0001'], dictionaries: ['part-0002'], history: ['part-0002'] },
  };
  return { core, parts, listed };
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
const LOADING = `${MARK}${shipped.strings['page.chunk.loading']}`;

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
    expect(loader.state('chapter:F1')).toEqual({ status: 'core' });
    expect(renderToStaticMarkup(page(data, '#/technical/chapter/F1', loader))).toContain(d('technical words'));
    expect(renderToStaticMarkup(page(data, '#/product/chapter/F1', loader))).toContain('<table');
    expect(inserted).toEqual([]);
  });

  it('loads the parts of a unit by script, once, in order, and the merged unit equals the unit of the single-file page', async () => {
    const { core, parts } = chunkedData();
    const inserted: string[] = [];
    const { loader } = fakeLoader(core, parts, inserted);
    expect(loader.state('chapter:F1')).toEqual({ status: 'loading' });
    loader.load('chapter:F1');
    loader.load('chapter:F1');
    await wait();
    expect(inserted).toEqual(['handbook-data/part-0001.js', 'handbook-data/part-0002.js']);
    const state = loader.state('chapter:F1');
    expect(state.status).toBe('ready');
    if (state.status !== 'ready') return;
    expect(core.chapters[1].texts).toEqual({});
    expect(assembleChapterTexts(state.pieces)).toEqual({ product: F1_PRODUCT, technical: F1_TECHNICAL });
    // The other units are in part 2, which is already loaded: no further script.
    loader.load('dictionaries');
    loader.load('history');
    await wait();
    expect(inserted).toHaveLength(2);
    const dictionaries = loader.state('dictionaries');
    expect(dictionaries.status === 'ready' && assembleDictionaries(core.technical?.dictionaries as DictionariesSection, dictionaries.pieces)).toEqual(section);
    const health = loader.state('history');
    expect(health.status === 'ready' && assembleHistory(core.history as History, core.technical?.history ?? null, health.pieces)).toEqual({ history, places: fullData().technical?.history });
    loader.load('coverage');
    await wait();
    const coverage = loader.state('coverage');
    expect(coverage.status === 'ready' && assembleCoverage(coverage.pieces)).toEqual(fullData().coverage);
  });

  it('a part that fails to load is named, only the units that need it are missing, and the others load', async () => {
    const { core, parts } = chunkedData();
    const { loader } = fakeLoader(core, { 'part-0001': parts['part-0001'] });
    loader.load('chapter:F1');
    loader.load('dictionaries');
    loader.load('chapter:system');
    await wait();
    expect(loader.state('chapter:F1')).toEqual({ status: 'missing', parts: ['part-0002'] });
    expect(loader.state('dictionaries')).toEqual({ status: 'missing', parts: ['part-0002'] });
    expect(loader.state('chapter:system').status).toBe('ready');
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
  it('a chapter page shows the loading text, then the Markdown of the chapter; the navigation is there at once', async () => {
    const { core, parts } = chunkedData();
    const { loader } = fakeLoader(core, parts);
    const host = mount(page(core, '#/technical/chapter/F1', loader));
    expect(host.querySelector('.side')?.textContent).toContain(d('Orders'));
    expect(host.textContent).toContain(LOADING);
    expect(host.textContent).not.toContain(d('technical words'));
    await wait();
    expect(host.textContent).toContain(d('technical words'));
    expect(host.querySelector('.cite')?.textContent).toBe('src/a.js:3-5');
    expect(host.textContent).not.toContain(shipped.strings['page.chunk.loading']);
  });

  it('a chapter page whose part is missing says which part, and a chapter in a part that is there still shows', async () => {
    const { core, parts } = chunkedData();
    const { loader } = fakeLoader(core, { 'part-0001': parts['part-0001'] });
    const host = mount(page(core, '#/technical/chapter/F1', loader));
    await wait();
    expect(host.textContent).toContain(`${MARK}A file with data for this page is missing: handbook-data/part-0002.js.`);
    expect(host.textContent).not.toContain(d('technical words'));
    const other = mount(page(core, '#/technical/chapter/F2', loader));
    await wait();
    expect(other.querySelector('.prose')?.textContent).toContain(d('paragraph of F2'));
  });

  it('the dictionaries page and the code health page load their parts and then show; the coverage page loads its own', async () => {
    const { core, parts } = chunkedData();
    const inserted: string[] = [];
    const { loader } = fakeLoader(core, parts, inserted);
    const dictionaries = mount(page(core, '#/technical/dictionaries', loader));
    expect(dictionaries.textContent).toContain(LOADING);
    await wait();
    expect(dictionaries.textContent).toContain(d('Alpha'));
    expect(dictionaries.textContent).toContain(d('Beta'));
    const health = mount(page(core, '#/technical/history', loader));
    await wait();
    expect(health.querySelector('[data-part="history-hotspots"]')?.textContent).toContain(d('src/orders.js'));
    expect(health.querySelector('[data-part="history-hotspots"] a')?.getAttribute('href')).toBe('#/technical/chapter/F1');
    expect(inserted).toEqual(['handbook-data/part-0002.js']);
    const coverage = mount(page(core, '#/technical/coverage', loader));
    await wait();
    expect(coverage.querySelector('.prose')?.textContent).toContain(d('coverage text'));
    expect(inserted).toEqual(['handbook-data/part-0002.js', 'handbook-data/part-0001.js']);
  });

  it('the same page in the two forms shows the same text', async () => {
    for (const hash of ['#/technical/chapter/F1', '#/product/chapter/F1', '#/technical/history', '#/technical/dictionaries', '#/technical/coverage']) {
      const singleHost = mount(page(fullData(), hash));
      const { core, parts } = chunkedData();
      const { loader } = fakeLoader(core, parts);
      const chunkedHost = mount(page(core, hash, loader));
      await wait();
      // Text, not markup: the select of the dictionaries page numbers its ids by the order of mounting.
      expect(chunkedHost.textContent, hash).toBe(singleHost.textContent);
      expect(chunkedHost.querySelectorAll('*').length, hash).toBe(singleHost.querySelectorAll('*').length);
    }
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
