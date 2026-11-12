import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';

import type { ChapterData, Chunks, DataSection, DictionariesSection, History, Technical, View, ViewTexts } from './types';

/**
 * Loading of the part files of a page whose data is large (design D3, D4 of openspec change
 * handbook-page-chunked-data). The core of the page data is inline; the detail of a unit (the Markdown of
 * a chapter, the coverage section, the data section, the dictionaries, the code health) is in `handbook-data/part-NNNN.js` files, each a call of
 * `window.__xvHandbookPart(id, json)`. A part is loaded by inserting a `<script src>` (a fetch of a file next to
 * a page opened from disk is blocked by the browser), and only when a page needs one of its units.
 *
 * One path for both forms of the page: a unit the index does not list is in the core, and its state is `core`,
 * which the hooks turn into the data at once; a unit it lists is `loading`, then `ready` or `missing`.
 */

export const PARTS_DIRECTORY = 'handbook-data';
export const PART_FUNCTION = '__xvHandbookPart';

const has = (object: object, key: string): boolean => Object.prototype.hasOwnProperty.call(object, key);

export type Piece = Record<string, unknown>;
type Registry = Record<string, Record<string, Piece[]>>;
export type PartWindow = { [PART_FUNCTION]?: (id: string, value: Record<string, Piece[]>) => void; __xvHandbookParts?: Registry };

export type UnitState =
  | { status: 'core' }
  | { status: 'loading' }
  | { status: 'ready'; pieces: Piece[] }
  | { status: 'missing'; parts: string[] };

export interface Loader {
  /** The state of a unit; the same object until it changes. */
  state(key: string): UnitState;
  /** Start loading the parts of a unit; does nothing for a unit in the core or one already started. */
  load(key: string): void;
  subscribe(listener: () => void): () => void;
}

/** Define the function the part files call, and the table it fills. */
export function installPartRegistry(win: PartWindow = window as unknown as PartWindow): Registry {
  const registry: Registry = (win.__xvHandbookParts ??= {});
  win[PART_FUNCTION] = (id, value) => { registry[id] = value; };
  return registry;
}

/** Insert a script for `src` into the document: the one way the page reads a part file. */
export function insertScript(src: string, onload: () => void, onerror: () => void): void {
  const script = document.createElement('script');
  script.charset = 'utf-8';
  script.src = src;
  script.onload = () => { script.remove(); onload(); };
  script.onerror = () => { script.remove(); onerror(); };
  document.head.appendChild(script);
}

const CORE: UnitState = { status: 'core' };
const LOADING: UnitState = { status: 'loading' };

export function createLoader(chunks: Chunks, { win = window as unknown as PartWindow, insert = insertScript }: { win?: PartWindow; insert?: typeof insertScript } = {}): Loader {
  const registry = win.__xvHandbookParts ?? installPartRegistry(win);
  const states = new Map<string, UnitState>();
  const parts = new Map<string, Promise<boolean>>();
  const listeners = new Set<() => void>();
  const set = (key: string, state: UnitState): void => {
    states.set(key, state);
    listeners.forEach((listener) => listener());
  };
  const loadPart = (id: string): Promise<boolean> => {
    if (has(registry, id)) return Promise.resolve(true);
    let loading = parts.get(id);
    if (loading === undefined) {
      loading = new Promise<boolean>((resolve) => {
        insert(`${PARTS_DIRECTORY}/${id}.js`, () => resolve(has(registry, id)), () => resolve(false));
      });
      parts.set(id, loading);
    }
    return loading;
  };
  return {
    state: (key) => (chunks.units[key] === undefined ? CORE : states.get(key) ?? LOADING),
    load(key) {
      const ids = chunks.units[key];
      if (ids === undefined || states.has(key)) return;
      set(key, LOADING);
      void Promise.all(ids.map(loadPart)).then((loaded) => {
        const missing = ids.filter((id, at) => !loaded[at] || !Array.isArray(registry[id]?.[key]));
        if (missing.length > 0) set(key, { status: 'missing', parts: missing });
        else set(key, { status: 'ready', pieces: ids.flatMap((id) => registry[id][key]) });
      });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

/** A loader for a page with no part files: every unit is in the core. */
export const NO_LOADER: Loader = { state: () => CORE, load: () => undefined, subscribe: () => () => undefined };

export const LoaderContext = createContext<Loader>(NO_LOADER);

/** The state of one unit, loading it when the page shows it; `null` is no unit (the data is in the core). */
export function useUnit(key: string | null): UnitState {
  const loader = useContext(LoaderContext);
  const get = (): UnitState => (key === null ? CORE : loader.state(key));
  const state = useSyncExternalStore(loader.subscribe, get, get);
  useEffect(() => {
    if (key !== null) loader.load(key);
  }, [loader, key]);
  return state;
}

/** What a page that needs a unit shows: nothing yet, a missing part, or the data. */
export type Detail<T> = { status: 'loading' } | { status: 'missing'; parts: string[] } | { status: 'ready'; value: T };

const tagged = <T,>(pieces: Piece[], tag: string): T[] => pieces.filter((piece) => has(piece, tag)).map((piece) => piece[tag] as T);
const textsOf = (pieces: Piece[], tag: string): ViewTexts => Object.fromEntries(tagged<{ view: View; text: string }>(pieces, tag).map(({ view, text }) => [view, text]));

export const chapterUnitKey = (id: string): string => `chapter:${id}`;
export const COVERAGE_UNIT = 'coverage';
export const DATA_UNIT = 'data';
export const DICTIONARIES_UNIT = 'dictionaries';
export const HISTORY_UNIT = 'history';

/** The merges below are the ones `restorePageData` of the script makes (page-units.mjs); a test holds the two together. */
export const assembleChapterTexts = (pieces: Piece[]): ViewTexts => textsOf(pieces, 'text');
export const assembleCoverage = (pieces: Piece[]): ViewTexts => textsOf(pieces, 'coverageText');
export const assembleData = (section: DataSection, pieces: Piece[]): DataSection => ({ ...section, tables: tagged(pieces, 'table'), dropped: tagged(pieces, 'dropped') });
export const assembleDictionaries = (section: DictionariesSection, pieces: Piece[]): DictionariesSection => ({ ...section, dictionaries: tagged(pieces, 'dictionary'), mismatches: tagged(pieces, 'mismatch') });

/** The code health and the paths of its files, as one value. */
export interface HistoryDetail { history: History; places: Technical['history'] }

export function assembleHistory(history: History, places: Technical['history'], pieces: Piece[]): HistoryDetail {
  return {
    history: { ...history, years: tagged(pieces, 'year'), apps: tagged(pieces, 'app'), hotspots: tagged(pieces, 'hotspot'), coChange: tagged(pieces, 'pair'), tests: tagged(pieces, 'test') },
    places: places === null ? null : { hotspots: tagged(pieces, 'hotspotPath'), coChange: tagged(pieces, 'pairPath') },
  };
}

function detailOf<T>(state: UnitState, fromCore: () => T, fromPieces: (pieces: Piece[]) => T): Detail<T> {
  switch (state.status) {
    case 'core': return { status: 'ready', value: fromCore() };
    case 'loading': return { status: 'loading' };
    case 'missing': return state;
    case 'ready': return { status: 'ready', value: fromPieces(state.pieces) };
  }
}

/** The Markdown of a chapter in each view: from the core in a page without part files, else once the unit is loaded. */
export function useChapterTexts(chapter: ChapterData): Detail<ViewTexts> {
  const state = useUnit(chapterUnitKey(chapter.id));
  return useMemo(() => detailOf(state, () => chapter.texts, assembleChapterTexts), [state, chapter]);
}

/** The coverage section by view; the same rules as `useChapterTexts`. */
export function useCoverage(texts: ViewTexts): Detail<ViewTexts> {
  const state = useUnit(COVERAGE_UNIT);
  return useMemo(() => detailOf(state, () => texts, assembleCoverage), [state, texts]);
}

/** The data section, null when it was not written; the same rules. */
export function useDataSection(section: DataSection | null): Detail<DataSection | null> {
  const state = useUnit(section === null ? null : DATA_UNIT);
  return useMemo(() => detailOf(state, () => section, (pieces) => assembleData(section as DataSection, pieces)), [state, section]);
}

/** The status dictionary, null when it was not written; the same rules. */
export function useDictionaries(section: DictionariesSection | null): Detail<DictionariesSection | null> {
  const state = useUnit(section === null ? null : DICTIONARIES_UNIT);
  return useMemo(() => detailOf(state, () => section, (pieces) => assembleDictionaries(section as DictionariesSection, pieces)), [state, section]);
}

/** The code health with the paths of its files; the same rules. */
export function useHistory(history: History, places: Technical['history']): Detail<HistoryDetail> {
  const state = useUnit(HISTORY_UNIT);
  return useMemo(() => detailOf(state, () => ({ history, places }), (pieces) => assembleHistory(history, places, pieces)), [state, history, places]);
}
