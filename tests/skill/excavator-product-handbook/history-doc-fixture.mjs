/**
 * A hand-written history file (code health) for the output tests: the fixture project has one application root, `.`.
 * Every value is about the fixture's own code.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const HISTORY_FORMAT = 'excavator-product-handbook-history/1';

/** A history file for the fixture project; `F1`, `F3` and `F2` are the features that cite the first hotspot. */
export function goodHistory() {
  return {
    format: HISTORY_FORMAT,
    noHistory: null,
    years: [{ year: 2022, commits: 3, byApp: { '.': 3 } }, { year: 2023, commits: 0, byApp: {} }, { year: 2024, commits: 5, byApp: { '.': 5 } }],
    apps: [{ dir: '.', first: '2022-03-01', last: '2024-09-09', commits: 8, authors: 2, authors80: 1, reason: null }],
    hotspots: [
      { path: 'src/routes/orders.js', app: '.', commits: 5, authors: 2, lines: 20, last: '2024-09-09', uncertain: 0, features: ['F1', 'F3', 'F2'] },
      { path: 'src/app.js', app: '.', commits: 2, authors: 1, lines: 9, last: '2023-01-01', uncertain: 0, features: [] },
    ],
    coChange: [{ a: 'src/app.js', b: 'src/routes/orders.js', commits: 4 }],
    tests: [{ dir: '.', sourceFiles: 9, testFiles: 2 }],
  };
}

/** Write a history file into the run's output directory (`entries/history.json`). */
export function writeHistory(run, doc = goodHistory()) {
  mkdirSync(join(run.out, 'entries'), { recursive: true });
  run.writeJson(join(run.out, 'entries', 'history.json'), doc);
}
