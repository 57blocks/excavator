/**
 * `handbook.mjs slices <out> <id> --project <root> [--round 2]` (design D14):
 * cut a checked entry into the items a verifier judges, each with its claim
 * and the source around every passage it cites, and write
 * `<out>/verify/round-<r>/<id>/part-<n>.json`, one file per part (the items cut
 * by bytes, verify-plan.mjs), and prints the verify file and the two verdict
 * files of each part (one for each of its two verifiers). Round 1 covers every
 * item with evidence and keeps a snapshot of the entry; round 2 covers only what the one rewrite left of the
 * items round 1 listed, and refuses an entry in which an item that was not
 * listed differs from the snapshot. Changes only files under `<out>/verify`
 * (and clears the feature's older verification files of the round and those
 * after it, so a new round starts clean).
 */

import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { checkEntryFile, entryPath, loadForEntry } from './entry-check.mjs';
import { readJson, writeJson } from './json-file.mjs';
import { loadState, featureState } from './state.mjs';
import { loadUi } from './ui.mjs';
import { UsageError } from './errors.mjs';
import {
  VERIFIERS, fileItems, partFile, rewriteFilePath, roundTwoPlan, snapshotPath, splitParts, verdictDirPath, verdictPartPath,
  verifyDirPath, verifyItems, verifyPartPath,
} from './verify-plan.mjs';

/** The state of feature `id`, or the lines that stop a verification command: only a checked feature is verified. */
export function checkedFeature(outDir, id, round) {
  const stateRead = loadState(outDir);
  if (!stateRead.ok) {
    if (stateRead.missing) throw new UsageError(stateRead.problem);
    return { stop: { status: 1, lines: [stateRead.problem] } };
  }
  const current = featureState(stateRead.state, id);
  if (current.status !== 'checked') {
    return { stop: { status: 1, lines: [`${id}: is ${current.status}; only a checked feature is verified`, `Next: ${current.status === 'verified' ? 'nothing; it is verified' : `run check-entry for ${id} first`}`] } };
  }
  if (round === 1 && current.rewriting) return { stop: { status: 1, lines: [`${id}: round 1 is done and its items wait for the rewrite`, `Next: rewrite the items listed in ${rewriteFilePath(outDir, id)}, run check-entry, then slices --round 2`] } };
  if (round === 2 && !current.rewriting) return { stop: { status: 1, lines: [`${id}: round 1 listed no items to rewrite, so there is no round 2`, `Next: run slices for ${id} without --round and send its items to the verifier`] } };
  return { current };
}

/**
 * The items of the round for feature `id`, from the entry as it is now, or the
 * lines that stop the command. Used by slices to write them and by verdicts to
 * check that the verify file still matches. Returns
 * `{ items, entry, loaded, claims }` (claims: path to claim of every
 * item of the entry) or `{ stop }`.
 */
export function planRound(outDir, id, root, round) {
  const loaded = loadForEntry(outDir, id, root);
  if (loaded.stop) return { stop: loaded.stop };
  const result = checkEntryFile(outDir, id, root, loaded);
  if (result.problems.length > 0) {
    return { stop: { status: 1, lines: [...result.problems, `Next: fix ${entryPath(id)} (or run check-entry for ${id}) and run this command again`] } };
  }
  const ui = loadUi(outDir);
  if (!ui.ok) return { stop: { status: 1, lines: ui.lines } };
  const entry = readJson(join(outDir, entryPath(id))).value;
  const context = { ui: ui.strings, files: loaded.files };
  const items = verifyItems(entry, context);
  const claims = new Map(items.map((item) => [item.id, item.claim]));
  if (round === 1) return { items, entry, loaded, claims };

  const rewrite = readJson(rewriteFilePath(outDir, id));
  const snapshot = readJson(snapshotPath(outDir, id));
  if (!rewrite.ok || !snapshot.ok) {
    return { stop: { status: 1, lines: [`${id}: the rewrite file or the round 1 snapshot ${!rewrite.ok ? 'is missing' : 'cannot be read'}`, `Next: run slices for ${id} without --round, then verdicts --round 1`] } };
  }
  const plan = roundTwoPlan(rewrite.value, verifyItems(snapshot.value, context), items);
  if (plan.problems.length > 0) {
    return { stop: { status: 1, lines: [...plan.problems, `Next: put each item above back as it was in round 1 (change only the items listed in ${rewriteFilePath(outDir, id)}, and never delete or add an item), run check-entry, then slices --round 2 again`] } };
  }
  return { items: plan.items, entry, loaded, claims };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Run slices. Returns { status, lines }. */
export function slices(outDir, id, root, round) {
  const feature = checkedFeature(outDir, id, round);
  if (feature.stop) return feature.stop;
  const plan = planRound(outDir, id, root, round);
  if (plan.stop) return plan.stop;

  const dirs = [verifyDirPath(outDir, id, round), verdictDirPath(outDir, id, round)];
  if (round === 1) {
    rmSync(rewriteFilePath(outDir, id), { force: true });
    dirs.push(verifyDirPath(outDir, id, 2), verdictDirPath(outDir, id, 2));
  }
  for (const stale of dirs) rmSync(stale, { recursive: true, force: true });
  mkdirSync(verifyDirPath(outDir, id, round), { recursive: true });
  if (round === 1) writeJson(snapshotPath(outDir, id), plan.entry);
  const parts = splitParts(id, round, fileItems(plan.items));
  const lines = [`${id}: round ${round}, ${plural(plan.items.length, 'item')} in ${plural(parts.length, 'part')}`];
  parts.forEach((items, index) => {
    const number = index + 1;
    writeJson(verifyPartPath(outDir, id, round, number), partFile(id, round, number, parts.length, items));
    const verdictFiles = VERIFIERS.map((letter) => verdictPartPath(outDir, id, round, number, letter));
    lines.push(`Part ${number}/${parts.length}: Verify file: ${verifyPartPath(outDir, id, round, number)} | Verdict files: ${verdictFiles.join(' ')}`);
  });
  lines.push(`Next: dispatch two excavator-handbook-verifier subagents for each part of ${id}, one for each of the two verdict files of its line above, then run verdicts --round ${round}`);
  return { status: 0, lines };
}
