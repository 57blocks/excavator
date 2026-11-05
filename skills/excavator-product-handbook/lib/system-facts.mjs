/**
 * The facts of the system overview that a script computes (openspec change
 * handbook-system-overview): for each application root of the project (and
 * each application the verified overview lists below one), its languages (files by extension, most first), the frameworks the candidate
 * list found under it, its source files and their lines, and, when its
 * directory is in a git work tree, the first and last commit date, the number
 * of commits without merges and the number of distinct author emails of the
 * history under that directory; for the system, the counts of application roots,
 * source files, lines, areas, features, features with a verified entry and
 * roles; for each area, its features, its features with a verified entry and
 * the roles those entries name. Nothing here comes from a model: the inputs
 * are the project files, candidates.json, the map and the verified entries.
 * The same inputs give the same object, with no run time and no local path.
 *
 * A source file is a file in a source language (source-languages.mjs) that
 * the candidate lister's walk reaches (same skipped directories, no link
 * followed) and does not skip for being a test file, over its size cap or
 * binary; `files` and `lines` count exactly those files, and the languages
 * are theirs. Files of other kinds (data, configuration, documents) are not
 * counted. The files under a nested application are also under its parent.
 * The system totals count each file once, under the application roots.
 * `history` is null when the directory is in no git work tree or git reports
 * no commit under it; the handbook then says there is no version history.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { isUnder, scanProject } from './applications.mjs';
import { OVERVIEW_ID, unitState } from './unit.mjs';

const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const GIT_BUFFER_BYTES = 256 * 1024 * 1024;

/** The lines of a text the way a reader of the file counts them: a final newline does not start a line. */
const countLines = (text) => (text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0));

/** `{ rel, language, lines }` for each source file that holds text; a file with a NUL byte or that cannot be read is skipped. */
function readSourceFiles(scan) {
  const counted = [];
  for (const file of scan.sourceFiles) {
    let bytes;
    try {
      bytes = readFileSync(file.abs);
    } catch {
      continue;
    }
    if (bytes.includes(0)) continue;
    counted.push({ rel: file.rel, language: file.language, lines: countLines(bytes.toString('utf-8')) });
  }
  return counted;
}

/** The history of `dir` under the project root: `{ first, last, commits, authors }`, or null when there is none to report. */
function historyOf(scan, dir) {
  let output;
  try {
    output = execFileSync('git', ['-C', dir === '.' ? scan.root : join(scan.root, dir), 'log', '--no-merges', '--format=%ad%x09%ae', '--date=short', '--', '.'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: GIT_BUFFER_BYTES,
    });
  } catch {
    return null;
  }
  const rows = output.split('\n').filter((line) => line !== '').map((line) => line.split('\t'));
  if (rows.length === 0) return null;
  const dates = rows.map(([date]) => date).sort(compare);
  return { first: dates[0], last: dates.at(-1), commits: rows.length, authors: new Set(rows.map(([, email]) => (email ?? '').trim().toLowerCase())).size };
}

/**
 * The row of one application directory: the script facts, with the name and
 * what it is responsible for from the verified overview, or null for each
 * when no verified application stands for the directory.
 */
function applicationRow(dir, application, { scan, counted, candidates }) {
  const files = counted.filter((file) => isUnder(file.rel, dir));
  const languages = new Map();
  for (const file of files) languages.set(file.language, (languages.get(file.language) ?? 0) + 1);
  const frameworks = new Map();
  for (const item of candidates.filter((candidate) => isUnder(candidate.file, dir))) frameworks.set(item.framework, (frameworks.get(item.framework) ?? 0) + 1);
  const byCount = ([nameA, a], [nameB, b]) => b - a || compare(nameA, nameB);
  return {
    dir,
    name: application?.name ?? null,
    does: application?.does ?? null,
    languages: [...languages].sort(byCount).map(([language, count]) => ({ language, files: count })),
    frameworks: [...frameworks].sort(byCount).map(([framework, count]) => ({ framework, candidates: count })),
    files: files.length,
    lines: files.reduce((sum, file) => sum + file.lines, 0),
    history: historyOf(scan, dir),
  };
}

/**
 * The rows of the applications table: one per application root of the scan,
 * in directory order, each followed by the rows of the verified applications
 * that sit below it (in the overview's order). A verified application whose
 * directory is a root fills that root's row; a root with none keeps its row
 * with no name and no responsibility.
 */
function applicationRows(listed, context) {
  const rows = [];
  const placed = new Set();
  for (const root of context.scan.roots) {
    const own = listed.find((application) => application.dir === root);
    rows.push(applicationRow(root, own, context));
    if (own !== undefined) placed.add(own);
    for (const application of listed) {
      if (placed.has(application) || !isUnder(application.dir, root)) continue;
      placed.add(application);
      rows.push(applicationRow(application.dir, application, context));
    }
  }
  // A listed directory under no root (the project changed since the check) still gets its row.
  for (const application of listed) if (!placed.has(application)) rows.push(applicationRow(application.dir, application, context));
  return rows;
}

/** One row per area of the map: its features, its features with a verified entry, and the roles those entries name, in the order of the map's roles. */
function areaRows(map, entries) {
  return map.areas.map((area) => {
    const features = map.features.filter((feature) => feature.area === area.id);
    const written = features.filter((feature) => entries.has(feature.id));
    const named = new Set(written.flatMap((feature) => entries.get(feature.id).who.map((who) => who.role)));
    return { id: area.id, name: area.name, features: features.length, verified: written.length, roles: map.roles.map((role) => role.label).filter((label) => named.has(label)) };
  });
}

/**
 * The system facts of a loaded run (`loadCheckedRun`'s result) over the
 * project at `root`: `{ status, overview, applications, counts, areas }`.
 * `status` is the overview's state; `overview` holds its text, only when it is
 * verified (null otherwise). The rest does not depend on it and is always
 * there: `applications` has one row per application root of the project with
 * the script facts (name and responsibility only from a verified overview,
 * else null), and `counts` is the system's size from the roots. `scan` is the
 * project scan (applications.mjs), given when the caller has made it already.
 */
export function buildSystem(run, root, scan = scanProject(root)) {
  const { map, state, entries, candidates } = run;
  const status = unitState(state, OVERVIEW_ID).status;
  const doc = entries.get(OVERVIEW_ID);
  const counted = readSourceFiles(scan);
  const applications = applicationRows(doc === undefined ? [] : doc.applications, { scan, counted, candidates });
  const inRoots = counted.filter((file) => scan.roots.some((dir) => isUnder(file.rel, dir)));
  return {
    status,
    overview: doc === undefined ? null : {
      summary: doc.summary.map((entry) => entry.text),
      audiences: doc.audiences.map(({ who, does }) => ({ who, does })),
      integrations: doc.integrations.map(({ system, use, callers }) => ({ system, use, callers: [...callers] })),
      unknowns: doc.unknowns.map(({ item, searched }) => ({ item, searched })),
    },
    applications,
    counts: {
      applications: scan.roots.length,
      files: inRoots.length,
      lines: inRoots.reduce((sum, file) => sum + file.lines, 0),
      areas: map.areas.length,
      features: map.features.length,
      featuresWithEntry: map.features.filter((feature) => entries.has(feature.id)).length,
      roles: map.roles.length,
    },
    areas: areaRows(map, entries),
  };
}
