/**
 * The priorities of a feature's findings (openspec change
 * prd-report-finding-priority, design D4): `priorities/<id>.json`, written by
 * a ranking subagent, holds `{ "priorities": [ { id, priority, reason } ] }`
 * with one entry for each finding of the feature. This module checks one
 * file against the findings it ranks, counts the findings by level, and packs
 * the features still to rank into batches. The checks are pure apart from
 * the one file read; the model never counts or orders anything here.
 */

import { join } from 'node:path';

import { PRIORITY_LEVELS, UNRANKED } from './index-check.mjs';
import { isObject, isString, readJson } from './json-file.mjs';
import { adviceWord } from './lane-check.mjs';

export { PRIORITY_LEVELS, UNRANKED };
export const REASON_MAX = 300;
/** The most findings one ranking batch holds; a feature with more is a batch of its own. */
export const BATCH_MAX = 120;
const ENTRY_KEYS = Object.freeze(['id', 'priority', 'reason']);

export const prioritiesPath = (id) => `priorities/${id}.json`;

/** The level counts of nothing: `{ P0, P1, P2, unranked }` in that key order. */
export const emptyPriorityCounts = () => ({ P0: 0, P1: 0, P2: 0, [UNRANKED]: 0 });

/**
 * Check the priorities file of feature `featureId` against the ids of its
 * findings. `read` is the result of `readJson` on the file. Returns the
 * problems, each a sentence that starts with the finding id it is about (or
 * the file path), and the rank of every finding by id (`{ priority, reason }`)
 * when there are no problems, else null. A feature with no findings needs no
 * file: whatever the file holds or lacks, it is ranked.
 * @param {string} featureId
 * @param {readonly string[]} findingIds
 * @param {{ ok: boolean, value?: unknown, missing?: boolean, reason?: string }} read
 * @returns {{ problems: string[], ranks: Map<string, { priority: string, reason: string }> | null }}
 */
export function rankFeature(featureId, findingIds, read) {
  if (findingIds.length === 0) return { problems: [], ranks: new Map() };
  const file = prioritiesPath(featureId);
  if (!read.ok) return { problems: [`${file} ${read.reason}`], ranks: null };
  const value = read.value;
  if (!isObject(value) || !Array.isArray(value.priorities)) {
    return { problems: [`${file} is not { "priorities": [ ... ] }`], ranks: null };
  }
  const problems = [];
  for (const key of Object.keys(value)) {
    if (key !== 'priorities') problems.push(`${file} key "${key}" is not allowed; the file holds priorities`);
  }

  const known = new Set(findingIds);
  const ranks = new Map();
  value.priorities.forEach((entry, at) => {
    const shaped = isObject(entry) && ENTRY_KEYS.every((key) => key in entry) && isString(entry.id) && typeof entry.reason === 'string';
    if (!shaped) {
      problems.push(`priorities[${at}] is not { id, priority, reason }`);
      return;
    }
    const id = entry.id;
    for (const key of Object.keys(entry)) {
      if (!ENTRY_KEYS.includes(key)) problems.push(`${id} key "${key}" is not allowed; an entry holds ${ENTRY_KEYS.join(', ')}`);
    }
    if (!known.has(id)) {
      problems.push(`${id} is not a finding of ${featureId}`);
      return;
    }
    if (ranks.has(id)) {
      if (!problems.includes(`${id} appears twice`)) problems.push(`${id} appears twice`);
      return;
    }
    ranks.set(id, { priority: entry.priority, reason: entry.reason });
    if (!PRIORITY_LEVELS.includes(entry.priority)) problems.push(`${id} priority ${JSON.stringify(entry.priority)} is not P0, P1 or P2`);
    if (entry.reason.trim() === '') {
      problems.push(`${id} reason is empty`);
    } else {
      const length = [...entry.reason].length;
      if (length > REASON_MAX) problems.push(`${id} reason is ${length} characters, over ${REASON_MAX}`);
      const word = adviceWord(entry.reason);
      if (word !== null) problems.push(`${id} reason gives advice (${JSON.stringify(word)}); say which criterion the evidence meets and who is affected`);
    }
  });
  for (const id of findingIds) if (!ranks.has(id)) problems.push(`${id} has no priority`);
  return { problems, ranks: problems.length === 0 ? ranks : null };
}

/** `rankFeature` for the file `<outDir>/priorities/<featureId>.json`; `findings` are the feature's findings (each with an `id`). */
export function readFeatureRanks(outDir, featureId, findings) {
  return rankFeature(featureId, findings.map((finding) => finding.id), readJson(join(outDir, prioritiesPath(featureId))));
}

/** The findings counted by level; with no ranks (a feature whose file does not pass) every finding is unranked. */
export function priorityCounts(findings, ranks) {
  const counts = emptyPriorityCounts();
  for (const finding of findings) counts[ranks?.get(finding.id)?.priority ?? UNRANKED] += 1;
  return counts;
}

/**
 * Pack `items` ({ id, findings: <count> }, already in chapter order) into
 * batches of feature ids with at most BATCH_MAX findings each, in order. A
 * feature with more findings than that is a batch of its own.
 * @returns {string[][]}
 */
export function rankBatches(items) {
  const batches = [];
  let current = [];
  let size = 0;
  for (const item of items) {
    // A feature over the limit never fits after another, and nothing fits after it: it ends up alone.
    if (current.length > 0 && size + item.findings > BATCH_MAX) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(item.id);
    size += item.findings;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}
