/**
 * `<out>/state.json` (design D9, D14): which features are planned, dispatched,
 * checked, confirmed, verified or failed, how many times each lane was
 * dispatched, and why a feature failed. `checked` means the entry passed the
 * scripts' checks; `confirmed` means two verifiers also confirmed each of its
 * items; `verified` means two tracers that read the whole project then found no
 * counter-evidence (only then does the feature reach the handbook). A checked
 * feature waiting for its one rewrite carries `rewriting: true` and the items
 * round 1 removed; a confirmed or verified one carries the digest of its entry
 * file, and the items removed
 * so far (a record of a removal by the tracers also has `step: "trace"`, the
 * `reasons` of every tracer that contradicted the item and the `at` positions
 * that showed the counter-evidence). A unit whose rewrite changed the claim of
 * an item also carries `narrowed`, `[{ path, from, to, kept }]`, for the audit
 * (openspec change handbook-recall); the handbook does not show it. A checked /3 entry
 * (openspec change handbook-free-chapter) also carries `chapter: { items, notes }`, the items of its chapter with each
 * citation as `{ file, lines, passage }` and the content findings `{ id, kind, detail }` the chapter check reported. Only the scripts change it:
 * check-map creates it; mark, check-entry, verdicts and trace-verdicts update it.
 * Every write is atomic; the commands that change it hold the state lock
 * (lock.mjs). The system overview (openspec change handbook-system-overview)
 * has the same entry under the optional key `overview`, and the findings of
 * each feature (openspec change handbook-feature-findings) under the optional
 * key `findings`, by feature id; a state without a key, or without a feature in
 * it, reads as planned with no attempt (unit.mjs). The system findings of each
 * application root (openspec change handbook-system-findings) are under the
 * optional key `systemFindings`, by `app<n>`, each entry with the `root` (the
 * application directory) it was recorded for. The ranking of the findings
 * (openspec change handbook-findings-priority) is under the optional key
 * `priority`, an entry of the same form with the digest of the groups it was made
 * for (`groupsDigest`) and the groups the judges did not confirm (`unranked`).
 * The remedies of the findings (openspec change handbook-remedies) are under the
 * optional key `remedies`, again an entry of the same form, with the digest of
 * the facts it was written for (`factsDigest`) and the paragraphs the judges did
 * not both accept (`dropped`).
 * The domain flow diagrams (openspec change handbook-free-chapter) are under the optional key `domainFlows`, `{ status, attempts, reasons }`
 * (check-domain-flows); a state without it means no attempt was made.
 * The architecture section (openspec change handbook-architecture-chapter) is under the optional key `architecture`, `{ status, attempts, notes }`
 * (check-architecture); a state without it means no attempt was made.
 * The topics of the handbook (openspec change handbook-topics) are under the optional key
 * `topics`, by lane id (a domain's, or `repeated`), each an entry of the same form with the
 * digest of the facts of the lane (`factsDigest`) and the rows the judges did not both accept
 * (`dropped`).
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { isObject, readJson, writeJson } from './json-file.mjs';

export const STATE_FILE = 'state.json';
export const STATE_FORMAT = 'excavator-product-handbook-state/1';
export const STATUSES = Object.freeze(['planned', 'dispatched', 'checked', 'confirmed', 'verified', 'failed']);
export const FAILURE_STEPS = Object.freeze(['check-entry', 'lane', 'rewrite', 'verify', 'trace']);
/** The step that removed an item, when a record names it. */
export const REMOVAL_STEPS = Object.freeze(['verify', 'trace']);
/** What a removed item records: a verifier's verdict, or `withParent` for an item that went with the item it belongs to. */
export const REMOVED_VERDICTS = Object.freeze(['unverified', 'contradicted', 'withParent']);
/** The statuses of the domain flow diagrams (openspec change handbook-free-chapter): `checked`, or `failed` with the reasons of the last attempt. A state without the key means no attempt. */
export const DOMAIN_FLOWS_STATUSES = Object.freeze(['checked', 'failed']);
/** The domain flows file gets at most three attempts. */
export const MAX_FLOW_ATTEMPTS = 3;
/** The statuses of the architecture section (openspec change handbook-architecture-chapter): `checked`, or `failed` with the reasons of the last attempt. */
export const ARCHITECTURE_STATUSES = Object.freeze(['checked', 'failed']);
/** The architecture files get at most three attempts. */
export const MAX_ARCHITECTURE_ATTEMPTS = 3;
/** A lane gets at most two attempts. */
export const MAX_ATTEMPTS = 2;

const atValid = (list) => Array.isArray(list) && list.every((at) => isObject(at) && typeof at.file === 'string' && Number.isInteger(at.line));

const removedValid = (list) => Array.isArray(list) && list.every((item) => isObject(item)
  && typeof item.path === 'string' && typeof item.claim === 'string' && typeof item.reason === 'string' && REMOVED_VERDICTS.includes(item.verdict)
  && (item.step === undefined || REMOVAL_STEPS.includes(item.step)) && (item.at === undefined || atValid(item.at))
  && (item.reasons === undefined || (Array.isArray(item.reasons) && item.reasons.every((reason) => typeof reason === 'string'))));

/** The claims a round-2 rewrite changed (openspec change handbook-recall): each with its old and new claim and whether the item stayed. */
const narrowedValid = (list) => Array.isArray(list) && list.every((item) => isObject(item)
  && typeof item.path === 'string' && typeof item.from === 'string' && typeof item.to === 'string' && typeof item.kept === 'boolean');

/** The chapter items a /3 entry's checked state keeps (openspec change handbook-free-chapter): each with its citations resolved to lines and their text. */
const chapterValid = (chapter) => isObject(chapter) && Array.isArray(chapter.items)
  && (chapter.notes === undefined || (Array.isArray(chapter.notes) && chapter.notes.every((note) => isObject(note) && ['id', 'kind', 'detail'].every((key) => typeof note[key] === 'string'))))
  && chapter.items.every((item) => isObject(item)
  && typeof item.id === 'string' && typeof item.kind === 'string' && typeof item.text === 'string' && typeof item.claim === 'string'
  && (item.own === undefined || typeof item.own === 'string')
  && Array.isArray(item.cites) && item.cites.every((cite) => isObject(cite) && typeof cite.file === 'string' && typeof cite.passage === 'string'
    && Array.isArray(cite.lines) && cite.lines.length === 2 && cite.lines.every(Number.isInteger)));

/** The problem of one state entry (of a feature, or the overview) named `label`, or null. */
function entryProblem(label, entry) {
  if (!isObject(entry) || !STATUSES.includes(entry.status) || !Number.isInteger(entry.attempts) || entry.attempts < 0) {
    return `${label} needs a status (${STATUSES.join(', ')}) and a non-negative integer attempts`;
  }
  if (entry.failure !== undefined && (!isObject(entry.failure) || !FAILURE_STEPS.includes(entry.failure.step) || !Array.isArray(entry.failure.reasons))) {
    return `${label} has a failure that is not { step, reasons }`;
  }
  if (entry.removed !== undefined && !removedValid(entry.removed)) return `${label} has a removed list that is not [{ path, claim, verdict, reason, step?, reasons?, at? }]`;
  if (entry.narrowed !== undefined && !narrowedValid(entry.narrowed)) return `${label} has a narrowed list that is not [{ path, from, to, kept }]`;
  if (entry.entryDigest !== undefined && typeof entry.entryDigest !== 'string') return `${label} has an entryDigest that is not a string`;
  if (entry.rewriting !== undefined && entry.rewriting !== true) return `${label} has a rewriting that is not true`;
  if (entry.chapter !== undefined && !chapterValid(entry.chapter)) return `${label} has a chapter that is not { items: [{ id, kind, text, claim, cites: [{ file, lines, passage }] }] }`;
  return null;
}

/** The problem of the entry of the priority unit (openspec change handbook-findings-priority), or null: an entry of any other unit, plus the digest of its groups and the groups no two judges confirmed. */
function priorityEntryProblem(entry) {
  const problem = entryProblem('priority', entry);
  if (problem !== null) return problem;
  if (entry.groupsDigest !== undefined && typeof entry.groupsDigest !== 'string') return 'priority has a groupsDigest that is not a string';
  if (entry.unranked !== undefined && !(Array.isArray(entry.unranked) && entry.unranked.every((one) => isObject(one) && typeof one.key === 'string' && Array.isArray(one.reasons) && one.reasons.every((reason) => typeof reason === 'string')))) {
    return 'priority has an unranked list that is not [{ key, reasons }]';
  }
  return null;
}

/** The problem of the entry of the remedies unit (openspec change handbook-remedies), or null: an entry of any other unit, plus the digest of its facts and the paragraphs no two judges accepted. */
function remediesEntryProblem(entry) {
  const problem = entryProblem('remedies', entry);
  if (problem !== null) return problem;
  if (entry.factsDigest !== undefined && typeof entry.factsDigest !== 'string') return 'remedies has a factsDigest that is not a string';
  if (entry.dropped !== undefined && !(Array.isArray(entry.dropped) && entry.dropped.every((one) => isObject(one) && typeof one.id === 'string' && Array.isArray(one.reasons) && one.reasons.every((reason) => typeof reason === 'string')))) {
    return 'remedies has a dropped list that is not [{ id, reasons }]';
  }
  return null;
}

/** The problem of the entry of a topics lane (openspec change handbook-topics), or null: an entry of any other unit, plus the digest of its facts and the rows no two judges accepted. */
function topicsEntryProblem(lane, entry) {
  const problem = entryProblem(`topics ${lane}`, entry);
  if (problem !== null) return problem;
  if (entry.factsDigest !== undefined && typeof entry.factsDigest !== 'string') return `topics ${lane} has a factsDigest that is not a string`;
  if (entry.dropped !== undefined && !(Array.isArray(entry.dropped) && entry.dropped.every((one) => isObject(one) && typeof one.id === 'string' && Array.isArray(one.reasons) && one.reasons.every((reason) => typeof reason === 'string')))) {
    return `topics ${lane} has a dropped list that is not [{ id, reasons }]`;
  }
  return null;
}

const stateProblems = (state) => {
  if (!isObject(state) || state.format !== STATE_FORMAT || !isObject(state.features)) return `format must be ${STATE_FORMAT} with a features object`;
  for (const [id, entry] of Object.entries(state.features)) {
    const problem = entryProblem(`feature ${id}`, entry);
    if (problem !== null) return problem;
  }
  // The entries of the overview and of the findings are optional: a state without them reads as planned (unit.mjs).
  if (state.findings !== undefined) {
    if (!isObject(state.findings)) return 'findings must be an object from feature ids to entries';
    for (const [id, entry] of Object.entries(state.findings)) {
      const problem = entryProblem(`findings ${id}`, entry);
      if (problem !== null) return problem;
    }
  }
  if (state.systemFindings !== undefined) {
    if (!isObject(state.systemFindings)) return 'systemFindings must be an object from application keys (app1, app2, ...) to entries';
    for (const [key, entry] of Object.entries(state.systemFindings)) {
      const problem = /^app[1-9][0-9]*$/.test(key) ? entryProblem(`systemFindings ${key}`, entry) : `systemFindings has the key ${JSON.stringify(key)}, which is not app<n>`;
      if (problem !== null) return problem;
      if (entry.root !== undefined && (typeof entry.root !== 'string' || entry.root === '')) return `systemFindings ${key} has a root that is not a non-empty string`;
    }
  }
  if (state.priority !== undefined) {
    const problem = priorityEntryProblem(state.priority);
    if (problem !== null) return problem;
  }
  if (state.remedies !== undefined) {
    const problem = remediesEntryProblem(state.remedies);
    if (problem !== null) return problem;
  }
  if (state.topics !== undefined) {
    if (!isObject(state.topics)) return 'topics must be an object from lane ids to entries';
    for (const [lane, entry] of Object.entries(state.topics)) {
      const problem = topicsEntryProblem(lane, entry);
      if (problem !== null) return problem;
    }
  }
  if (state.domainFlows !== undefined) {
    const flows = state.domainFlows;
    if (!isObject(flows) || !DOMAIN_FLOWS_STATUSES.includes(flows.status) || !Number.isInteger(flows.attempts) || flows.attempts < 0 || !Array.isArray(flows.reasons) || !flows.reasons.every((reason) => typeof reason === 'string')) {
      return `domainFlows must be { status (${DOMAIN_FLOWS_STATUSES.join(', ')}), attempts, reasons: [string] }`;
    }
  }
  if (state.architecture !== undefined) {
    const one = state.architecture;
    const noteOk = (note) => isObject(note) && ['id', 'kind', 'detail'].every((key) => typeof note[key] === 'string');
    if (!isObject(one) || !ARCHITECTURE_STATUSES.includes(one.status) || !Number.isInteger(one.attempts) || one.attempts < 0 || !Array.isArray(one.notes) || !one.notes.every(noteOk)
      || (one.reasons !== undefined && !(Array.isArray(one.reasons) && one.reasons.every((reason) => typeof reason === 'string')))) {
      return `architecture must be { status (${ARCHITECTURE_STATUSES.join(', ')}), attempts, notes: [{ id, kind, detail }], reasons?: [string] }`;
    }
  }
  return state.overview === undefined ? null : entryProblem('overview', state.overview);
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

/** Whether the items removed so far include the purpose: the entry then has none, like a settled one (entry-shape.mjs). */
export const purposeRemoved = (feature) => (feature.removed ?? []).some((item) => item.path === 'purpose');

/** The SHA-256 of an entry file's bytes: a confirmed or verified feature is invalidated when they change. */
export const entryDigest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
