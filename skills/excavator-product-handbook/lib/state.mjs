/**
 * `<out>/state.json` (design D9, D14): which features are planned, dispatched,
 * checked, confirmed, verified or failed, how many times each lane was
 * dispatched, and why a feature failed. `checked` means the entry passed the
 * scripts' checks; `confirmed` means two verifiers also confirmed each of its
 * items; `verified` means a tracer that read the whole project then found no
 * counter-evidence (only then does the feature reach the handbook). A checked
 * feature waiting for its one rewrite carries `rewriting: true`; a confirmed
 * or verified one carries the digest of its entry file, and the items removed
 * so far (a record of a removal by the tracer also has `step: "trace"` and the
 * `at` positions that showed the counter-evidence). Only the scripts change it:
 * check-map creates it; mark, check-entry, verdicts and trace-verdicts update it.
 * Every write is atomic; the commands that change it hold the state lock
 * (lock.mjs).
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { UsageError } from './errors.mjs';
import { isObject, readJson, writeJson } from './json-file.mjs';

export const STATE_FILE = 'state.json';
export const STATE_FORMAT = 'excavator-product-handbook-state/1';
export const STATUSES = Object.freeze(['planned', 'dispatched', 'checked', 'confirmed', 'verified', 'failed']);
export const FAILURE_STEPS = Object.freeze(['check-entry', 'lane', 'rewrite', 'verify', 'trace']);
/** The step that removed an item, when a record names it. */
export const REMOVAL_STEPS = Object.freeze(['verify', 'trace']);
/** What a removed item records: a verifier's verdict, or `withParent` for an item that went with the item it belongs to. */
export const REMOVED_VERDICTS = Object.freeze(['unverified', 'contradicted', 'withParent']);
/** A lane gets at most two attempts. */
export const MAX_ATTEMPTS = 2;

const atValid = (list) => Array.isArray(list) && list.every((at) => isObject(at) && typeof at.file === 'string' && Number.isInteger(at.line));

const removedValid = (list) => Array.isArray(list) && list.every((item) => isObject(item)
  && typeof item.path === 'string' && typeof item.claim === 'string' && typeof item.reason === 'string' && REMOVED_VERDICTS.includes(item.verdict)
  && (item.step === undefined || REMOVAL_STEPS.includes(item.step)) && (item.at === undefined || atValid(item.at)));

const stateProblems = (state) => {
  if (!isObject(state) || state.format !== STATE_FORMAT || !isObject(state.features)) return `format must be ${STATE_FORMAT} with a features object`;
  for (const [id, entry] of Object.entries(state.features)) {
    if (!isObject(entry) || !STATUSES.includes(entry.status) || !Number.isInteger(entry.attempts) || entry.attempts < 0) {
      return `feature ${id} needs a status (${STATUSES.join(', ')}) and a non-negative integer attempts`;
    }
    if (entry.failure !== undefined && (!isObject(entry.failure) || !FAILURE_STEPS.includes(entry.failure.step) || !Array.isArray(entry.failure.reasons))) {
      return `feature ${id} has a failure that is not { step, reasons }`;
    }
    if (entry.removed !== undefined && !removedValid(entry.removed)) return `feature ${id} has a removed list that is not [{ path, claim, verdict, reason, step?, at? }]`;
    if (entry.entryDigest !== undefined && typeof entry.entryDigest !== 'string') return `feature ${id} has an entryDigest that is not a string`;
    if (entry.rewriting !== undefined && entry.rewriting !== true) return `feature ${id} has a rewriting that is not true`;
  }
  return null;
};

/** Read state.json: `{ ok: true, state }`, `{ ok: false, missing: true }` or `{ ok: false, problem }`. */
export function loadState(outDir) {
  const read = readJson(join(outDir, STATE_FILE));
  if (read.missing) return { ok: false, missing: true, problem: `${STATE_FILE} is missing; run check-map first` };
  if (!read.ok) return { ok: false, problem: `${STATE_FILE} ${read.reason}` };
  const problem = stateProblems(read.value);
  return problem === null ? { ok: true, state: read.value } : { ok: false, problem: `${STATE_FILE}: ${problem}` };
}

/** A state with every feature planned. */
export const plannedState = (featureIds) => ({
  format: STATE_FORMAT,
  features: Object.fromEntries(featureIds.map((id) => [id, { status: 'planned', attempts: 0 }])),
});

export const saveState = (outDir, state) => writeJson(join(outDir, STATE_FILE), state);

/**
 * After a passing check-map: create the state, keep an existing one for the
 * same features, or report that the features changed. Returns problem lines.
 */
export function settleState(outDir, featureIds) {
  if (!existsSync(join(outDir, STATE_FILE))) {
    saveState(outDir, plannedState(featureIds));
    return [];
  }
  const loaded = loadState(outDir);
  if (!loaded.ok) return [`${loaded.problem}; run again with --fresh`];
  const recorded = Object.keys(loaded.state.features).sort();
  const wanted = [...featureIds].sort();
  if (recorded.length !== wanted.length || recorded.some((id, i) => id !== wanted[i])) {
    return [`${STATE_FILE} lists the features ${recorded.join(', ') || '(none)'} but map.json has ${wanted.join(', ') || '(none)'}; run again with --fresh`];
  }
  return [];
}

/** The last line of a failed check-entry: the next step for the orchestrator (design D9). */
export const nextLine = (id, attempts) => (attempts < MAX_ATTEMPTS
  ? `Next: delete ${id}'s entry, mark it dispatched and re-dispatch it once with the lines above (attempt 2 of 2)`
  : `Next: ${id} stays failed (2 of 2 attempts)`);

/** The last line of a failed check-entry of a feature whose one rewrite it checks (design D14): there is no second rewrite. */
export const rewriteNextLine = (id) => `Next: ${id} stays failed (its one rewrite did not pass check-entry)`;

/** The SHA-256 of an entry file's bytes: a confirmed or verified feature is invalidated when they change. */
export const entryDigest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

/** The state entry of `id`, or a usage error naming the file. */
export function featureState(state, id) {
  const entry = state.features[id];
  if (entry === undefined) throw new UsageError(`feature ${id} is not in ${STATE_FILE}; run check-map first`);
  return entry;
}
