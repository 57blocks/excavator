/**
 * The code health as the page data holds it (openspec change
 * handbook-history-appendix, design D4), from the model the handbook uses
 * (history-model.mjs). The product part has a file by its name and the
 * application it is in and no path; the paths are the technical part's
 * (`historyPlaces`), in the order of the rows.
 */

/** The page's `history`: `state` is `ok`, `missing` or `malformed`, the lists are empty unless it is `ok`. */
export const historyPageSection = (history) => ({
  state: history.state,
  noHistory: history.noHistory,
  years: history.years.map((row) => ({ year: row.year, commits: row.commits, byApp: { ...row.byApp } })),
  apps: history.apps.map((row) => ({ ...row })),
  hotspots: history.hotspots.map((row) => ({ name: row.name, app: row.app, commits: row.commits, authors: row.authors, lines: row.lines, last: row.last, features: [...row.features] })),
  coChange: history.coChange.map((row) => ({ a: row.aName, appA: row.appA, b: row.bName, appB: row.appB, commits: row.commits })),
  tests: history.tests.map((row) => ({ ...row })),
  conventions: [...history.conventions],
});

/** The page's `technical.history`: the path of each hotspot file and of each file of a pair, in the order of the rows of `history`. */
export const historyPlaces = (history) => ({
  hotspots: history.hotspots.map((row) => row.path),
  coChange: history.coChange.map((row) => ({ a: row.a, b: row.b })),
});
