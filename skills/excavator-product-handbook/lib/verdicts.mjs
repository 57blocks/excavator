/**
 * `handbook.mjs verdicts <out> <id> --round <r> --project <root>` (design
 * D14): record a verifier's verdicts for one round of one feature.
 *
 * The verdict file `{ verdicts: [{ id, verdict, reason }] }` must hold exactly
 * one verdict per item of that round's verify file, each one of `verified`,
 * `unverified`, `contradicted`, with a non-empty one-line reason; any failure
 * prints every problem and records nothing. Round 1 sends every item that is
 * not verified to the rewrite file (`unverified` and `contradicted` alike: a
 * reader cannot check the code, so a sentence that cannot be proved is not
 * left in); with none, the feature is verified. Round 2 removes the items that
 * are still not verified from the entry in place, records them in state.json,
 * and verifies the feature, or fails it when the purpose is among them.
 */

import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { entryPath, entryProblems } from './entry-check.mjs';
import { isObject, readJson, writeJson } from './json-file.mjs';
import { entryItems } from './items.mjs';
import { reviewItems } from './review.mjs';
import { loadState, saveState, entryDigest } from './state.mjs';
import { checkedFeature, planRound } from './slices.mjs';
import { trimEntry } from './trim-entry.mjs';
import { fileItems, rewriteFilePath, verdictFilePath, verifyFilePath } from './verify-plan.mjs';

export const VERDICTS = Object.freeze(['verified', 'unverified', 'contradicted']);

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const isAncestor = (ancestor, path) => path.startsWith(`${ancestor}.`);

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

/** Records for the items round 2 removes, in entry order, plus the operations left without a sentence. */
function removalRecords(entry, removedByVerdict, verdictOf, claimOf) {
  const removed = new Set(removedByVerdict);
  const { entry: trimmed, together } = trimEntry(entry, removed);
  const order = entryItems(entry).map((item) => item.path);
  const emptiedOperations = together.filter((path) => /^operations\[\d+\]$/.test(path));
  const paths = [...new Set([...removed, ...together.filter((path) => !emptiedOperations.includes(path))])].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const records = paths.map((path) => {
    const underRemoved = [...removed].some((ancestor) => isAncestor(ancestor, path));
    if (!removed.has(path) || underRemoved) return { path, claim: claimOf(path), verdict: 'withParent', reason: '' };
    return { path, claim: claimOf(path), verdict: verdictOf(path).verdict, reason: verdictOf(path).reason };
  });
  for (const path of emptiedOperations) {
    const index = Number(path.match(/\d+/)[0]);
    records.push({ path, claim: entry.operations[index].name, verdict: 'withParent', reason: '' });
  }
  return { trimmed, records };
}

/** Run verdicts. Returns { status, lines }. */
export function verdicts(outDir, id, root, round) {
  const feature = checkedFeature(outDir, id, round);
  if (feature.stop) return feature.stop;
  const plan = planRound(outDir, id, root, round);
  if (plan.stop) return plan.stop;

  const verifyRead = readJson(verifyFilePath(outDir, id, round));
  if (!verifyRead.ok) return { status: 1, lines: [`verify/round-${round}/${id}.json ${verifyRead.reason}`, `Next: run slices for ${id}${round === 2 ? ' --round 2' : ''} first`] };
  if (JSON.stringify(verifyRead.value) !== JSON.stringify({ feature: id, round, items: fileItems(plan.items) })) {
    return { status: 1, lines: [`${id}: the entry or the source changed since slices wrote verify/round-${round}/${id}.json`, `Next: run slices again${round === 2 ? ' --round 2' : ''} for ${id}, then send it to the verifier`] };
  }

  const verdictRead = readJson(verdictFilePath(outDir, id, round));
  if (verdictRead.missing) return { status: 1, lines: [`verdicts/round-${round}/${id}.json is missing`, `Next: dispatch the verifier once more for ${id} with the verify file and the verdict file paths`] };
  if (!verdictRead.ok) return { status: 1, lines: [`verdicts/round-${round}/${id}.json ${verdictRead.reason}`, `Next: delete it and dispatch the verifier once more for ${id}`] };
  const files = [...new Set(plan.items.flatMap((item) => item.evidence.map((block) => block.file)))];
  const problems = verdictProblems(verdictRead.value, plan.items, files);
  if (problems.length === 0) problems.push(...reasonProblems(verdictRead.value.verdicts, plan));
  if (problems.length > 0) return { status: 1, lines: [...problems, `Next: delete the verdict file and dispatch the verifier once more for ${id} with the lines above; nothing was recorded`] };
  const given = verdictRead.value.verdicts;
  const verdictOf = new Map(given.map((entry) => [entry.id, { verdict: entry.verdict, reason: entry.reason.trim() }]));
  const notVerified = plan.items.filter((item) => verdictOf.get(item.id).verdict !== 'verified');

  const stateRead = loadState(outDir);
  const { state } = stateRead;
  const { attempts } = state.features[id];

  if (round === 1) {
    if (notVerified.length === 0) {
      rmSync(rewriteFilePath(outDir, id), { force: true });
      state.features[id] = { status: 'verified', attempts, entryDigest: entryDigest(join(outDir, entryPath(id))) };
      saveState(outDir, state);
      return { status: 0, lines: [`${id}: verified (${plural(plan.items.length, 'item')})`] };
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
  if (notVerified.some((item) => item.id === 'purpose')) {
    const { verdict, reason } = verdictOf.get('purpose');
    const text = `the purpose could not be proved (${verdict}: ${reason})`;
    state.features[id] = { status: 'failed', attempts, failure: { step: 'verify', reasons: [text] }, removed };
    saveState(outDir, state);
    return { status: 0, lines: [`${id}: failed at verify: ${text}`] };
  }
  const problems = entryProblems(trimmed, id, plan.loaded);
  if (problems.length > 0) throw new Error(`the trimmed entry of ${id} fails check-entry (a bug in verdicts):\n${problems.join('\n')}`);
  writeJson(join(outDir, entryPath(id)), trimmed);
  const next = { status: 'verified', attempts, entryDigest: entryDigest(join(outDir, entryPath(id))) };
  if (removed.length > 0) next.removed = removed;
  state.features[id] = next;
  saveState(outDir, state);
  const verdictCount = plan.items.length;
  return { status: 0, lines: [removed.length > 0 ? `${id}: verified, ${plural(removed.length, 'item')} removed` : `${id}: verified (${plural(verdictCount, 'item')})`] };
}
