/**
 * `handbook.mjs verdicts <out> <id> --round <r> --project <root>` (design
 * D14): record a verifier's verdicts for one round of one feature.
 *
 * A round's verify file is cut into parts (verify-plan.mjs), each judged by two
 * verifiers that do not see each other, each with its own verdict file
 * `verdicts/round-<r>/<id>/part-<n>.a.json` and `part-<n>.b.json`
 * `{ verdicts: [{ id, verdict, reason }] }`. Each of the two files must hold
 * exactly one verdict per item of that part's verify file (a verdict for an item
 * of another part is an extra id), each one of `verified`, `unverified`,
 * `contradicted`, with a non-empty one-line reason, and is checked on its own.
 * The two verdicts of an item are combined (combine-verdicts.mjs), so each item
 * has exactly one verdict over all parts. Any failure prints every problem, by
 * part and letter, and records nothing. Round 1 sends every item that is
 * not verified to the rewrite file (`unverified` and `contradicted` alike: a
 * reader cannot check the code, so a sentence that cannot be proved is not
 * left in); with none, the feature is confirmed. Round 2 removes the items that
 * are still not verified from the entry in place, records them in state.json,
 * and confirms the feature, or fails it when no item that carries evidence is
 * left (the purpose is removed like any other item and does not fail it).
 * A feature either round settles is `confirmed`, not `verified`: the tracers of
 * trace.mjs and trace-verdicts.mjs look for counter-evidence next (design D14).
 */

import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { entryPath, entryProblems } from './entry-check.mjs';
import { isObject, readJson, writeJson } from './json-file.mjs';
import { entryItems } from './items.mjs';
import { reviewItems } from './review.mjs';
import { loadState, saveState, entryDigest } from './state.mjs';
import { checkedFeature, planRound } from './slices.mjs';
import { combineVerdicts } from './combine-verdicts.mjs';
import { removalRecords } from './removal-records.mjs';
import { VERIFIERS, fileItems, partFile, rewriteFilePath, splitParts, verdictPartPath, verifyPartPath } from './verify-plan.mjs';

export const VERDICTS = Object.freeze(['verified', 'unverified', 'contradicted']);

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Every way the verdict file departs from one verdict per item; `files` are the files the items cite. */
export function verdictProblems(raw, items, files) {
  if (!isObject(raw) || !Array.isArray(raw.verdicts)) return ['verdicts: must be an array in an object { "verdicts": [...] }'];
  const problems = [];
  const ids = new Set(items.map((item) => item.id));
  const seen = new Set();
  raw.verdicts.forEach((entry, index) => {
    if (!isObject(entry) || typeof entry.id !== 'string') {
      problems.push(`verdicts[${index}]: must be an object with id, verdict and reason`);
      return;
    }
    const { id } = entry;
    if (!ids.has(id)) problems.push(`${id}: is not an item of the verify file`);
    else if (seen.has(id)) problems.push(`${id}: more than one verdict`);
    seen.add(id);
    if (!VERDICTS.includes(entry.verdict)) problems.push(`${id}: verdict ${JSON.stringify(entry.verdict)} is not one of ${VERDICTS.join(', ')}`);
    if (typeof entry.reason !== 'string' || entry.reason.trim() === '') problems.push(`${id}: the reason must be a non-empty string`);
    else if (/[\r\n]/.test(entry.reason.trim())) problems.push(`${id}: the reason must be one line`);
    else {
      const named = files.find((file) => entry.reason.includes(file));
      if (named !== undefined) problems.push(`${id}: the reason names the file ${named}; describe the condition in words, with no file name`);
    }
  });
  for (const item of items) if (!seen.has(item.id)) problems.push(`${item.id}: no verdict`);
  return problems;
}

/**
 * A reason of a verdict that is not `verified` reaches readers (the coverage
 * section lists it), so it passes the gate of reader text: the banned-words
 * gate, with the labels the entry's own check exempts (the map's and the
 * entry's verified ones), and the narrative language check when the run has
 * one (review.mjs, narrative.mjs). Returns problem lines naming the item.
 */
export function reasonProblems(verdictList, { entry, loaded }) {
  const { files, memberDirs, mapLabels, languageCheck } = loaded;
  const entryLabels = reviewItems(entryItems(entry), { files, memberDirs, exemptLabels: mapLabels }).verified;
  const gated = verdictList.filter((verdict) => verdict.verdict !== 'verified').map((verdict) => ({
    path: `${verdict.id}.reason`,
    strings: [{ path: `${verdict.id}.reason`, text: verdict.reason.trim(), label: false, numbers: false, narrative: true }],
    evidence: [],
    passages: [],
  }));
  return reviewItems(gated, { files, memberDirs, exemptLabels: new Set([...mapLabels, ...entryLabels]), languageCheck }).problems;
}

/** The last line of a settled feature: the tracers are next (trace.mjs). */
const traceNext = (id) => `Next: run trace for ${id}, dispatch two excavator-handbook-tracers per part, then run trace-verdicts`;

const joinAnd = (list) => (list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`);
const partNoun = (list) => (list.length === 1 ? 'part' : 'parts');

/** The part-letters (`{ part, letter }`) in part order, then letter order, as `1a, 1b, 2a`. */
export const byPartLetter = (x, y) => x.part - y.part || x.letter.localeCompare(y.letter);
export const tagOf = ({ part, letter }) => `${part}${letter}`;

/**
 * Read the verify files and the two verdict files of every part of the round
 * and check them, each file on its own. Returns `{ verdictList }` (the combined
 * verdicts of all parts, in part order) or `{ stop }`: a stale or missing
 * verify part, or the problem lines of the verdict files, each line led by its
 * part and letter, with a Next line that names exactly the part-letters to
 * dispatch again.
 */
function readParts(outDir, id, round, plan) {
  const roundFlag = round === 2 ? ' --round 2' : '';
  const expected = splitParts(id, round, fileItems(plan.items)).map((items, index, all) => partFile(id, round, index + 1, all.length, items));
  const stale = [];
  const missingVerify = [];
  for (const part of expected) {
    const read = readJson(verifyPartPath(outDir, id, round, part.part));
    if (!read.ok) missingVerify.push(`part ${part.part}: verify/round-${round}/${id}/part-${part.part}.json ${read.reason}`);
    else if (JSON.stringify(read.value) !== JSON.stringify(part)) stale.push(part.part);
  }
  if (missingVerify.length > 0) return { stop: { status: 1, lines: [...missingVerify, `Next: run slices for ${id}${roundFlag} first`] } };
  if (stale.length > 0) {
    return { stop: { status: 1, lines: [`${id}: the entry or the source changed since slices wrote the files of verify/round-${round}/${id}/ (${partNoun(stale)} ${joinAnd(stale)})`, `Next: run slices again${roundFlag} for ${id}, then send each part to its two verifiers`] } };
  }

  const files = [...new Set(plan.items.flatMap((item) => item.evidence.map((block) => block.file)))];
  const lines = [];
  const missing = [];
  const rejected = [];
  const pairs = [];
  for (const part of expected) {
    const given = {};
    for (const letter of VERIFIERS) {
      const label = `part ${tagOf({ part: part.part, letter })}`;
      const read = readJson(verdictPartPath(outDir, id, round, part.part, letter));
      const where = `verdicts/round-${round}/${id}/part-${part.part}.${letter}.json`;
      if (!read.ok) {
        (read.missing ? missing : rejected).push({ part: part.part, letter });
        lines.push(`${label}: ${where} ${read.reason}`);
        continue;
      }
      const problems = verdictProblems(read.value, part.items, files);
      if (problems.length === 0) problems.push(...reasonProblems(read.value.verdicts, plan));
      if (problems.length > 0) {
        rejected.push({ part: part.part, letter });
        lines.push(...problems.map((problem) => `${label}: ${problem}`));
      } else {
        given[letter] = read.value.verdicts;
      }
    }
    if (VERIFIERS.every((letter) => given[letter] !== undefined)) pairs.push(given);
  }
  if (missing.length === 0 && rejected.length === 0) {
    const verdictList = pairs.flatMap((given) => {
      const second = new Map(given.b.map((entry) => [entry.id, entry]));
      return given.a.map((entry) => combineVerdicts(entry, second.get(entry.id)));
    });
    return { verdictList };
  }
  const again = [...missing, ...rejected].sort(byPartLetter).map(tagOf);
  if (rejected.length === 0) {
    const names = missing.sort(byPartLetter).map(tagOf);
    return { stop: { status: 1, lines: [...lines, `Next: dispatch the verifier once more for ${id} for exactly the missing ${partNoun(names)}: ${joinAnd(names)}, each with the verify file and the verdict file path slices printed for it`] } };
  }
  const names = rejected.sort(byPartLetter).map(tagOf);
  return { stop: { status: 1, lines: [...lines, `Next: delete the verdict ${names.length === 1 ? 'file' : 'files'} of ${partNoun(names)} ${joinAnd(names)} and dispatch the verifier once more for ${partNoun(again)} ${joinAnd(again)} with the lines above; nothing was recorded`] } };
}

/** Run verdicts. Returns { status, lines }. */
export function verdicts(outDir, id, root, round) {
  const feature = checkedFeature(outDir, id, round);
  if (feature.stop) return feature.stop;
  const plan = planRound(outDir, id, root, round);
  if (plan.stop) return plan.stop;

  const checked = readParts(outDir, id, round, plan);
  if (checked.stop) return checked.stop;
  const { verdictList } = checked;
  const verdictOf = new Map(verdictList.map((entry) => [entry.id, { verdict: entry.verdict, reason: entry.reason.trim() }]));
  const notVerified = plan.items.filter((item) => verdictOf.get(item.id).verdict !== 'verified');

  const stateRead = loadState(outDir);
  const { state } = stateRead;
  const { attempts } = state.features[id];

  if (round === 1) {
    if (notVerified.length === 0) {
      rmSync(rewriteFilePath(outDir, id), { force: true });
      state.features[id] = { status: 'confirmed', attempts, entryDigest: entryDigest(join(outDir, entryPath(id))) };
      saveState(outDir, state);
      return { status: 0, lines: [`${id}: confirmed (${plural(plan.items.length, 'item')})`, traceNext(id)] };
    }
    const rewritePath = rewriteFilePath(outDir, id);
    mkdirSync(dirname(rewritePath), { recursive: true });
    writeJson(rewritePath, {
      feature: id,
      items: notVerified.map((item) => ({ id: item.id, claim: item.claim, verdict: verdictOf.get(item.id).verdict, reason: verdictOf.get(item.id).reason })),
    });
    state.features[id] = { status: 'checked', attempts, rewriting: true };
    saveState(outDir, state);
    return {
      status: 0,
      lines: [
        `${id}: ${plural(notVerified.length, 'item')} to rewrite`,
        `Rewrite file: ${rewritePath}`,
        `Next: dispatch one rewrite subagent for ${id} with the rewrite file, then run check-entry, slices --round 2, the verifier and verdicts --round 2`,
      ],
    };
  }

  // Round 2: what is still not verified is removed.
  return roundTwo({ outDir, id, plan, state, attempts, notVerified, verdictOf });
}

function roundTwo({ outDir, id, plan, state, attempts, notVerified, verdictOf }) {
  const entry = plan.entry;
  const { trimmed, records } = removalRecords(entry, notVerified.map((item) => item.id), (path) => verdictOf.get(path), (path) => plan.claims.get(path));
  const removed = records;
  // Nothing proved: every item that carries evidence is gone. The entry file stays as written for the user to see.
  if (!entryItems(trimmed).some((item) => item.evidence.length > 0)) {
    const text = 'no item could be proved';
    state.features[id] = { status: 'failed', attempts, failure: { step: 'verify', reasons: [text] }, removed };
    saveState(outDir, state);
    return { status: 0, lines: [`${id}: failed at verify: ${text}`] };
  }
  // The purpose is removed like any item, so the trimmed entry is checked as a settled one (no purpose key).
  const problems = entryProblems(trimmed, id, plan.loaded, { settled: true });
  if (problems.length > 0) throw new Error(`the trimmed entry of ${id} fails check-entry (a bug in verdicts):\n${problems.join('\n')}`);
  writeJson(join(outDir, entryPath(id)), trimmed);
  const next = { status: 'confirmed', attempts, entryDigest: entryDigest(join(outDir, entryPath(id))) };
  if (removed.length > 0) next.removed = removed;
  state.features[id] = next;
  saveState(outDir, state);
  const verdictCount = plan.items.length;
  return { status: 0, lines: [removed.length > 0 ? `${id}: confirmed, ${plural(removed.length, 'item')} removed` : `${id}: confirmed (${plural(verdictCount, 'item')})`, traceNext(id)] };
}
