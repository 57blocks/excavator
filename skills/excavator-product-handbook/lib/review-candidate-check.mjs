/**
 * The conclusion rule of the comparison candidates (openspec change handbook-process-review, D4): every candidate
 * assigned to a batch is listed by an item of that batch or dismissed, and nothing else is. Used by validateBatch,
 * so `review render` and `review status` see the same reasons. Without a readable entries/review-compare.json
 * there are no candidates and no rule applies.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { isObject, readJson } from './json-file.mjs';
import { COMPARE_FILE } from './review-compare.mjs';

const ids = (value) => (Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : []);
const describe = (candidate) => `candidate ${candidate.id} (${candidate.source}, ${candidate.features.join(',') || '-'})`;

/** The candidates of `file`, as `{ id, source, features, batch }`; empty when the file is missing or does not parse. */
function readCandidates(outDir) {
  const read = readJson(join(outDir, COMPARE_FILE));
  if (!read.ok || !isObject(read.value) || !Array.isArray(read.value.candidates)) return [];
  return read.value.candidates
    .filter((entry) => isObject(entry) && typeof entry.id === 'string')
    .map((entry) => ({ id: entry.id, source: String(entry.source), features: ids(entry.features), batch: typeof entry.batch === 'string' ? entry.batch : null }));
}

/**
 * The reasons the items and dismissals of batch `batchId` leave a candidate without a conclusion or misplace one.
 * `unprunedPath` tells whether the batch is pruned: the completeness rule then no longer applies.
 */
export function candidateReasons(outDir, batchId, value, unprunedPath) {
  const all = readCandidates(outDir);
  if (all.length === 0) return [];
  const mine = all.filter((candidate) => candidate.batch === batchId);
  const byId = new Map(mine.map((candidate) => [candidate.id, candidate]));
  const reasons = [];
  const handled = new Set();
  const dismissedSeen = new Set();
  const listed = new Set();
  const dismissals = Array.isArray(value.dismissed) ? value.dismissed.filter((entry) => isObject(entry) && typeof entry.candidate === 'string') : [];
  const unknown = (id, where) => {
    if (!byId.has(id)) reasons.push(`${batchId}: ${where} names ${id}, which is not a candidate of this batch`);
    return byId.get(id);
  };
  value.items.forEach((item, at) => {
    if (!isObject(item)) return;
    const features = ids(item.features);
    for (const id of ids(item.candidates)) {
      const candidate = unknown(id, `item ${at}`);
      if (candidate === undefined) continue;
      listed.add(id);
      handled.add(id);
      if (candidate.features.length > 0 && !candidate.features.some((feature) => features.includes(feature))) {
        reasons.push(`${batchId} item ${at}: lists ${describe(candidate)} but none of its features is among the features of the item`);
      }
    }
  });
  for (const { candidate: id } of dismissals) {
    const candidate = unknown(id, 'dismissed');
    if (candidate === undefined) continue;
    if (dismissedSeen.has(id)) reasons.push(`${batchId}: ${describe(candidate)} is dismissed twice`);
    else if (listed.has(id)) reasons.push(`${batchId}: ${describe(candidate)} is both listed by an item and dismissed`);
    dismissedSeen.add(id);
    handled.add(id);
  }
  if (!existsSync(join(outDir, unprunedPath))) {
    for (const candidate of mine) {
      if (!handled.has(candidate.id)) reasons.push(`${batchId}: ${describe(candidate)} has no conclusion: list it in the candidates of an item or in dismissed`);
    }
  }
  return reasons;
}
