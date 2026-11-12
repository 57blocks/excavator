import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';

import type { ChapterBlock, Chunks, DataSection, DictionariesSection, Entry, Feature, UnitLocations } from './types';

/**
 * Loading of the part files of a page whose data is large (design D3, D4 of openspec change
 * handbook-page-chunked-data). The core of the page data is inline; the detail of a unit (the entry of a
 * feature, the data section, the dictionaries) is in `handbook-data/part-NNNN.js` files, each a call of
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

export const featureUnitKey = (id: string): string => `feature:${id}`;

/** The entry and the source locations of a verified feature from its pieces (the merge `restorePageData` of the script makes). */
export function assembleFeature(locations: UnitLocations | undefined, pieces: Piece[]): { entry: Entry | null; locations: UnitLocations | undefined } {
  const head = pieces[0].entry as Entry;
  return {
    entry: { ...head, screens: tagged(pieces, 'screen'), operations: tagged(pieces, 'operation'), ...(head.chapter === undefined ? {} : { chapter: tagged<ChapterBlock>(pieces, 'chapterBlock') }) },
    locations: locations === undefined ? undefined : { ...locations, items: tagged(pieces, 'locationItem') },
  };
}

export const assembleData = (section: DataSection, pieces: Piece[]): DataSection => ({ ...section, tables: tagged(pieces, 'table'), dropped: tagged(pieces, 'dropped') });

export const assembleDictionaries = (section: DictionariesSection, pieces: Piece[]): DictionariesSection => ({ ...section, dictionaries: tagged(pieces, 'dictionary'), mismatches: tagged(pieces, 'mismatch') });

function detailOf<T>(state: UnitState, fromCore: () => T, fromPieces: (pieces: Piece[]) => T): Detail<T> {
  switch (state.status) {
    case 'core': return { status: 'ready', value: fromCore() };
    case 'loading': return { status: 'loading' };
    case 'missing': return state;
    case 'ready': return { status: 'ready', value: fromPieces(state.pieces) };
  }
}

/** The entry and the source locations of a feature: from the core in a page without part files, else once the unit is loaded. */
export function useFeatureDetail(feature: Feature, locations: UnitLocations | undefined): Detail<{ entry: Entry | null; locations: UnitLocations | undefined }> {
  const state = useUnit(featureUnitKey(feature.id));
  return useMemo(() => detailOf(state, () => ({ entry: feature.entry, locations }), (pieces) => assembleFeature(locations, pieces)), [state, feature, locations]);
}

/** The data section, null when it was not written; the same rules as `useFeatureDetail`. */
export function useDataSection(section: DataSection | null): Detail<DataSection | null> {
  const state = useUnit(section === null ? null : 'data');
  return useMemo(() => detailOf(state, () => section, (pieces) => assembleData(section as DataSection, pieces)), [state, section]);
}

/** The status dictionary, null when it was not written; the same rules as `useFeatureDetail`. */
export function useDictionaries(section: DictionariesSection | null): Detail<DictionariesSection | null> {
  const state = useUnit(section === null ? null : 'dictionaries');
  return useMemo(() => detailOf(state, () => section, (pieces) => assembleDictionaries(section as DictionariesSection, pieces)), [state, section]);
}
