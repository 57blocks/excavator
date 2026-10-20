/**
 * history.mjs
 *
 * One `git log` per repository, parsed as a stream, in git's default order
 * (newest first, no `--topo-order` or `--date-order`). Read-only: nothing here
 * writes to the project or to Git state.
 *
 *   git log <head> --no-merges -M -l0 --raw --numstat -z
 *           --format=%x01%H%x00%aE%x00%cI
 *
 * `--raw` gives each change's status (add, delete, modify, rename) and
 * `--numstat` its line counts; both come out of the same diff, in the same
 * order, and are matched by position. `-l0` removes git's rename-detection
 * file limit (past it git silently skips detection and prints a localized
 * warning). `%aE` is the author email after mailmap.
 *
 * HEAD decides the result. git runs with no work tree (an empty directory is
 * both its cwd and its `--work-tree`), no user or system config, and mailmap
 * and attributes read from the snapshot's commit, so an untracked `.mailmap`
 * or `.gitattributes`, or the host's config, cannot change a count. Settings
 * that would otherwise take their value from config are written out.
 *
 * Window. git is never given the date: `--since` completes a bare date with
 * the current time of day and stops walking at the first commit that looks too
 * old. All history is read and a commit counts only if its committer time is
 * not before the window start; the others are skipped whole, their renames and
 * adds included.
 *
 * Lineage. The walk over commits, newest first, and the path map it follows
 * live in lineage.mjs; here each commit's changes are attributed by what it
 * returns, and the lineage conflicts it reports are counted on the files.
 *
 * Shallow clones. The boundary commits listed in the repository's `shallow`
 * file show up as adding every file they contain. They are skipped entirely:
 * counting them would add one commit to every file and break "a lower bound".
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { createLineage } from './lineage.mjs';

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_ATTR_NOSYSTEM: '1',
  LC_ALL: 'C',
};
delete GIT_ENV.GIT_CONFIG_COUNT;
delete GIT_ENV.GIT_CONFIG_PARAMETERS;
const MAX_BUFFER = 1024 * 1024 * 1024;

const COMMIT_HEAD = /^\x01([0-9a-f]{40}|[0-9a-f]{64})$/;
const RAW_RECORD = /^:\d{6} \d{6} [0-9a-f]+ [0-9a-f]+ ([A-Z])\d*$/;
const NUMSTAT = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/;

/** The repository's own git directory, found the one time git is allowed to look at the work tree. */
function gitDirOf(dir) {
  const result = spawnSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: dir, env: GIT_ENV, encoding: 'utf-8' });
  if (result.status !== 0) throw new Error(`git rev-parse failed in ${dir}: ${(result.stderr || '').trim() || result.status}`);
  return result.stdout.trim();
}

/**
 * How to run git so that only `sha` and the repository's objects matter: a
 * given git directory, an empty work tree (also the cwd), mailmap and
 * attributes from `sha`'s tree, and the output-shaping defaults pinned.
 * `empty` is a directory with nothing in it.
 */
function isolatedGit(dir, sha, empty) {
  const prefix = [
    '--git-dir', gitDirOf(dir), '--work-tree', empty,
    '-c', `mailmap.blob=${sha}:.mailmap`, '-c', 'mailmap.file=', '-c', `attr.tree=${sha}`,
    '-c', 'core.attributesFile=/dev/null', '-c', 'log.showRoot=true',
    '-c', 'log.showSignature=false', // with it set, git prints each signed commit's verification text into the stream
  ];
  const args = (rest) => [...prefix, ...rest];
  const options = { cwd: empty, env: GIT_ENV };
  const run = (rest) => {
    const result = spawnSync('git', args(rest), { ...options, encoding: 'utf-8', maxBuffer: MAX_BUFFER });
    if (result.status !== 0) throw new Error(`git ${rest.join(' ')} failed in ${dir}: ${(result.stderr || '').trim() || result.status}`);
    return result.stdout;
  };
  return { args, options, run };
}

/** The shas of a shallow clone's boundary commits (empty set when not shallow). */
function readShallow(git) {
  if (git.run(['rev-parse', '--is-shallow-repository']).trim() !== 'true') {
    return { shallow: false, boundary: new Set() };
  }
  const file = resolve(git.options.cwd, git.run(['rev-parse', '--git-path', 'shallow']).trim());
  const shas = readFileSync(file, 'utf-8').split('\n').map((line) => line.trim()).filter(Boolean);
  return { shallow: true, boundary: new Set(shas) };
}

/** `%cI` of the oldest commit reachable from `sha`, merges included, whatever the window. */
function earliestCommitTime(git, sha) {
  let best = null;
  let bestMs = Infinity;
  for (const line of git.run(['log', sha, '--format=%cI']).split('\n')) {
    if (line === '') continue;
    const ms = Date.parse(line);
    if (ms < bestMs) {
      bestMs = ms;
      best = line;
    }
  }
  return best;
}

/**
 * Push-style parser for the NUL-separated log stream. Every token is read at a
 * known position, so a path that looks like a record is still just a path.
 *
 *   header:  \x01<sha> NUL <email> NUL <commit time> NUL
 *   raw:     [LF]:<modes and ids> <status> NUL <path> NUL            (R/C: <old> NUL <new> NUL)
 *   numstat: <added> TAB <removed> TAB <path> NUL                    (R/C: ... TAB NUL <old> NUL <new> NUL)
 *
 * `onCommit({ sha, email, time, ms, records })` fires per commit that has changes;
 * a record is `{ status, path, oldPath, added, removed }` with `added`/`removed`
 * `null` for a change git calls binary.
 */
function createLogParser(onCommit) {
  let phase = 'head';
  let commit = null;
  let record = null;
  let names = [];
  let need = 0;
  let next = 0; // the record waiting for its numstat line

  const stripLf = (token) => (token.startsWith('\n') ? token.slice(1) : token);
  const fail = (token) => { throw new Error(`unexpected token in git log output (${phase}): ${JSON.stringify(token.slice(0, 80))}`); };
  const finish = () => {
    if (commit.records.length > 0) onCommit(commit);
    commit = null;
    phase = 'head';
  };
  const numstatDone = () => {
    next += 1;
    if (next === commit.records.length) finish();
  };

  function push(raw) {
    if (phase === 'head') {
      const match = COMMIT_HEAD.exec(stripLf(raw));
      if (!match) fail(raw);
      commit = { sha: match[1], email: '', time: '', ms: 0, records: [] };
      next = 0;
      phase = 'email';
    } else if (phase === 'email') {
      commit.email = raw;
      phase = 'time';
    } else if (phase === 'time') {
      commit.time = raw;
      commit.ms = Date.parse(raw);
      if (Number.isNaN(commit.ms)) fail(raw);
      phase = 'raw';
    } else if (phase === 'raw') {
      const token = stripLf(raw);
      const match = RAW_RECORD.exec(token);
      if (match) {
        record = { status: match[1], path: '', oldPath: null, added: 0, removed: 0 };
        names = [];
        need = match[1] === 'R' || match[1] === 'C' ? 2 : 1;
        phase = 'raw-paths';
      } else if (NUMSTAT.test(token) && commit.records.length > 0) {
        phase = 'numstat';
        push(token);
      } else if (COMMIT_HEAD.test(token) && commit.records.length === 0) {
        finish(); // a commit with no changes
        push(raw);
      } else {
        fail(raw);
      }
    } else if (phase === 'raw-paths') {
      names.push(raw);
      if (names.length === need) {
        record.path = names[need - 1];
        record.oldPath = need === 2 ? names[0] : null;
        commit.records.push(record);
        phase = 'raw';
      }
    } else if (phase === 'numstat') {
      const match = NUMSTAT.exec(raw);
      const target = commit.records[next];
      if (!match || !target) fail(raw);
      target.added = match[1] === '-' ? null : Number(match[1]);
      target.removed = match[2] === '-' ? null : Number(match[2]);
      if (match[3] === '') {
        names = [];
        phase = 'numstat-paths';
      } else if (match[3] === target.path) {
        numstatDone();
      } else {
        fail(raw);
      }
    } else if (phase === 'numstat-paths') {
      names.push(raw);
      if (names.length === 2) {
        const target = commit.records[next];
        if (names[0] !== target.oldPath || names[1] !== target.path) fail(raw);
        phase = 'numstat';
        numstatDone();
      }
    }
  }

  function end() {
    if (phase === 'raw' && commit.records.length === 0) finish();
    if (phase !== 'head') throw new Error(`git log output ended inside a commit (${phase})`);
  }

  return { push, end };
}

/** Feed `git log` stdout to `parser` token by token without holding more than one chunk. */
async function parseStream(stdout, parser) {
  let carry = Buffer.alloc(0);
  for await (const chunk of stdout) {
    const buf = carry.length === 0 ? chunk : Buffer.concat([carry, chunk]);
    let start = 0;
    for (let nul = buf.indexOf(0, start); nul !== -1; nul = buf.indexOf(0, start)) {
      parser.push(buf.toString('utf8', start, nul));
      start = nul + 1;
    }
    carry = buf.subarray(start);
  }
  if (carry.length > 0 && carry.toString('utf8') !== '\n') throw new Error('git log output ended inside a token');
  parser.end();
}

function fileEntry(files, path) {
  let file = files.get(path);
  if (file === undefined) {
    file = {
      commits: new Set(), authors: new Set(), changes: 0, added: 0, removed: 0, binaryChange: false,
      last: null, lastMs: -Infinity, lineageConflicts: 0,
    };
    files.set(path, file);
  }
  return file;
}

function addChange(files, path, commitId, authorId, commit, record) {
  const file = fileEntry(files, path);
  file.changes += 1;
  file.commits.add(commitId);
  file.authors.add(authorId);
  if (record.added === null) {
    file.binaryChange = true;
  } else {
    file.added += record.added;
    file.removed += record.removed;
  }
  if (commit.ms > file.lastMs) {
    file.lastMs = commit.ms;
    file.last = commit.time;
  }
}

/**
 * @param {{
 *   dir: string,                 repository working-tree root
 *   sha: string,                 the commit to read history from (the snapshot's HEAD)
 *   selected: Set<string>,       repo-relative paths of the selected files
 *   sinceMs: number | null,      window start (committer time, epoch milliseconds, inclusive)
 *   ids: { commits: number, authors: Map<string, number>, years: string[], authorOf: number[] },
 *                                shared across repos so commits and authors are
 *                                distinct per repo yet comparable inside a directory;
 *                                `years[commitId]` is the year of the committer date
 *                                as git prints it, the year `lastChanged` shows;
 *                                `authorOf[commitId]` is the commit's author id
 * }} input
 * @returns {Promise<{
 *   files: Map<string, { commits: Set<number>, authors: Set<number>, changes: number, added: number,
 *                        removed: number, binaryChange: boolean, last: string | null, lastMs: number,
 *                        lineageConflicts: number }>,
 *   changesRead: number, outsideSelection: number, boundaryCommits: number,
 *   shallow: boolean, earliestVisibleCommit: string | null,
 * }>}
 */
export async function readRepoHistory({ dir, sha, selected, sinceMs, ids }) {
  const empty = mkdtempSync(join(tmpdir(), 'excavator-hotspots-'));
  try {
    return await readIsolated({ git: isolatedGit(dir, sha, empty), dir, sha, selected, sinceMs, ids });
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
}

async function readIsolated({ git, dir, sha, selected, sinceMs, ids }) {
  const { shallow, boundary } = readShallow(git);
  const files = new Map();
  const lineage = createLineage(selected);
  const totals = { changesRead: 0, outsideSelection: 0 };

  const onCommit = (commit) => {
    if ((sinceMs !== null && commit.ms < sinceMs) || boundary.has(commit.sha)) return;
    const commitId = ids.commits++;
    ids.years[commitId] = commit.time.slice(0, 4);
    const email = commit.email.toLowerCase();
    if (!ids.authors.has(email)) ids.authors.set(email, ids.authors.size);
    const authorId = ids.authors.get(email);
    ids.authorOf[commitId] = authorId;
    const { targets, conflicts } = lineage.step(commit.records);
    commit.records.forEach((record, i) => {
      totals.changesRead += 1;
      if (targets[i] === undefined) totals.outsideSelection += 1;
      else addChange(files, targets[i], commitId, authorId, commit, record);
    });
    for (const path of conflicts) fileEntry(files, path).lineageConflicts += 1;
  };

  const args = git.args([
    'log', sha, '--no-merges', '-M', '-l0', '--diff-algorithm=myers', '--no-ext-diff', '--no-textconv',
    '--raw', '--numstat', '-z', '--format=%x01%H%x00%aE%x00%cI',
  ]);
  const child = spawn('git', args, { ...git.options, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const exited = new Promise((resolveExit, rejectExit) => {
    child.on('error', rejectExit);
    child.on('close', resolveExit);
  });
  exited.catch(() => {}); // surfaced by the await below; this only keeps an early failure from being unhandled
  try {
    await parseStream(child.stdout, createLogParser(onCommit));
  } catch (error) {
    child.kill();
    throw error;
  }
  const code = await exited;
  if (code !== 0) throw new Error(`git log failed in ${dir}: ${stderr.trim() || code}`);

  return {
    files, ...totals, boundaryCommits: boundary.size, shallow, earliestVisibleCommit: earliestCommitTime(git, sha),
  };
}

export default { readRepoHistory };
