/**
 * `prd.mjs aggregate <out>` (openspec change prd-feature-pipeline, design D5,
 * D7, D9). Recomputes every feature's status from the files that exist:
 *   no chapter and no findings      -> planned, or failed (lane) after the
 *                                      last attempt or a recorded lane failure
 *   the lane's checks refuse it, or
 *   check-lane recorded a failure    -> failed (check-lane), with the reasons
 *                                      (only check-lane clears its record)
 *   the lane passes, no reply yet    -> checked
 *   verification/<id>.txt parses and
 *   verification/<id>.md exists      -> verified, with its counts
 *   verification/<id>.txt without
 *   verification/<id>.md, or unparsed -> failed (verify)
 * then records the statuses in index.json, checks that the candidates, the
 * status buckets and the findings over the priority levels are conserved,
 * writes findings.json (each finding with its priority from the feature's
 * priorities file, or null, ordered by level) and the tables, and prints the
 * counts the skill's reply is filled from. A failed feature is a result, not
 * an error: only a broken index or a broken conservation exits 1.
 */

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  INDEX_FILE, MAX_ATTEMPTS, STATUSES, UNRANKED, VERIFICATION_KEYS,
  conservation, emptyCounts, loadIndex, schemaProblems,
} from './index-check.mjs';
import { writeJson } from './json-file.mjs';
import { chapterPath, findingsPath, laneResult } from './lane-check.mjs';
import { byChapter } from './chapter.mjs';
import { coverageTable, openItemsTable, rolesTable, terminologyTable, verificationTable } from './tables.mjs';
import { emptyPriorityCounts, priorityCounts, readFeatureRanks } from './priorities.mjs';
import { projectRootProblem } from './project-root.mjs';
import { outsideScopeLine } from './scope-reads.mjs';
import { parseVerificationReply } from './verification.mjs';

export const FINDINGS_FORMAT = 'excavator-prd-report-findings/1';
export const FINDINGS_FILE = 'findings.json';
export const PRD_FILE = 'PRD.md';
/** The output directory the skill uses when --out is not given, under the project. */
export const DEFAULT_OUT = join('.excavator', 'prd-report');
/** The tables aggregate writes, in the order `assemble` places them (change prd-report-prd-shape, design D4); `TABLE_KEYS` names each one in the page data. */
export const TABLE_FILES = Object.freeze(['tables/terminology.md', 'tables/roles.md', 'tables/open-items.md', 'tables/coverage.md', 'tables/verification.md']);
export const TABLE_KEYS = Object.freeze(['terminology', 'roles', 'openItems', 'coverage', 'verification']);
export const verificationPath = (id) => `verification/${id}.txt`;
export const reportPath = (id) => `verification/${id}.md`;
export const WRITTEN_STATUSES = Object.freeze(['checked', 'verified']);

/**
 * `counts` with the priority counts of its findings all unranked. Used where
 * the findings are not in findings.json (a feature that is not written), so
 * the four counts of every feature still add up to its product and technical
 * findings.
 */
function unrankedCounts(counts) {
  const { product, technical } = counts.findings;
  return { ...counts, findings: { ...counts.findings, priority: { ...emptyPriorityCounts(), unranked: product + technical } } };
}

/**
 * One feature's recomputed state: { feature, chapter, findings, ranks, laneFindings }.
 * `chapter` is the split of the chapter file (see `splitChapter`) when the
 * feature is written, else null. Pure apart from reading the lane files, the priorities file and the project:
 * `laneFindings` is the lane's findings with each passage's line filled in
 * (null when the lane did not pass), for `aggregate` to write back; `findings`
 * is the part that counts (null unless the feature is written); `ranks` is
 * the rank of each of those findings by id from the feature's priorities file
 * (null when the feature is not written or its file does not pass: its
 * findings are unranked). `page` recomputes the same state to check that
 * index.json is current.
 */
export function recomputeFeature(outDir, index, feature, root) {
  const attempts = feature.attempts ?? 0;
  const hasChapter = existsSync(join(outDir, chapterPath(feature.id)));
  const hasFindings = existsSync(join(outDir, findingsPath(feature.id)));
  const base = { ...feature, attempts, counts: unrankedCounts(emptyCounts()) };
  if (!hasChapter && !hasFindings) {
    const recorded = feature.failure?.step === 'lane' ? feature.failure : null;
    if (recorded || attempts >= MAX_ATTEMPTS) {
      const reasons = recorded?.reasons?.length
        ? recorded.reasons
        : [`lane-wrote-nothing: ${chapterPath(feature.id)} and ${findingsPath(feature.id)} are missing after ${attempts} attempts`];
      return { feature: { ...base, status: 'failed', failure: { step: 'lane', reasons } }, chapter: null, findings: null, ranks: null, laneFindings: null };
    }
    return { feature: { ...base, status: 'planned', failure: null }, chapter: null, findings: null, ranks: null, laneFindings: null };
  }

  const lane = laneResult(outDir, index, feature, root, { laneChecks: false });
  const counts = unrankedCounts({ ...lane.counts, verification: null });
  const laneFindings = lane.findings;
  const recorded = feature.failure?.step === 'check-lane' ? feature.failure.reasons : [];
  const laneReasons = lane.problems.length > 0 ? lane.problems : recorded;
  if (laneReasons.length > 0) {
    return { feature: { ...base, counts, status: 'failed', failure: { step: 'check-lane', reasons: laneReasons } }, chapter: null, findings: null, ranks: null, laneFindings };
  }
  // The lane passed: its findings count, ranked by the feature's priorities file when that passes, else unranked.
  const { ranks } = readFeatureRanks(outDir, feature.id, lane.findings.findings);
  const ranked = { ...counts, findings: { ...counts.findings, priority: priorityCounts(lane.findings.findings, ranks) } };
  const replyPath = join(outDir, verificationPath(feature.id));
  if (!existsSync(replyPath)) {
    return { feature: { ...base, counts: ranked, status: 'checked', failure: null }, chapter: writtenChapter(feature, lane), findings: lane.findings, ranks, laneFindings };
  }
  if (!existsSync(join(outDir, reportPath(feature.id)))) {
    const reasons = [`verification-report-missing: ${reportPath(feature.id)} is missing`];
    return { feature: { ...base, counts, status: 'failed', failure: { step: 'verify', reasons } }, chapter: null, findings: null, ranks: null, laneFindings };
  }
  const reply = parseVerificationReply(readFileSync(replyPath, 'utf-8'));
  if (!reply.ok) {
    const reasons = reply.reasons.map((reason) => `verification-reply-unparsed: ${verificationPath(feature.id)}: ${reason}`);
    return { feature: { ...base, counts, status: 'failed', failure: { step: 'verify', reasons } }, chapter: null, findings: null, ranks: null, laneFindings };
  }
  return {
    feature: { ...base, counts: { ...ranked, verification: reply.counts }, status: 'verified', failure: null },
    chapter: writtenChapter(feature, lane),
    findings: lane.findings,
    ranks,
    laneFindings,
  };
}

/** The split of a passed lane's chapter; a lane that passed always has one, so a missing split is a bug, not a state. */
function writtenChapter(feature, lane) {
  if (lane.chapter === null) throw new Error(`${feature.id}: the lane passed but its chapter does not split`);
  return lane.chapter;
}

const LEVEL_ORDER = Object.freeze({ P0: 0, P1: 1, P2: 2 });
/** The number of a finding id `F3-12`. */
const findingNumber = (id) => Number(id.slice(id.lastIndexOf('-') + 1));

/**
 * The entries of findings.json for recomputed `states`: each passing lane's
 * findings, tagged with their feature, verdict, priority and priority reason
 * (null when unranked), ordered by level (P0, P1, P2, unranked), then by the
 * feature's position in index.json (the order of `states`), then by the
 * number of the finding id.
 */
export function findingsOf(states) {
  return states
    .flatMap((state, position) => (state.findings === null ? [] : state.findings.findings.map((finding) => {
      const rank = state.ranks?.get(finding.id);
      return {
        position,
        entry: { ...finding, feature: state.feature.id, verdict: 'anchor-checked', priority: rank?.priority ?? null, priorityReason: rank?.reason ?? null },
      };
    })))
    .sort((a, b) => (LEVEL_ORDER[a.entry.priority] ?? 3) - (LEVEL_ORDER[b.entry.priority] ?? 3)
      || a.position - b.position
      || findingNumber(a.entry.id) - findingNumber(b.entry.id))
    .map(({ entry }) => entry);
}

const sum = (items, pick) => items.reduce((total, item) => total + pick(item), 0);
/** A feature's findings counted at `level`; an index.json from before priorities has no counts by level, so all its findings are unranked. */
function levelCount(findings, level) {
  if (findings.priority) return findings.priority[level];
  return level === UNRANKED ? findings.product + findings.technical : 0;
}

/**
 * The reply's fields from an index whose statuses and counts are up to date:
 * what aggregate prints and what `reply` prints from. It reads no lane file.
 */
export function summarize(outDirArg, index, root) {
  const outDir = resolve(outDirArg);
  const features = index.features;
  const written = features.filter((f) => WRITTEN_STATUSES.includes(f.status));
  const verified = features.filter((f) => f.status === 'verified' && f.counts?.verification);
  return {
    prdPath: join(outDir, PRD_FILE),
    features: { total: features.length, written: written.length, failed: features.filter((f) => f.status === 'failed').length },
    diagrams: sum(written, (f) => f.counts.diagrams),
    findings: {
      product: sum(written, (f) => f.counts.findings.product),
      technical: sum(written, (f) => f.counts.findings.technical),
      priority: Object.fromEntries(Object.keys(emptyPriorityCounts()).map((level) => [level, sum(written, (f) => levelCount(f.counts.findings, level))])),
    },
    verification: Object.fromEntries(VERIFICATION_KEYS.map((key) => [key, sum(verified, (f) => f.counts.verification[key])])),
    uncovered: index.candidates.uncovered,
    // The failed features a second run of the lane can still repair, in chapter order (change prd-report-prd-shape, design D6).
    retryable: features.filter((f) => f.status === 'failed' && (f.attempts ?? 0) < MAX_ATTEMPTS).sort(byChapter).map((f) => f.id),
    outIsDefault: realpathSync(outDir) === join(realpathSync(root), DEFAULT_OUT),
  };
}

const levelsTotal = (counts) => counts.P0 + counts.P1 + counts.P2 + counts.unranked;

/**
 * The conservation of the findings over the priority levels: the four counts
 * of every feature add up to its findings (those in `entries` when it is
 * written, else its product and technical counts), and the four totals add up
 * to all of `entries`. One problem line for each feature or total that does not.
 */
function priorityConservation(states, entries, totals) {
  const problems = [];
  for (const { feature, findings } of states) {
    const { counts, id } = feature;
    const expected = findings === null ? counts.findings.product + counts.findings.technical : entries.filter((entry) => entry.feature === id).length;
    const got = levelsTotal(counts.findings.priority);
    if (got !== expected) problems.push(`${id}: the priority counts add up to ${got}, not ${expected} findings`);
  }
  const got = levelsTotal(totals);
  if (got !== entries.length) problems.push(`index: the priority counts add up to ${got}, not ${entries.length} findings`);
  return problems;
}

/**
 * What aggregate writes, computed without writing anything (pure apart from
 * reading the lane files and the project): every feature's recomputed state,
 * the index.json it would record (the features with every recorded field, and
 * the conservation summary), the problems that stop it (candidates, status
 * buckets or priority counts not conserved), and, when there are none, the
 * reply's summary, the findings.json value and the text of each table by
 * path. `aggregate` writes this, and `page` compares the files on disk with
 * it, so what is written and what is checked cannot differ.
 * @returns {{ states: object[], updated: object, problems: string[], result: object | null, findingsFile: object | null, tables: Record<string, string> | null }}
 */
export function computeAggregate(outDirArg, index, root) {
  const outDir = resolve(outDirArg);
  const states = index.features.map((feature) => recomputeFeature(outDir, index, feature, root));
  const features = states.map((state) => state.feature);
  const candidateCheck = conservation({ ...index, features });
  const updated = { ...index, features, conservation: candidateCheck.summary };

  const problems = [...candidateCheck.problems];
  const buckets = Object.fromEntries(STATUSES.map((status) => [status, features.filter((f) => f.status === status).length]));
  const inBuckets = Object.values(buckets).reduce((a, b) => a + b, 0);
  if (inBuckets !== features.length) problems.push(`index: the status buckets hold ${inBuckets} features, not ${features.length}`);
  if (problems.length > 0) return { states, updated, problems, result: null, findingsFile: null, tables: null };

  const result = summarize(outDir, updated, root);
  const entries = findingsOf(states);
  const unconserved = priorityConservation(states, entries, result.findings.priority);
  if (unconserved.length > 0) return { states, updated, problems: unconserved, result: null, findingsFile: null, tables: null };
  const chapters = new Map(states.map((state) => [state.feature.id, state.chapter]));
  const written = features.filter((feature) => WRITTEN_STATUSES.includes(feature.status)).sort(byChapter);
  return {
    states,
    updated,
    problems,
    result,
    findingsFile: { format: FINDINGS_FORMAT, sourceRevision: index.sourceRevision, findings: entries },
    tables: {
      [TABLE_FILES[0]]: terminologyTable(index.glossary),
      [TABLE_FILES[1]]: rolesTable(written, chapters, index.actors),
      [TABLE_FILES[2]]: openItemsTable(written, chapters),
      [TABLE_FILES[3]]: coverageTable(updated, outsideScopeLine(index, root)),
      [TABLE_FILES[4]]: verificationTable(features, result.verification),
    },
  };
}

/** Run aggregate on `<out>`. Returns { status, lines } on failure, { status: 0, result } on success. */
export function aggregate(outDirArg, root) {
  const outDir = resolve(outDirArg);
  const read = loadIndex(outDir);
  if (!read.ok) return { status: 1, lines: [read.line] };
  const schema = schemaProblems(read.value);
  if (schema.length > 0) return { status: 1, lines: schema };
  const index = read.value;
  const rootProblem = projectRootProblem(index, root);
  if (rootProblem !== null) return { status: 1, lines: [rootProblem] };

  const computed = computeAggregate(outDir, index, root);
  for (const state of computed.states) {
    if (state.laneFindings !== null) writeJson(join(outDir, findingsPath(state.feature.id)), state.laneFindings);
  }
  writeJson(join(outDir, INDEX_FILE), computed.updated);
  if (computed.problems.length > 0) return { status: 1, lines: computed.problems };

  writeJson(join(outDir, FINDINGS_FILE), computed.findingsFile);
  mkdirSync(join(outDir, 'tables'), { recursive: true });
  for (const rel of TABLE_FILES) writeFileSync(join(outDir, rel), computed.tables[rel]);
  return { status: 0, result: computed.result };
}
