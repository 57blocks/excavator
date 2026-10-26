/**
 * The data of the report page (openspec change prd-report-page, design D3):
 * one object built from a run's out directory, with its keys in a fixed
 * order, holding no absolute path. Reads only. It recomputes every feature's
 * state with aggregate's own rules and refuses a run whose index.json, findings.json or feature
 * files disagree (a UsageError telling the user to run `prd.mjs aggregate`),
 * so the page never shows a mix of two moments of the run.
 */

import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { FINDINGS_FILE, FINDINGS_FORMAT, TABLE_FILES, WRITTEN_STATUSES, findingsOf, recomputeFeature, reportPath, summarize } from './aggregate.mjs';
import { body as markdownBody } from './assemble.mjs';
import { UsageError } from './errors.mjs';
import { parseFrontMatter } from './front-matter.mjs';
import { INDEX_FILE, conservation, loadIndex, schemaProblems } from './index-check.mjs';
import { chapterPath } from './lane-check.mjs';
import { isObject, readJson } from './json-file.mjs';
import { projectRootProblem } from './project-root.mjs';

export const PAGE_FORMAT = 'excavator-prd-report-page/1';
const OVERVIEW_FILE = 'overview.md';
const RUN_AGGREGATE = 'run `prd.mjs aggregate <out> --project <root>` first';
/** The page's name for each of the three tables aggregate writes, in TABLE_FILES order. */
const TABLE_KEYS = Object.freeze(['rolesByFeature', 'coverage', 'verification']);

const featureNumber = (id) => Number(id.slice(1));

function readMarkdown(outDir, rel, hint) {
  const path = join(outDir, rel);
  if (!existsSync(path)) throw new UsageError(`${rel} is missing; ${hint}`);
  return markdownBody(readFileSync(path, 'utf-8'));
}

/** `findings.json` read as aggregate wrote it: a missing file or another format is a stale run. */
function readFindings(outDir) {
  const read = readJson(join(outDir, FINDINGS_FILE));
  if (read.missing) throw new UsageError(`${FINDINGS_FILE} is missing; ${RUN_AGGREGATE}`);
  if (!read.ok) throw new UsageError(`${FINDINGS_FILE} ${read.reason}; ${RUN_AGGREGATE}`);
  if (!isObject(read.value) || read.value.format !== FINDINGS_FORMAT || !Array.isArray(read.value.findings)) {
    const found = isObject(read.value) ? JSON.stringify(read.value.format ?? null) : 'no object';
    throw new UsageError(`${FINDINGS_FILE} has format ${found}, not ${FINDINGS_FORMAT}; ${RUN_AGGREGATE}`);
  }
  return read.value.findings;
}

/** A written chapter: its body without front-matter, and the front-matter's roles and triggers. */
function readChapter(outDir, id) {
  const text = readFileSync(join(outDir, chapterPath(id)), 'utf-8');
  const front = parseFrontMatter(text);
  if (!front.ok) throw new UsageError(`${chapterPath(id)} ${front.reason}; ${RUN_AGGREGATE}`);
  return { body: markdownBody(text), roles: front.data.roles ?? [], triggers: front.data.triggers ?? [] };
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
  if (!read.ok) throw new UsageError(`${INDEX_FILE} ${read.reason}`);
  const problems = schemaProblems(read.value);
  if (problems.length > 0) throw new UsageError(problems.join('\n'));
  const index = read.value;
  const rootProblem = projectRootProblem(index, root);
  if (rootProblem !== null) throw new UsageError(rootProblem);

  const findings = readFindings(outDir);
  const recomputed = index.features.map((feature) => recomputeFeature(outDir, index, feature, root));
  const states = recomputed.map((state) => state.feature);
  const stale = index.features.flatMap((feature, at) => (
    feature.status === states[at].status ? [] : [`${feature.id} is ${feature.status ?? 'unrecorded'} in ${INDEX_FILE} but its files give ${states[at].status}`]
  ));
  // findings.json must hold what aggregate would write now, feature by feature: same findings, same order.
  const expected = findingsOf(recomputed);
  for (const { id } of index.features) {
    const own = (list) => JSON.stringify(list.filter((finding) => finding.feature === id));
    if (own(findings) !== own(expected)) stale.push(`${FINDINGS_FILE} does not hold the current findings of ${id}`);
  }
  if (stale.length === 0 && JSON.stringify(findings) !== JSON.stringify(expected)) {
    stale.push(`${FINDINGS_FILE} holds findings of no feature of ${INDEX_FILE}, or in another order than aggregate writes them`);
  }
  if (stale.length > 0) throw new UsageError(`the run is not up to date with its files: ${stale.join('; ')}; ${RUN_AGGREGATE}`);

  const held = conservation({ ...index, features: states });
  if (held.problems.length > 0) throw new UsageError(`${INDEX_FILE} does not conserve its candidates: ${held.problems.join('; ')}; ${RUN_AGGREGATE}`);

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
        roles: chapter?.roles ?? [],
        triggers: chapter?.triggers ?? [],
        body: chapter?.body ?? null,
        verificationReport: verified ? readMarkdown(outDir, reportPath(feature.id), RUN_AGGREGATE) : null,
      };
    })
    .sort((a, b) => a.chapter - b.chapter || featureNumber(a.id) - featureNumber(b.id));

  // aggregate's printed fields, from the recomputed states; the machine's paths and the framework list (a key of its own) stay out.
  const { prdPath, outIsDefault, uncovered, ...counts } = summarize(outDir, { ...index, features: states }, root);
  return {
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
}
