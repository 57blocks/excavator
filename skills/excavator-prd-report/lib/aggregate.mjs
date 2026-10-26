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
 * then records the statuses in index.json, checks that the candidates and the
 * status buckets are conserved, writes findings.json and the tables, and
 * prints the counts the skill's reply is filled from. A failed feature is a
 * result, not an error: only a broken index or a broken conservation exits 1.
 */

import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  INDEX_FILE, MAX_ATTEMPTS, STATUSES, VERIFICATION_KEYS,
  conservation, emptyCounts, loadIndex, schemaProblems,
} from './index-check.mjs';
import { writeJson } from './json-file.mjs';
import { chapterPath, findingsPath, laneResult } from './lane-check.mjs';
import { coverageTable, rolesTable, verificationTable } from './tables.mjs';
import { projectRootProblem } from './project-root.mjs';
import { parseVerificationReply } from './verification.mjs';

export const FINDINGS_FORMAT = 'excavator-prd-report-findings/1';
export const FINDINGS_FILE = 'findings.json';
export const PRD_FILE = 'PRD.md';
/** The output directory the skill uses when --out is not given, under the project. */
export const DEFAULT_OUT = join('.excavator', 'prd');
export const TABLE_FILES = Object.freeze(['tables/roles-by-feature.md', 'tables/coverage.md', 'tables/verification.md']);
export const verificationPath = (id) => `verification/${id}.txt`;
export const reportPath = (id) => `verification/${id}.md`;
export const WRITTEN_STATUSES = Object.freeze(['checked', 'verified']);

/** One feature's recomputed state: { feature, roles, findings }. */
function recompute(outDir, index, feature, root) {
  const attempts = feature.attempts ?? 0;
  const hasChapter = existsSync(join(outDir, chapterPath(feature.id)));
  const hasFindings = existsSync(join(outDir, findingsPath(feature.id)));
  const base = { ...feature, attempts, counts: emptyCounts() };
  if (!hasChapter && !hasFindings) {
    const recorded = feature.failure?.step === 'lane' ? feature.failure : null;
    if (recorded || attempts >= MAX_ATTEMPTS) {
      const reasons = recorded?.reasons?.length
        ? recorded.reasons
        : [`lane-wrote-nothing: ${chapterPath(feature.id)} and ${findingsPath(feature.id)} are missing after ${attempts} attempts`];
      return { feature: { ...base, status: 'failed', failure: { step: 'lane', reasons } }, roles: [], findings: null };
    }
    return { feature: { ...base, status: 'planned', failure: null }, roles: [], findings: null };
  }

  const lane = laneResult(outDir, index, feature, root);
  const counts = { ...lane.counts, verification: null };
  if (lane.findings !== null) writeJson(join(outDir, findingsPath(feature.id)), lane.findings);
  const recorded = feature.failure?.step === 'check-lane' ? feature.failure.reasons : [];
  const laneReasons = lane.problems.length > 0 ? lane.problems : recorded;
  if (laneReasons.length > 0) {
    return { feature: { ...base, counts, status: 'failed', failure: { step: 'check-lane', reasons: laneReasons } }, roles: [], findings: null };
  }
  const replyPath = join(outDir, verificationPath(feature.id));
  if (!existsSync(replyPath)) {
    return { feature: { ...base, counts, status: 'checked', failure: null }, roles: lane.roles, findings: lane.findings };
  }
  if (!existsSync(join(outDir, reportPath(feature.id)))) {
    const reasons = [`verification-report-missing: ${reportPath(feature.id)} is missing`];
    return { feature: { ...base, counts, status: 'failed', failure: { step: 'verify', reasons } }, roles: [], findings: null };
  }
  const reply = parseVerificationReply(readFileSync(replyPath, 'utf-8'));
  if (!reply.ok) {
    const reasons = reply.reasons.map((reason) => `verification-reply-unparsed: ${verificationPath(feature.id)}: ${reason}`);
    return { feature: { ...base, counts, status: 'failed', failure: { step: 'verify', reasons } }, roles: [], findings: null };
  }
  return {
    feature: { ...base, counts: { ...counts, verification: reply.counts }, status: 'verified', failure: null },
    roles: lane.roles,
    findings: lane.findings,
  };
}

const sum = (items, pick) => items.reduce((total, item) => total + pick(item), 0);

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
    },
    verification: Object.fromEntries(VERIFICATION_KEYS.map((key) => [key, sum(verified, (f) => f.counts.verification[key])])),
    uncovered: index.candidates.uncovered,
    outIsDefault: realpathSync(outDir) === join(realpathSync(root), DEFAULT_OUT),
  };
}

/** Run aggregate on `<out>`. Returns { status, lines } on failure, { status: 0, result } on success. */
export function aggregate(outDirArg, root) {
  const outDir = resolve(outDirArg);
  const read = loadIndex(outDir);
  if (!read.ok) return { status: 1, lines: [`index: ${INDEX_FILE} ${read.reason}`] };
  const schema = schemaProblems(read.value);
  if (schema.length > 0) return { status: 1, lines: schema };
  const index = read.value;
  const rootProblem = projectRootProblem(index, root);
  if (rootProblem !== null) return { status: 1, lines: [rootProblem] };

  const states = index.features.map((feature) => recompute(outDir, index, feature, root));
  const features = states.map((state) => state.feature);
  const candidateCheck = conservation({ ...index, features });
  const updated = { ...index, features, conservation: candidateCheck.summary };
  writeJson(join(outDir, INDEX_FILE), updated);

  const problems = [...candidateCheck.problems];
  const buckets = Object.fromEntries(STATUSES.map((status) => [status, features.filter((f) => f.status === status).length]));
  const inBuckets = Object.values(buckets).reduce((a, b) => a + b, 0);
  if (inBuckets !== features.length) problems.push(`index: the status buckets hold ${inBuckets} features, not ${features.length}`);
  if (problems.length > 0) return { status: 1, lines: problems };

  const result = summarize(outDir, updated, root);
  const totals = result.verification;

  const findings = states.flatMap((state) => (state.findings === null ? [] : state.findings.findings.map((finding) => ({
    ...finding, feature: state.feature.id, verdict: 'anchor-checked',
  }))));
  writeJson(join(outDir, FINDINGS_FILE), { format: FINDINGS_FORMAT, sourceRevision: index.sourceRevision, findings });

  const rolesById = new Map(states.map((state) => [state.feature.id, state.roles]));
  mkdirSync(join(outDir, 'tables'), { recursive: true });
  writeFileSync(join(outDir, TABLE_FILES[0]), rolesTable(features, rolesById));
  writeFileSync(join(outDir, TABLE_FILES[1]), coverageTable(updated));
  writeFileSync(join(outDir, TABLE_FILES[2]), verificationTable(features, totals));

  return { status: 0, result };
}
