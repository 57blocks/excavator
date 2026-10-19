/**
 * aggregate.mjs
 *
 * Turns per-file history and HEAD line counts into the product's rows: one row
 * per selected file, one per directory level (the project root `.` included),
 * both ranked by score.
 *
 * File score is `commits x lines`; a directory's score is the sum of its files'.
 * A directory's commits and authors are the de-duplicated union over its files:
 * adding the file rows up would count one commit once per file it touched.
 * A directory's `commitsByYear` splits that union by the year of each commit's
 * committer date, with a key for every year from the product's first counted
 * commit to its last (0 for a year without one), so its values add up to `commits`.
 * History fields are `null` when there is no history to count, never 0. A sum
 * (lines, added, removed, score) skips `null` terms and is `null` when every
 * term is.
 */

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Read-only stand-in for a file of a repository with no commit in the window. */
const NO_COMMITS = Object.freeze({
  commits: new Set(),
  authors: new Set(),
  added: 0,
  removed: 0,
  binaryChange: false,
  last: null,
  lastMs: -Infinity,
  lineageConflicts: 0,
});

/** `sum + term`, where `null` is "no term yet" for the sum and "unknown" for the term. */
const addTerm = (sum, term) => (term === null ? sum : (sum ?? 0) + term);

/** Score descending, then commits descending, then path; a `null` score sorts last, by path. */
export function compareRows(a, b) {
  if (a.score === null || b.score === null) {
    if (a.score !== b.score) return a.score === null ? 1 : -1;
    return compareText(a.path, b.path);
  }
  return b.score - a.score || b.commits - a.commits || compareText(a.path, b.path);
}

function fileRow({ path, lines }, history) {
  if (history === null) {
    return {
      path, commits: null, authors: null, added: null, removed: null, lastChanged: null, lines, score: null, lineageConflicts: 0,
    };
  }
  return {
    path,
    commits: history.commits.size,
    authors: history.authors.size,
    added: history.binaryChange ? null : history.added,
    removed: history.binaryChange ? null : history.removed,
    lastChanged: history.last,
    lines,
    score: lines === null ? null : history.commits.size * lines,
    lineageConflicts: history.lineageConflicts,
  };
}

/** `a/b/c.txt` -> `.`, `a`, `a/b`. */
function* ancestorDirs(path) {
  yield '.';
  for (let slash = path.indexOf('/'); slash !== -1; slash = path.indexOf('/', slash + 1)) yield path.slice(0, slash);
}

function foldIntoDir(dirs, path, row, history) {
  let dir = dirs.get(path);
  if (dir === undefined) {
    dir = {
      path, files: 0, lines: null, hasHistory: false, commits: new Set(), authors: new Set(),
      added: null, removed: null, score: null, last: null, lastMs: -Infinity,
    };
    dirs.set(path, dir);
  }
  dir.files += 1;
  dir.lines = addTerm(dir.lines, row.lines);
  if (history === null) return;
  dir.hasHistory = true;
  for (const commit of history.commits) dir.commits.add(commit);
  for (const author of history.authors) dir.authors.add(author);
  dir.added = addTerm(dir.added, row.added);
  dir.removed = addTerm(dir.removed, row.removed);
  dir.score = addTerm(dir.score, row.score);
  if (history.last !== null && history.lastMs > dir.lastMs) {
    dir.lastMs = history.lastMs;
    dir.last = history.last;
  }
}

/** Every year from the first to the last counted commit of the product, oldest first. */
function yearRange(root, commitYears) {
  if (root === undefined || root.commits.size === 0) return [];
  let first = Infinity;
  let last = -Infinity;
  for (const commit of root.commits) {
    const year = Number(commitYears[commit]);
    first = Math.min(first, year);
    last = Math.max(last, year);
  }
  return Array.from({ length: last - first + 1 }, (_, i) => String(first + i));
}

function countByYear(commits, years, commitYears) {
  const counts = Object.fromEntries(years.map((year) => [year, 0]));
  for (const commit of commits) {
    const year = commitYears[commit];
    if (counts[year] === undefined) throw new Error(`commit ${commit} has no year in the product's range: ${year}`);
    counts[year] += 1;
  }
  return counts;
}

function dirRow(dir, years, commitYears) {
  const has = dir.hasHistory;
  return {
    path: dir.path,
    files: dir.files,
    lines: dir.lines,
    commits: has ? dir.commits.size : null,
    authors: has ? dir.authors.size : null,
    added: dir.added,
    removed: dir.removed,
    lastChanged: has ? dir.last : null,
    score: dir.score,
    commitsByYear: has ? countByYear(dir.commits, years, commitYears) : null,
  };
}

/**
 * @param {Array<{ path: string, hasHistory: boolean, lines: number | null }>} entries
 *   the selected files; `lines` is `null` for a binary file, `hasHistory` is
 *   whether a repository's history covers the file
 * @param {Map<string, object>} histories per-file history from history.mjs, by entry path
 * @param {string[]} commitYears year of the committer date, by commit id
 * @returns {{ files: object[], directories: object[] }} ranked rows
 */
export function buildRows(entries, histories, commitYears) {
  const files = [];
  const dirs = new Map();
  for (const entry of entries) {
    const history = entry.hasHistory ? histories.get(entry.path) ?? NO_COMMITS : null;
    const row = fileRow(entry, history);
    files.push(row);
    for (const dir of ancestorDirs(entry.path)) foldIntoDir(dirs, dir, row, history);
  }
  const years = yearRange(dirs.get('.'), commitYears);
  return {
    files: files.sort(compareRows),
    directories: [...dirs.values()].map((dir) => dirRow(dir, years, commitYears)).sort(compareRows),
  };
}

export default { compareRows, buildRows };
