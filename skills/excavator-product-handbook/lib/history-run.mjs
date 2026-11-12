/**
 * `handbook.mjs history <out> --project <root>` (openspec change
 * handbook-history-appendix, design D2): compute the code health facts from git
 * and the project files, check the shape, write `<out>/entries/history.json` and
 * return the line the run reports. No model, no build of the project, and
 * nothing is written under the project root. Written on every call: the facts
 * are deterministic and cost one read of the history. Nothing is written unless
 * the file passes its own shape check.
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { scanProject } from './applications.mjs';
import { featuresByFile } from './history-features.mjs';
import { historyFacts } from './history-facts.mjs';
import { hotspotFacts } from './history-hotspots.mjs';
import { HISTORY_FILE, HISTORY_FORMAT, checkHistoryShape } from './history-shape.mjs';
import { countTestFiles } from './history-tests.mjs';
import { writeJson } from './json-file.mjs';

const count = (n, noun) => `${n} ${noun}${n === 1 ? '' : 's'}`;

/** The report line, computed from the file's own lists. */
export function historyLine(history) {
  const tests = history.tests.reduce((sum, row) => sum + row.testFiles, 0);
  const sources = history.tests.reduce((sum, row) => sum + row.sourceFiles, 0);
  if (history.noHistory !== null) return `History: no version history (${history.noHistory.reason}); ${count(tests, 'test file')} in ${count(history.apps.length, 'application')}.`;
  const commits = history.years.reduce((sum, row) => sum + row.commits, 0);
  const span = history.years.length === 0 ? '' : ` (${history.years[0].year} to ${history.years.at(-1).year})`;
  return `History: ${count(history.years.length, 'year')}${span}, ${count(history.apps.length, 'application')}, ${count(commits, 'commit')}; ${count(history.coChange.length, 'pair')} changed together across applications; ${count(tests, 'test file')} (${count(sources, 'source file')}).`;
}

/** Write `<out>/entries/history.json`; returns `{ status, lines }`. A shape problem is a bug here: exit 1, nothing written, every problem printed. */
export async function runHistory(projectRootArg, out) {
  const scan = scanProject(projectRootArg);
  const byFile = featuresByFile(out);
  const hot = await hotspotFacts(scan.root, scan.roots, (path) => byFile.get(path) ?? []);
  const { apps, years } = historyFacts(scan.root, scan.roots, hot.noHistory);
  const history = {
    format: HISTORY_FORMAT,
    noHistory: hot.noHistory,
    years,
    apps,
    hotspots: hot.hotspots,
    coChange: hot.coChange,
    tests: countTestFiles(scan.root, scan.roots),
  };
  const problems = checkHistoryShape(history);
  if (problems.length > 0) return { status: 1, lines: ['history.json was not written: the facts fail their own shape check', ...problems] };
  mkdirSync(join(out, 'entries'), { recursive: true });
  writeJson(join(out, HISTORY_FILE), history);
  return { status: 0, lines: [historyLine(history)] };
}
