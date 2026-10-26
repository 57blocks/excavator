/**
 * `prd.mjs check-priorities <out> --project <root>` (openspec change
 * prd-report-finding-priority, design D4). For every written feature (status
 * `checked` or `verified`, recomputed from its files as `aggregate` does) it
 * checks `priorities/<id>.json` against the feature's findings and prints
 * `F1: ranked`, or one `F1: <problem>` line for each problem; then one
 * `batch N: F.. F..` line for each batch of the features still to rank, in
 * chapter order with at most 120 findings to a batch; then
 * `Rank: <n> features ranked, <m> unranked`. Exit 0 only when none is
 * unranked. It writes nothing, and a feature without a passing file is not a
 * failure of the run: aggregate records its findings as unranked.
 */

import { resolve } from 'node:path';

import { WRITTEN_STATUSES, recomputeFeature } from './aggregate.mjs';
import { INDEX_FILE, loadIndex, schemaProblems } from './index-check.mjs';
import { projectRootProblem } from './project-root.mjs';
import { rankBatches, readFeatureRanks } from './priorities.mjs';

const featureNumber = (id) => Number(id.slice(1));

/** Run check-priorities on `<out>`. Returns { status, lines }. */
export function checkPriorities(outDirArg, root) {
  const outDir = resolve(outDirArg);
  const read = loadIndex(outDir);
  if (!read.ok) return { status: 1, lines: [`index: ${INDEX_FILE} ${read.reason}`] };
  const schema = schemaProblems(read.value);
  if (schema.length > 0) return { status: 1, lines: schema };
  const index = read.value;
  const rootProblem = projectRootProblem(index, root);
  if (rootProblem !== null) return { status: 1, lines: [rootProblem] };

  const written = index.features
    .map((feature) => recomputeFeature(outDir, index, feature, root))
    .filter((state) => WRITTEN_STATUSES.includes(state.feature.status))
    .sort((a, b) => a.feature.chapter - b.feature.chapter || featureNumber(a.feature.id) - featureNumber(b.feature.id));

  const lines = [];
  const toRank = [];
  let ranked = 0;
  for (const state of written) {
    const { id } = state.feature;
    const findings = state.findings.findings;
    const { problems } = readFeatureRanks(outDir, id, findings);
    if (problems.length === 0) {
      ranked += 1;
      lines.push(`${id}: ranked`);
    } else {
      toRank.push({ id, findings: findings.length });
      for (const problem of problems) lines.push(`${id}: ${problem}`);
    }
  }
  rankBatches(toRank).forEach((batch, at) => lines.push(`batch ${at + 1}: ${batch.join(' ')}`));
  lines.push(`Rank: ${ranked} features ranked, ${toRank.length} unranked`);
  return { status: toRank.length === 0 ? 0 : 1, lines };
}
