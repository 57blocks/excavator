/**
 * The split of the page data into a core and units (design D2, D3 of openspec change
 * handbook-page-chunked-data). The core holds everything the navigation, the overview and
 * the summary pages need; a unit holds the detail shown only on one page: the entry and the
 * source locations of one verified feature, the value sets and their mismatches of the
 * status dictionary, the tables and dropped tables of the data section.
 *
 * A unit is an ordered list of pieces, each a small JSON value with one tag key, so a unit
 * larger than a part can continue in the next part. `splitPageData` takes the detail out of
 * the data and `restorePageData` puts it back in the same places and key order; the page
 * has the same merge in `src/lib/chunks.ts`, and a test holds the two together.
 * No function here builds the whole data as one string.
 */

export const DICTIONARIES_UNIT = 'dictionaries';
export const DATA_UNIT = 'data';
export const featureUnitKey = (id) => `feature:${id}`;

const tagged = (pieces, tag) => pieces.filter((piece) => Object.hasOwn(piece, tag)).map((piece) => piece[tag]);

/** A section of the technical part that has detail to move out: written (not null) and with at least one record. */
const hasRecords = (section, ...lists) => section !== null && section !== undefined && lists.some((list) => section[list].length > 0);

/**
 * `{ core, units }`: `core` is `data` with the detail of every unit emptied in place (an entry is null, a list is
 * empty, a location unit keeps only its id), and `units()` yields `{ key, pieces }` for each unit in a fixed order:
 * the verified features in the map's order, then the data section, then the dictionaries.
 */
export function splitPageData(data) {
  const withEntry = new Set(data.features.filter((feature) => feature.entry !== null).map((feature) => feature.id));
  const technical = data.technical;
  const locationsOf = new Map((technical?.locations ?? []).filter((unit) => withEntry.has(unit.id)).map((unit) => [unit.id, unit]));
  const dataUnit = technical !== undefined && hasRecords(technical.data, 'tables', 'dropped');
  const dictionaryUnit = technical !== undefined && hasRecords(technical.dictionaries, 'dictionaries', 'mismatches');
  const core = { ...data, features: data.features.map((feature) => (withEntry.has(feature.id) ? { ...feature, entry: null } : feature)) };
  if (technical !== undefined) {
    core.technical = {
      ...technical,
      locations: technical.locations.map((unit) => (locationsOf.has(unit.id) ? { ...unit, items: [] } : unit)),
      ...(dataUnit ? { data: { ...technical.data, tables: [], dropped: [] } } : {}),
      ...(dictionaryUnit ? { dictionaries: { ...technical.dictionaries, dictionaries: [], mismatches: [] } } : {}),
    };
  }
  function* units() {
    for (const feature of data.features) {
      if (!withEntry.has(feature.id)) continue;
      const { entry } = feature;
      yield {
        key: featureUnitKey(feature.id),
        pieces: [
          // The blocks of a /3 entry's chapter (openspec change handbook-free-chapter) are pieces of their own, so a long chapter can continue in the next part.
          { entry: { ...entry, screens: [], operations: [], ...(entry.chapter === undefined ? {} : { chapter: [] }) } },
          ...entry.screens.map((screen) => ({ screen })),
          ...entry.operations.map((operation) => ({ operation })),
          ...(entry.chapter ?? []).map((chapterBlock) => ({ chapterBlock })),
          ...(locationsOf.get(feature.id)?.items ?? []).map((locationItem) => ({ locationItem })),
        ],
      };
    }
    if (dataUnit) yield { key: DATA_UNIT, pieces: [...technical.data.tables.map((table) => ({ table })), ...technical.data.dropped.map((dropped) => ({ dropped }))] };
    if (dictionaryUnit) yield { key: DICTIONARIES_UNIT, pieces: [...technical.dictionaries.dictionaries.map((dictionary) => ({ dictionary })), ...technical.dictionaries.mismatches.map((mismatch) => ({ mismatch }))] };
  }
  return { core, units };
}

/** The data `core` and `units` (the units `splitPageData` yields, or the pieces read back from the parts) came from. */
export function restorePageData(core, units) {
  const piecesOf = new Map([...units].map((unit) => [unit.key, unit.pieces]));
  const features = core.features.map((feature) => {
    const pieces = piecesOf.get(featureUnitKey(feature.id));
    if (pieces === undefined) return feature;
    const head = pieces[0].entry;
    return { ...feature, entry: { ...head, screens: tagged(pieces, 'screen'), operations: tagged(pieces, 'operation'), ...(head.chapter === undefined ? {} : { chapter: tagged(pieces, 'chapterBlock') }) } };
  });
  const restored = { ...core, features };
  if (core.technical !== undefined) {
    const { technical } = core;
    const dataPieces = piecesOf.get(DATA_UNIT);
    const dictionaryPieces = piecesOf.get(DICTIONARIES_UNIT);
    restored.technical = {
      ...technical,
      locations: technical.locations.map((unit) => {
        const pieces = piecesOf.get(featureUnitKey(unit.id));
        return pieces === undefined ? unit : { ...unit, items: tagged(pieces, 'locationItem') };
      }),
      ...(dataPieces === undefined ? {} : { data: { ...technical.data, tables: tagged(dataPieces, 'table'), dropped: tagged(dataPieces, 'dropped') } }),
      ...(dictionaryPieces === undefined ? {} : { dictionaries: { ...technical.dictionaries, dictionaries: tagged(dictionaryPieces, 'dictionary'), mismatches: tagged(dictionaryPieces, 'mismatch') } }),
    };
  }
  return restored;
}
