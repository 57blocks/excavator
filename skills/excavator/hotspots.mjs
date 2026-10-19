#!/usr/bin/env node
/**
 * hotspots.mjs
 *
 * Change hotspots from Git history (openspec: changes/change-hotspots,
 * capability `change-hotspots`). No model, no build of the target, only
 * read-only git commands.
 *
 *   node hotspots.mjs <projectRoot> [--since YYYY-MM-DD]
 *
 * For every file the source snapshot selects, and every directory above them,
 * the product counts the commits, authors, added and removed lines and the last
 * change time inside the window, and ranks files by `commits x lines`. History
 * is read from the snapshot's HEAD only (working-tree changes are invisible),
 * merge commits are not counted, and a rename carries the history of the old
 * path to the new one (history.mjs, lineage.mjs). Lines are counted from the HEAD content.
 * `--since` is a UTC date: commits with committer time at or after 00:00:00 UTC
 * on that day are in the window; the product records that instant.
 *
 * Nothing that lacks history is reported as 0. A plain directory has no history
 * (all history fields `null`); in a multi-repo parent every member repository
 * is read on its own and files outside the members have none; a shallow clone
 * skips its boundary commit and says so in its `repos` row; a binary file has
 * no lines and no score.
 *
 * Lineage conflicts. One path map over a branched history is an approximation;
 * where the walk detects that it may be wrong (lineage.mjs) the file's
 * `lineageConflicts` counts it and `counts.filesWithLineageConflicts` counts the files.
 *
 * Conservation. Every change (commit x path) read is either attributed to a
 * selected file or counted as outside the selection (deleted, ignored or not
 * selected paths). A mismatch is an Error and nothing is written.
 *
 * Product `.excavator/hotspots.json`
 *   { format, sourceRevision, sourceKind, historyAvailable, repos, window, counts,
 *     conservation, residualAssumptions, files, directories }
 * `repos` has `{ path, head, shallow, boundaryCommits, earliestVisibleCommit }`
 * per repository (`.` for a repository at the project root, the member directory
 * in a multi-repo parent); `window` is `{ since, sinceUtc }`, both `null` without
 * a window. File rows: `{ path, commits, authors, added, removed, lastChanged,
 * lines, score, lineageConflicts }`; directory rows: `{ path, files, lines, commits, authors, added,
 * removed, lastChanged, score }` with `.` the project root.
 *
 * Contract: openspec/changes/change-hotspots/specs/change-hotspots/spec.md
 */

import { mkdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildRows } from './hotspots/aggregate.mjs';
import { countBlobLines, countBufferLines } from './hotspots/blob-lines.mjs';
import { readRepoHistory } from './hotspots/history.mjs';
import { assertDataDir, assertDataFile, bindProjectRoot } from './project-paths.mjs';
import { serializeJsonProduct } from './product-serialization.mjs';
import { resolveSourceSnapshot } from './source-snapshot.mjs';
import { listTrackedEntries } from './source-snapshot/git-utils.mjs';

/** Stamped on the product. An incompatible shape change bumps it. */
export const HOTSPOTS_FORMAT = 'excavator-hotspots/1';

/** The product's file name, inside `.excavator/`. */
export const HOTSPOTS_FILE = 'hotspots.json';

const RESIDUAL_ASSUMPTIONS = Object.freeze([
  'Merge commits are not counted.',
  'Renames are detected by git similarity; a rename with large content changes is read as one deletion plus one addition, and the earlier history is not carried over.',
  'Copies are not followed.',
  'History is attributed along a single path map, in the order git log shows the commits; on branched histories and subtree imports some changes can be missed or attributed to another file of the same name, and files with lineageConflicts above 0 are the ones where that was detected.',
  'Authors are told apart by mailmap-normalized email, ignoring case; one person using several emails without a mailmap entry counts as several authors.',
  'Line counts include blank lines and comments.',
  'If history was rewritten (squashed, rebased, imported from another system), changes before the rewrite are not visible.',
  'Repository-local .git/config and .git/info/attributes still affect rename detection and binary detection.',
]);

/** The UTC instant (epoch milliseconds) that opens a `YYYY-MM-DD` window, or an Error for anything else. */
export function sinceToMs(since) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(since);
  const [year, month, day] = match ? match.slice(1).map(Number) : [];
  const instant = new Date(0);
  if (match) instant.setUTCFullYear(year, month - 1, day);
  const valid = match !== null
    && instant.getUTCFullYear() === year && instant.getUTCMonth() === month - 1 && instant.getUTCDate() === day;
  if (!valid) throw new Error(`--since must be a calendar date YYYY-MM-DD, got ${JSON.stringify(since)}`);
  return instant.getTime();
}

/** Every change read must be attributed to a selected file or counted as outside the selection. */
export function assertConservation({ changesRead, attributed, outsideSelection }) {
  if (changesRead !== attributed + outsideSelection) {
    throw new Error(`change conservation violated: ${changesRead} changes read, ${attributed} attributed to selected files + ${outsideSelection} outside the selection`);
  }
}

/** The repositories whose history covers the snapshot's files. */
function reposOf(snapshot) {
  if (snapshot.kind === 'git') return [{ path: '.', prefix: '', dir: snapshot.root, sha: snapshot.sha }];
  if (snapshot.kind === 'multi-repo') {
    return snapshot.members.map((member) => ({ path: member.id, prefix: `${member.id}/`, dir: member.dir, sha: member.sha }));
  }
  return [];
}

/**
 * Compute the product for `root` (a canonical project root) without writing it.
 *
 * @param {string} root
 * @param {{ since?: string | null, readHistory?: typeof readRepoHistory }} [options]
 *   `readHistory` is a seam so a test can feed the conservation check a reader that miscounts.
 */
export async function buildHotspots(root, { since = null, readHistory = readRepoHistory } = {}) {
  const sinceMs = since === null ? null : sinceToMs(since);
  const snapshot = resolveSourceSnapshot(root);
  const repos = reposOf(snapshot);
  const selected = snapshot.listFiles();

  const repoFiles = repos.map(() => []);
  const looseFiles = new Set(); // not under any member repository: no history
  for (const path of selected) {
    const index = repos.findIndex((repo) => path.startsWith(repo.prefix));
    if (index === -1) looseFiles.add(path);
    else repoFiles[index].push(path.slice(repos[index].prefix.length));
  }

  const counted = new Map();
  const ids = { commits: 0, authors: new Map() };
  const histories = new Map();
  const repoRows = [];
  const totals = { changesRead: 0, outsideSelection: 0 };
  for (const [index, repo] of repos.entries()) {
    const rels = repoFiles[index];
    const oids = new Map(listTrackedEntries(repo.dir, repo.sha).map((entry) => [entry.path, entry.oid]));
    const lines = await countBlobLines(repo.dir, rels.map((rel) => ({ oid: oids.get(rel), path: rel })));
    rels.forEach((rel, at) => counted.set(repo.prefix + rel, lines[at]));

    const history = await readHistory({ dir: repo.dir, sha: repo.sha, selected: new Set(rels), sinceMs, ids });
    for (const [rel, file] of history.files) histories.set(repo.prefix + rel, file);
    totals.changesRead += history.changesRead;
    totals.outsideSelection += history.outsideSelection;
    repoRows.push({
      path: repo.path,
      head: repo.sha,
      shallow: history.shallow,
      boundaryCommits: history.boundaryCommits,
      earliestVisibleCommit: history.earliestVisibleCommit,
    });
  }
  for (const path of looseFiles) counted.set(path, countBufferLines(snapshot.readFile(path)));

  let attributed = 0;
  for (const file of histories.values()) attributed += file.changes;
  const conservation = { changesRead: totals.changesRead, attributed, outsideSelection: totals.outsideSelection };
  assertConservation(conservation);

  const entries = selected.map((path) => {
    const { lines, binary } = counted.get(path);
    return { path, hasHistory: !looseFiles.has(path), lines: binary ? null : lines };
  });
  const { files, directories } = buildRows(entries, histories);

  return {
    format: HOTSPOTS_FORMAT,
    sourceRevision: snapshot.revision,
    sourceKind: snapshot.kind,
    historyAvailable: repos.length > 0,
    repos: repoRows,
    window: { since, sinceUtc: sinceMs === null ? null : new Date(sinceMs).toISOString().replace('.000Z', 'Z') },
    counts: {
      filesWithHistory: entries.filter((entry) => entry.hasHistory).length,
      filesWithoutHistory: entries.filter((entry) => !entry.hasHistory).length,
      binaryFiles: entries.filter((entry) => entry.lines === null).length,
      filesWithLineageConflicts: files.filter((row) => row.lineageConflicts > 0).length,
    },
    conservation,
    residualAssumptions: [...RESIDUAL_ASSUMPTIONS],
    files,
    directories,
  };
}

/** Write `text` to `path` through a sibling temporary file, so a reader never sees a half-written product. */
function writeAtomic(path, text) {
  const tmpPath = `${path}.tmp-${process.pid}`;
  try {
    writeFileSync(tmpPath, text, 'utf-8');
    renameSync(tmpPath, path);
  } catch (error) {
    rmSync(tmpPath, { force: true });
    throw error;
  }
}

/** Compute the product and write `.excavator/hotspots.json`; nothing is written when it fails. */
export async function runHotspots(rootArg, options = {}) {
  const root = bindProjectRoot(rootArg);
  assertDataDir(root);
  const product = await buildHotspots(root, options);
  mkdirSync(assertDataDir(root), { recursive: true });
  const path = assertDataFile(root, HOTSPOTS_FILE);
  writeAtomic(path, `${serializeJsonProduct(HOTSPOTS_FILE, product)}\n`);
  return { path, product };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = 'Usage: node hotspots.mjs <projectRoot> [--since YYYY-MM-DD]\n';

/** `{ root, since }` for a recognised argv shape, null otherwise. */
function parseArgs(argv) {
  const [root, ...rest] = argv;
  if (!root || root.startsWith('--')) return null;
  if (rest.length === 0) return { root, since: null };
  if (rest.length === 2 && rest[0] === '--since') return { root, since: rest[1] };
  return null;
}

async function main(argv) {
  const parsed = parseArgs(argv);
  if (!parsed) {
    process.stderr.write(USAGE);
    process.exit(1);
  }
  if (parsed.since !== null) sinceToMs(parsed.since); // a malformed window fails before any work
  const { path, product } = await runHotspots(parsed.root, { since: parsed.since });

  const { counts, conservation } = product;
  process.stdout.write(`${JSON.stringify({ product: path, counts, conservation })}\n`);
  process.stderr.write(`hotspots: ${counts.filesWithHistory + counts.filesWithoutHistory} files (${counts.filesWithHistory} with history, `
    + `${counts.filesWithoutHistory} without, ${counts.binaryFiles} binary); ${conservation.changesRead} changes read = `
    + `${conservation.attributed} attributed + ${conservation.outsideSelection} outside the selection -> ${path}\n`);
}

function isCliEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isCliEntry()) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`hotspots.mjs failed: ${error.message}\n`);
    process.exit(1);
  }
}

export default {
  HOTSPOTS_FORMAT,
  HOTSPOTS_FILE,
  sinceToMs,
  assertConservation,
  buildHotspots,
  runHotspots,
};
