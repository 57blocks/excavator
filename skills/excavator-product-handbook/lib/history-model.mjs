/**
 * The code health as the outputs write it (openspec change
 * handbook-history-appendix, design D2 and D4): `<out>/entries/history.json`
 * (history-shape.mjs) with what only the assembly knows added: the name of each
 * file, the application of each file of a pair, and the verified features of the
 * run (a feature the file names that is not verified now is left out). Both outputs
 * build it here. The product view and the page's product part never show a path:
 * they show `name` and the application.
 */

import { isUnder } from './applications.mjs';
import { loadHistorySection } from './history-shape.mjs';
import { TEST_CONVENTIONS } from './history-tests.mjs';

const nameOf = (path) => path.slice(path.lastIndexOf('/') + 1);

/** The model of a run that has no usable history file (`state` says why). */
const withoutFile = (state) => ({ state, noHistory: null, years: [], apps: [], hotspots: [], coChange: [], tests: [], conventions: TEST_CONVENTIONS.map((convention) => convention.id) });

/** The model of an output that was given none (an older caller): the file was not written. */
export const NO_HISTORY_FILE = Object.freeze(withoutFile('missing'));

/**
 * `{ state, noHistory, years, apps, hotspots, coChange, tests, conventions }`. `state` is `ok`, `missing` or `malformed`. `hotspots` rows
 * carry `name` (the file name) beside `path`, `coChange` rows the name and the application of each file (null for a file in none).
 * `roots` are the application roots of the project, `entries` the verified entries of the run (`Map` id -> entry).
 */
export function buildHistory(outDir, { roots, entries }) {
  const loaded = loadHistorySection(outDir);
  if (loaded.state !== 'ok') return withoutFile(loaded.state);
  const { history } = loaded;
  const appOf = (path) => roots.find((dir) => isUnder(path, dir)) ?? null;
  return {
    state: 'ok',
    noHistory: history.noHistory,
    years: history.years,
    apps: history.apps,
    hotspots: history.hotspots.map((row) => ({ ...row, name: nameOf(row.path), features: row.features.filter((id) => entries.has(id)) })),
    coChange: history.coChange.map((row) => ({ a: row.a, b: row.b, aName: nameOf(row.a), bName: nameOf(row.b), appA: appOf(row.a), appB: appOf(row.b), commits: row.commits })),
    tests: history.tests,
    conventions: TEST_CONVENTIONS.map((convention) => convention.id),
  };
}
