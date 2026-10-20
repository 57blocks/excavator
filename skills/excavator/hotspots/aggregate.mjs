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
 * Its `concentration` counts the same union by author, leaving out commits by
 * bots (an author email whose local part ends in `[bot]`): the commits by
 * people, the share of them by the author with the most, and how few authors
 * make up at least 80% of them.
 * A feature group's row is counted like a directory's, over the files the
 * groups file lists for it (hotspots/groups.mjs) instead of the files below a
 * path; a group with no matched file has `files` 0 and no history to count.
 * History fields are `null` when there is no history to count, never 0. A sum
 * (lines, added, removed, score) skips `null` terms and is `null` when every
 * term is.
 */

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** In an author email (lowercased, after mailmap), the end of a GitHub app account's local part. */
export const BOT_EMAIL_MARKER = '[bot]@';

/** `count / total`, rounded half up to two decimals from an integer numerator. */
const share = (count, total) => Math.round((count * 100) / total) / 100;

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

const emptyDir = (path) => ({
  path, files: 0, lines: null, hasHistory: false, commits: new Set(), authors: new Set(),
  added: null, removed: null, score: null, last: null, lastMs: -Infinity,
});

function foldIntoDir(dirs, path, row, history) {
  let dir = dirs.get(path);
  if (dir === undefined) {
    dir = emptyDir(path);
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

function concentrationOf(commits, authorOf, bots) {
  const byAuthor = new Map();
  for (const commit of commits) {
    const author = authorOf[commit];
    if (!bots.has(author)) byAuthor.set(author, (byAuthor.get(author) ?? 0) + 1);
  }
  const counts = [...byAuthor.values()].sort((a, b) => b - a);
  const commitsByPeople = counts.reduce((sum, count) => sum + count, 0);
  if (commitsByPeople === 0) return { commitsByPeople, topAuthorShare: null, authorsFor80Percent: null };
  let covered = 0;
  let authors = 0;
  while (covered * 5 < commitsByPeople * 4) covered += counts[authors++];
  return { commitsByPeople, topAuthorShare: share(counts[0], commitsByPeople), authorsFor80Percent: authors };
}

function dirRow(dir, years, ids, bots) {
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
    commitsByYear: has ? countByYear(dir.commits, years, ids.years) : null,
    concentration: has ? concentrationOf(dir.commits, ids.authorOf, bots) : null,
  };
}

/** A group's row: its name, paths and unmatched paths, then a directory row's counts over its files. */
function groupRow(group, folded, years, ids, bots) {
  const counts = dirRow(folded.get(group.name) ?? emptyDir(group.name), years, ids, bots);
  delete counts.path;
  return { name: group.name, paths: group.paths, unmatchedPaths: group.unmatchedPaths, ...counts };
}

/**
 * @param {Array<{ path: string, hasHistory: boolean, lines: number | null }>} entries
 *   the selected files; `lines` is `null` for a binary file, `hasHistory` is
 *   whether a repository's history covers the file
 * @param {Map<string, object>} histories per-file history from history.mjs, by entry path
 * @param {{ authors: Map<string, number>, years: string[], authorOf: number[] }} ids
 *   author ids by lowercased email, and the year and author id of each commit id
 * @param {Array<{ name: string, paths: string[], unmatchedPaths: string[], files: string[] }>} [groups]
 *   feature groups matched to the selected files (hotspots/groups.mjs)
 * @returns {{ files: object[], directories: object[], groups: object[], botCommits: number }} ranked
 *   rows, group rows in the groups' order, and the commits counted for the project root whose author is a bot
 */
export function buildRows(entries, histories, ids, groups = []) {
  const files = [];
  const dirs = new Map();
  const byPath = new Map();
  for (const entry of entries) {
    const history = entry.hasHistory ? histories.get(entry.path) ?? NO_COMMITS : null;
    const row = fileRow(entry, history);
    files.push(row);
    byPath.set(entry.path, { row, history });
    for (const dir of ancestorDirs(entry.path)) foldIntoDir(dirs, dir, row, history);
  }
  const folded = new Map();
  for (const group of groups) {
    for (const path of group.files) {
      const { row, history } = byPath.get(path);
      foldIntoDir(folded, group.name, row, history);
    }
  }
  const root = dirs.get('.');
  const years = yearRange(root, ids.years);
  const bots = new Set([...ids.authors].filter(([email]) => email.includes(BOT_EMAIL_MARKER)).map(([, id]) => id));
  let botCommits = 0;
  for (const commit of root?.commits ?? []) if (bots.has(ids.authorOf[commit])) botCommits += 1;
  return {
    files: files.sort(compareRows),
    directories: [...dirs.values()].map((dir) => dirRow(dir, years, ids, bots)).sort(compareRows),
    groups: groups.map((group) => groupRow(group, folded, years, ids, bots)),
    botCommits,
  };
}

export default { BOT_EMAIL_MARKER, compareRows, buildRows };
