/**
 * The git facts of the code health chapter (openspec change
 * handbook-history-appendix, design D2): for each application root, its commits
 * (no merges) by author time in UTC, read with read-only git commands, and from
 * them the years, the first and last commit day, the commits, the authors and
 * the authors that make up 80% of the commits. An author is a lowercased author
 * email, as the system facts count them (system-facts.mjs). Nothing here writes
 * to the project or to git.
 */

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const GIT_BUFFER_BYTES = 256 * 1024 * 1024;
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** The share of the commits the counted authors must reach, as a fraction (`AUTHOR_SHARE_NUM` / `AUTHOR_SHARE_DEN`): 80%. */
export const AUTHOR_SHARE_NUM = 8;
export const AUTHOR_SHARE_DEN = 10;

/**
 * The fewest authors whose commits are not fewer than 80% of all of them, taking the authors with the most commits first.
 * `counts` is the number of commits of each author; the empty list has no author to count.
 */
export function authorsFor(counts) {
  const sorted = [...counts].sort((a, b) => b - a);
  const total = sorted.reduce((sum, count) => sum + count, 0);
  let covered = 0;
  for (const [index, count] of sorted.entries()) {
    covered += count;
    if (covered * AUTHOR_SHARE_DEN >= total * AUTHOR_SHARE_NUM) return index + 1;
  }
  return 0;
}

/** The commits of the directory `dir` (project-relative) as `[{ hash, seconds, author }]`, newest first as git prints them; null when git cannot read a repository there. */
export function readCommits(projectRoot, dir) {
  let output;
  try {
    output = execFileSync('git', ['-C', dir === '.' ? projectRoot : join(projectRoot, dir), 'log', '--no-merges', '--full-history', '--format=%H%x09%at%x09%ae', '--', '.'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: GIT_BUFFER_BYTES,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    });
  } catch {
    return null;
  }
  return output.split('\n').filter((line) => line !== '').map((line) => {
    const [hash, seconds, author] = line.split('\t');
    return { hash, seconds: Number(seconds), author: (author ?? '').trim().toLowerCase() };
  });
}

const dayOf = (seconds) => new Date(seconds * 1000).toISOString().slice(0, 10);
const yearOf = (seconds) => new Date(seconds * 1000).getUTCFullYear();

/** The application row of a directory with these commits (`reason` null), or with none (`no-commits`). */
function appRow(dir, commits) {
  if (commits.length === 0) return { dir, first: null, last: null, commits: null, authors: null, authors80: null, reason: 'no-commits' };
  const days = commits.map((commit) => dayOf(commit.seconds)).sort(compare);
  const byAuthor = new Map();
  for (const commit of commits) byAuthor.set(commit.author, (byAuthor.get(commit.author) ?? 0) + 1);
  return { dir, first: days[0], last: days.at(-1), commits: commits.length, authors: byAuthor.size, authors80: authorsFor([...byAuthor.values()]), reason: null };
}

/** The row of a directory that has no history to count, with the reason. */
const unavailableRow = (dir, reason) => ({ dir, first: null, last: null, commits: null, authors: null, authors80: null, reason });

/**
 * The years: one row from the year of the first commit to the year of the last, a year with no commit with a zero. `commits` is the number of
 * distinct commits of the year over all applications (a commit that changes two applications counts once); `byApp` the commits of each
 * application that has some in the year, in the order of the roots.
 */
function yearRows(perApp) {
  const years = new Set();
  for (const { commits } of perApp) for (const commit of commits) years.add(yearOf(commit.seconds));
  if (years.size === 0) return [];
  const first = Math.min(...years);
  const last = Math.max(...years);
  const rows = [];
  for (let year = first; year <= last; year += 1) {
    const hashes = new Set();
    const byApp = {};
    for (const { dir, commits } of perApp) {
      const own = commits.filter((commit) => yearOf(commit.seconds) === year);
      for (const commit of own) hashes.add(commit.hash);
      if (own.length > 0) byApp[dir] = own.length;
    }
    rows.push({ year, commits: hashes.size, byApp });
  }
  return rows;
}

/**
 * `{ apps, years }` for the application roots `roots` of the project at `projectRoot`. With `noHistory` (the project has none: its
 * reason), every application row is null with that reason and there are no years; otherwise an application git cannot read is
 * `not-a-repository` and one with no commit under it is `no-commits`.
 */
export function historyFacts(projectRoot, roots, noHistory) {
  if (noHistory !== null) return { apps: roots.map((dir) => unavailableRow(dir, noHistory.reason)), years: [] };
  const perApp = roots.map((dir) => ({ dir, commits: readCommits(projectRoot, dir) }));
  return {
    apps: perApp.map(({ dir, commits }) => (commits === null ? unavailableRow(dir, 'not-a-repository') : appRow(dir, commits))),
    years: yearRows(perApp.filter(({ commits }) => commits !== null)),
  };
}
