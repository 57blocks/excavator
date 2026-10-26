/**
 * The data of the report page (openspec change prd-report-page, design D3):
 * one object built from a run's out directory, with its keys in a fixed
 * order, holding no absolute path. Reads only. It computes what `aggregate`
 * would write now (the same function aggregate writes from) and refuses a run
 * whose stored index.json, findings.json or tables differ from it in any
 * way (a UsageError telling the user to run `prd.mjs aggregate`), so the page
 * never shows a mix of two moments of the run. The model writes
 * the verification reports and chapters, and they sometimes quote the
 * project's absolute path ("Project source: ..."); the page may hold no local
 * path, so every string of the object has the root replaced by the project's
 * directory name.
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { FINDINGS_FILE, FINDINGS_FORMAT, TABLE_FILES, TABLE_KEYS, WRITTEN_STATUSES, computeAggregate, reportPath } from './aggregate.mjs';
import { body as markdownBody, byChapter, splitChapter } from './chapter.mjs';
import { UsageError } from './errors.mjs';
import { INDEX_FILE, loadIndex, schemaProblems } from './index-check.mjs';
import { chapterPath } from './lane-check.mjs';
import { isObject, readJson } from './json-file.mjs';
import { projectRootProblem } from './project-root.mjs';

export const PAGE_FORMAT = 'excavator-prd-report-page/1';
const OVERVIEW_FILE = 'overview.md';
const RUN_AGGREGATE = 'run `prd.mjs aggregate <out> --project <root>` first';

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * `value` with every string (keys stay as they are) having each of `roots`
 * replaced by `name`. A root is replaced only where it is a whole path: not as
 * the end of a longer path, nor as the start of a longer name (`/work/shop-two`,
 * `/work/shop.bak`). The longest root goes first, duplicates and trailing
 * slashes do not matter, and `/` or an empty root is not a root. Order and
 * everything that is not a string are kept.
 * @param {unknown} value
 * @param {readonly string[]} roots
 * @param {string} name
 * @returns {unknown}
 */
export function withoutRootPaths(value, roots, name) {
  const wanted = [...new Set(roots.map((root) => root.replace(/\/+$/, '')).filter((root) => root !== ''))].sort((a, b) => b.length - a.length);
  if (wanted.length === 0) return value;
  const pattern = new RegExp(`(?<![\\w.-])(?:${wanted.map(escapeRegExp).join('|')})(?![\\w-]|\\.\\w)`, 'g');
  const walk = (item) => {
    if (typeof item === 'string') return item.replace(pattern, () => name);
    if (Array.isArray(item)) return item.map(walk);
    if (item !== null && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, walk(child)]));
    return item;
  };
  return walk(value);
}

function readMarkdown(outDir, rel, hint) {
  const path = join(outDir, rel);
  if (!existsSync(path)) throw new UsageError(`${rel} is missing; ${hint}`);
  return markdownBody(readFileSync(path, 'utf-8'));
}

/** `findings.json` as a whole, read as aggregate wrote it: a missing file or another format is a stale run. */
function readFindings(outDir) {
  const read = readJson(join(outDir, FINDINGS_FILE));
  if (read.missing) throw new UsageError(`${FINDINGS_FILE} is missing; ${RUN_AGGREGATE}`);
  if (!read.ok) throw new UsageError(`${FINDINGS_FILE} ${read.reason}; ${RUN_AGGREGATE}`);
  if (!isObject(read.value) || read.value.format !== FINDINGS_FORMAT || !Array.isArray(read.value.findings)) {
    const found = isObject(read.value) ? JSON.stringify(read.value.format ?? null) : 'no object';
    throw new UsageError(`${FINDINGS_FILE} has format ${found}, not ${FINDINGS_FORMAT}; ${RUN_AGGREGATE}`);
  }
  return read.value;
}

/** JSON with the keys of every object sorted: two values are the same when their canonical texts are, whatever the key order. */
const canonical = (value) => JSON.stringify(value, (_key, item) => (
  item !== null && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
    : item
));

/**
 * What differs between the outputs aggregate left in `outDir` and what it
 * would write now, as one line each. The whole outputs are compared, never
 * chosen fields: the index.json features with every recorded field, its
 * conservation summary, findings.json and each table's bytes. A line names
 * the file and, for the index, the feature; the more specific reasons
 * (another status, other failure reasons, other findings) come first.
 */
function staleOutputs(outDir, index, stored, computed) {
  const stale = [];
  index.features.forEach((feature, at) => {
    const now = computed.updated.features[at];
    if (canonical(feature) === canonical(now)) return;
    if (feature.status !== now.status) stale.push(`${feature.id} is ${feature.status ?? 'unrecorded'} in ${INDEX_FILE} but its files give ${now.status}`);
    else if (canonical(feature.failure ?? null) !== canonical(now.failure ?? null)) stale.push(`${feature.id}'s failure reasons in ${INDEX_FILE} differ from what its files give`);
    else stale.push(`${feature.id}'s recorded fields in ${INDEX_FILE} differ from what its files give`);
  });
  if (canonical(index.conservation ?? null) !== canonical(computed.updated.conservation)) stale.push(`the conservation in ${INDEX_FILE} differs from what its files give`);

  const expected = computed.findingsFile;
  const flagged = [];
  for (const { id } of index.features) {
    const own = (list) => canonical(list.filter((finding) => finding.feature === id));
    if (own(stored.findings) !== own(expected.findings)) flagged.push(`${FINDINGS_FILE} does not hold the current findings of ${id}`);
  }
  stale.push(...flagged);
  if (flagged.length === 0 && canonical(stored) !== canonical(expected)) {
    stale.push(`${FINDINGS_FILE} differs from what aggregate writes now (a finding of no feature, another order, or another revision)`);
  }

  for (const rel of TABLE_FILES) {
    const path = join(outDir, rel);
    if (!existsSync(path)) throw new UsageError(`${rel} is missing; ${RUN_AGGREGATE}`);
    if (readFileSync(path, 'utf-8') !== computed.tables[rel]) stale.push(`${rel} differs from what aggregate writes now`);
  }
  return stale;
}

/**
 * A written chapter, through the split `assemble` uses: its body without
 * front-matter and without its open items section, the actors, permission
 * roles and flows it declares, and its triggers (change prd-report-prd-shape,
 * design D10).
 */
function readChapter(outDir, id) {
  const split = splitChapter(readFileSync(join(outDir, chapterPath(id)), 'utf-8'));
  if (!split.ok) throw new UsageError(`${chapterPath(id)} ${split.reason}; ${RUN_AGGREGATE}`);
  const { actors, permissionRoles, flows, body, data } = split;
  return { body, actors, permissionRoles, flows, triggers: data.triggers ?? [] };
}

/**
 * Collect the page data of the run in `outDirArg` for the project at `root`
 * (the real path `projectRootOption` returns).
 * @returns {object} the page data; see the key order in the returned literal
 * @throws {UsageError} the run is missing a file or is not up to date
 */
export function collectPageData(outDirArg, root) {
  const outDir = resolve(outDirArg);
  const read = loadIndex(outDir);
  if (!read.ok) throw new UsageError(read.stale ? read.line : `${INDEX_FILE} ${read.reason}`);
  const problems = schemaProblems(read.value);
  if (problems.length > 0) throw new UsageError(problems.join('\n'));
  const index = read.value;
  const rootProblem = projectRootProblem(index, root);
  if (rootProblem !== null) throw new UsageError(rootProblem);

  const stored = readFindings(outDir);
  // What aggregate would write now, from the files as they are: the page compares every stored output with it.
  const computed = computeAggregate(outDir, index, root);
  if (computed.problems.length > 0) throw new UsageError(`${INDEX_FILE} does not conserve its candidates, statuses and priority counts: ${computed.problems.join('; ')}; ${RUN_AGGREGATE}`);
  const states = computed.states.map((state) => state.feature);
  const stale = staleOutputs(outDir, index, stored, computed);
  if (stale.length > 0) throw new UsageError(`the run is not up to date with its files: ${stale.join('; ')}; ${RUN_AGGREGATE}`);
  // From here every value is on disk or equal to what aggregate computes from the files: no two sources can disagree.
  const findings = stored.findings;

  const candidates = new Map(index.candidates.items.map((item) => [item.id, {
    id: item.id, kind: item.kind, file: item.file, line: item.line, text: item.text, framework: item.framework,
  }]));
  const features = states
    .map((feature) => {
      const written = WRITTEN_STATUSES.includes(feature.status);
      const chapter = written ? readChapter(outDir, feature.id) : null;
      const verified = feature.status === 'verified' && existsSync(join(outDir, reportPath(feature.id)));
      return {
        id: feature.id,
        name: feature.name,
        kind: feature.kind,
        chapter: feature.chapter,
        status: feature.status,
        failure: feature.failure,
        attempts: feature.attempts,
        counts: feature.counts,
        entrypoints: feature.entrypoints.map((id) => candidates.get(id)),
        actors: chapter?.actors ?? [],
        permissionRoles: chapter?.permissionRoles ?? [],
        flows: chapter?.flows ?? [],
        triggers: chapter?.triggers ?? [],
        body: chapter?.body ?? null,
        verificationReport: verified ? readMarkdown(outDir, reportPath(feature.id), RUN_AGGREGATE) : null,
      };
    })
    .sort(byChapter);

  // aggregate's printed fields, from the recomputed states; the machine's paths, the framework list (a key of its own) and the features to retry stay out.
  const { prdPath, outIsDefault, uncovered, retryable, ...counts } = computed.result;
  const object = {
    format: PAGE_FORMAT,
    project: basename(root),
    sourceRevision: index.sourceRevision,
    language: index.language,
    role: index.role,
    scope: index.scope,
    counts,
    overview: readMarkdown(outDir, OVERVIEW_FILE, 'write the overview before the page'),
    features,
    findings,
    tables: Object.fromEntries(TABLE_FILES.map((rel, at) => [TABLE_KEYS[at], readMarkdown(outDir, rel, RUN_AGGREGATE)])),
    unassigned: index.unassigned.map((id) => candidates.get(id)),
    uncovered: [...uncovered],
  };
  const realOf = (path) => {
    try {
      return realpathSync(path);
    } catch {
      return path;
    }
  };
  return withoutRootPaths(object, [index.projectRoot, root, realOf(index.projectRoot), realOf(root)], basename(root));
}
