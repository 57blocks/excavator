/**
 * The state of the topics lanes and what a run holds of them (openspec change
 * handbook-topics, design D4). The key `state.topics` maps a lane id to an entry
 * of the usual form (status `planned`, `dispatched`, `checked`, `verified` or
 * `failed`, attempts), with the digest of the facts the lane was written for
 * (`factsDigest`), the digest of its part file (`entryDigest`) and, once
 * verified, the rows the judges did not both accept (`dropped`). An absent key
 * or lane means planned with no attempt, so an output directory from before
 * needs no migration. `load-run.mjs` reads the lanes through `loadTopics`: only a
 * verified lane whose part file is still the one the judges saw has rows;
 * whether its facts are the current ones is for the model that builds the
 * outputs to decide (topics-model.mjs), since only it has the facts.
 */

import { existsSync } from 'node:fs';

import { readJson } from './json-file.mjs';
import { partFilePath, topicsShapeProblems } from './topics-shape.mjs';
import { entryDigest } from './state.mjs';

const PLANNED = Object.freeze({ status: 'planned', attempts: 0 });

/** The entry of a lane in `state`: planned with no attempt when there is none. */
export const laneEntry = (state, lane) => state.topics?.[lane] ?? { ...PLANNED };

/**
 * The part file of a lane when its entry says it is `checked` or `verified` and the file is the one that was checked
 * (shape and digest): `{ doc }`, or `{ doc: null }`.
 */
export function readLaneFile(outDir, lane, entry) {
  const none = { doc: null };
  if (!['checked', 'verified'].includes(entry.status)) return none;
  const path = partFilePath(outDir, lane);
  if (!existsSync(path)) return none;
  const read = readJson(path);
  if (!read.ok || topicsShapeProblems(read.value).length > 0 || read.value.lane !== lane) return none;
  if (entryDigest(path) !== entry.entryDigest) return none;
  return { doc: read.value };
}

/**
 * The lanes of a loaded state: `{ lanes: Map<lane, { status, doc, dropped, factsDigest }> }` for each lane the state records.
 * `doc` is the parsed part file for a verified lane whose file is the one the judges saw, else null; `dropped` is what the
 * judges did not both accept, `[{ id, reasons }]`, empty without a `doc`.
 */
export function loadTopics(outDir, state) {
  const lanes = new Map();
  for (const lane of Object.keys(state.topics ?? {})) {
    const entry = laneEntry(state, lane);
    const none = { status: entry.status, doc: null, dropped: [], factsDigest: entry.factsDigest ?? null };
    if (entry.status !== 'verified') {
      lanes.set(lane, none);
      continue;
    }
    const { doc } = readLaneFile(outDir, lane, entry);
    lanes.set(lane, doc === null ? none : { ...none, doc, dropped: entry.dropped ?? [] });
  }
  return { lanes };
}
