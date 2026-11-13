/**
 * The split of the page data into a core and units (design D5 of openspec change handbook-skill-first,
 * built on D2, D3 of handbook-page-chunked-data). The core holds what the navigation needs: the
 * outline, the titles, the fixed text. A unit holds the detail shown on one page: the Markdown of one
 * chapter in each view, the coverage section, the tables of the data section, the value sets of the
 * status dictionaries, the lists of the code health.
 *
 * A unit is an ordered list of pieces, each a small JSON value with one tag key, so a unit larger than a
 * part can continue in the next part. `splitPageData` takes the detail out of the data and
 * `restorePageData` puts it back in the same places and key order; the page has the same merge in
 * `src/lib/chunks.ts`, and a test holds the two together. No function here builds the whole data as one
 * string.
 */

export const DICTIONARIES_UNIT = 'dictionaries';
export const DATA_UNIT = 'data';
export const COVERAGE_UNIT = 'coverage';
export const HISTORY_UNIT = 'history';
export const chapterUnitKey = (id) => `chapter:${id}`;

const tagged = (pieces, tag) => pieces.filter((piece) => Object.hasOwn(piece, tag)).map((piece) => piece[tag]);
const hasRecords = (section, ...lists) => section !== null && section !== undefined && lists.some((list) => section[list].length > 0);
/** The texts of a unit as pieces tagged `tag`: `{ [tag]: { view, text } }`, in the key order of `texts`. */
const textPieces = (texts, tag) => Object.entries(texts).map(([view, text]) => ({ [tag]: { view, text } }));
const textsOf = (pieces, tag) => Object.fromEntries(tagged(pieces, tag).map(({ view, text }) => [view, text]));

const HISTORY_LISTS = ['years', 'apps', 'hotspots', 'coChange', 'tests'];

/**
 * `{ core, units }`: `core` is `data` with the detail of every unit emptied in place (a text map is empty, a list is empty), and
 * `units()` yields `{ key, pieces }` for each unit in a fixed order: the chapters in the outline's order, the coverage, the data
 * section, the dictionaries, the code health. A unit with nothing in it is not yielded.
 */
export function splitPageData(data) {
  const technical = data.technical;
  const chapterIds = data.chapters.filter((chapter) => Object.keys(chapter.texts).length > 0).map((chapter) => chapter.id);
  const withChapter = new Set(chapterIds);
  const coverageUnit = Object.keys(data.coverage).length > 0;
  const dataUnit = technical !== undefined && hasRecords(technical.data, 'tables', 'dropped');
  const dictionaryUnit = technical !== undefined && hasRecords(technical.dictionaries, 'dictionaries', 'mismatches');
  const historyUnit = data.history !== null && HISTORY_LISTS.some((list) => data.history[list].length > 0);
  const core = {
    ...data,
    chapters: data.chapters.map((chapter) => (withChapter.has(chapter.id) ? { ...chapter, texts: {} } : chapter)),
    ...(coverageUnit ? { coverage: {} } : {}),
    ...(historyUnit ? { history: { ...data.history, ...Object.fromEntries(HISTORY_LISTS.map((list) => [list, []])) } } : {}),
  };
  if (technical !== undefined) {
    core.technical = {
      ...technical,
      ...(dataUnit ? { data: { ...technical.data, tables: [], dropped: [] } } : {}),
      ...(dictionaryUnit ? { dictionaries: { ...technical.dictionaries, dictionaries: [], mismatches: [] } } : {}),
      ...(historyUnit && technical.history !== null ? { history: { hotspots: [], coChange: [] } } : {}),
    };
  }
  function* units() {
    for (const chapter of data.chapters) {
      if (withChapter.has(chapter.id)) yield { key: chapterUnitKey(chapter.id), pieces: textPieces(chapter.texts, 'text') };
    }
    if (coverageUnit) yield { key: COVERAGE_UNIT, pieces: textPieces(data.coverage, 'coverageText') };
    if (dataUnit) yield { key: DATA_UNIT, pieces: [...technical.data.tables.map((table) => ({ table })), ...technical.data.dropped.map((dropped) => ({ dropped }))] };
    if (dictionaryUnit) yield { key: DICTIONARIES_UNIT, pieces: [...technical.dictionaries.dictionaries.map((dictionary) => ({ dictionary })), ...technical.dictionaries.mismatches.map((mismatch) => ({ mismatch }))] };
    if (historyUnit) {
      const { history } = data;
      yield {
        key: HISTORY_UNIT,
        pieces: [
          ...history.years.map((year) => ({ year })),
          ...history.apps.map((app) => ({ app })),
          ...history.hotspots.map((hotspot) => ({ hotspot })),
          ...history.coChange.map((pair) => ({ pair })),
          ...history.tests.map((test) => ({ test })),
          ...(technical?.history?.hotspots ?? []).map((hotspotPath) => ({ hotspotPath })),
          ...(technical?.history?.coChange ?? []).map((pairPath) => ({ pairPath })),
        ],
      };
    }
  }
  return { core, units };
}

/** The data `core` and `units` (the units `splitPageData` yields, or the pieces read back from the parts) came from. */
export function restorePageData(core, units) {
  const piecesOf = new Map([...units].map((unit) => [unit.key, unit.pieces]));
  const restored = {
    ...core,
    chapters: core.chapters.map((chapter) => {
      const pieces = piecesOf.get(chapterUnitKey(chapter.id));
      return pieces === undefined ? chapter : { ...chapter, texts: textsOf(pieces, 'text') };
    }),
  };
  const coveragePieces = piecesOf.get(COVERAGE_UNIT);
  if (coveragePieces !== undefined) restored.coverage = textsOf(coveragePieces, 'coverageText');
  const historyPieces = piecesOf.get(HISTORY_UNIT);
  if (historyPieces !== undefined) restored.history = { ...core.history, years: tagged(historyPieces, 'year'), apps: tagged(historyPieces, 'app'), hotspots: tagged(historyPieces, 'hotspot'), coChange: tagged(historyPieces, 'pair'), tests: tagged(historyPieces, 'test') };
  if (core.technical !== undefined) {
    const { technical } = core;
    const dataPieces = piecesOf.get(DATA_UNIT);
    const dictionaryPieces = piecesOf.get(DICTIONARIES_UNIT);
    restored.technical = {
      ...technical,
      ...(dataPieces === undefined ? {} : { data: { ...technical.data, tables: tagged(dataPieces, 'table'), dropped: tagged(dataPieces, 'dropped') } }),
      ...(dictionaryPieces === undefined ? {} : { dictionaries: { ...technical.dictionaries, dictionaries: tagged(dictionaryPieces, 'dictionary'), mismatches: tagged(dictionaryPieces, 'mismatch') } }),
      ...(historyPieces === undefined || technical.history === null ? {} : { history: { hotspots: tagged(historyPieces, 'hotspotPath'), coChange: tagged(historyPieces, 'pairPath') } }),
    };
  }
  return restored;
}
