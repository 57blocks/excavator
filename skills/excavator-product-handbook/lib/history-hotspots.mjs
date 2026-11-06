/**
 * The files that change most and the files changed together, for the code
 * health chapter (openspec change handbook-history-appendix, design D2). Both
 * come from the hotspot product (`skills/excavator/hotspots.mjs`), computed in
 * memory with `buildHotspots`; nothing is written, so the project (and its
 * `.excavator` directory) is not touched. A file belongs to the application root
 * that holds it; a pair counts only when its two files are in different
 * applications (the product lists the pairs inside one application too).
 */

import { isUnder } from './applications.mjs';
import { buildHotspots } from '../../excavator/hotspots.mjs';

export const HOTSPOT_FILES = 15;
export const CO_CHANGE_PAIRS = 10;

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
/** The UTC day of an instant the product writes as a time text. */
const dayOf = (text) => new Date(text).toISOString().slice(0, 10);

/**
 * `{ noHistory, hotspots, coChange }` for the project at `projectRoot` (a canonical path) whose application roots are `roots`;
 * `featuresOf(path)` gives the ids of the verified features that cite a file. `noHistory` is null, or `{ reason }` when the
 * product read no repository (then the lists are empty).
 */
export async function hotspotFacts(projectRoot, roots, featuresOf) {
  const product = await buildHotspots(projectRoot);
  if (!product.historyAvailable) return { noHistory: { reason: product.noHistory.reason }, hotspots: [], coChange: [] };
  const appOf = (path) => roots.find((dir) => isUnder(path, dir)) ?? null;
  const hotspots = product.files
    .filter((row) => row.score !== null && row.commits > 0)
    .sort((a, b) => b.score - a.score || b.commits - a.commits || compare(a.path, b.path))
    .slice(0, HOTSPOT_FILES)
    .map((row) => ({ path: row.path, app: appOf(row.path), commits: row.commits, authors: row.authors, lines: row.lines, last: dayOf(row.lastChanged), features: featuresOf(row.path) }));
  const coChange = product.pairs
    .filter((pair) => {
      const a = appOf(pair.a);
      const b = appOf(pair.b);
      return a !== null && b !== null && a !== b;
    })
    .sort((x, y) => y.together - x.together || compare(x.a, y.a) || compare(x.b, y.b))
    .slice(0, CO_CHANGE_PAIRS)
    .map((pair) => ({ a: pair.a, b: pair.b, commits: pair.together }));
  return { noHistory: null, hotspots, coChange };
}
