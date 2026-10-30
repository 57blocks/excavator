/**
 * The items a verifier judges (design D14), and which of them a round covers.
 *
 * An item is a node of an entry that carries evidence, named by its JSON path
 * (items.mjs): `{ id, claim, evidence, fingerprint }`. Round 1 covers every
 * item. Round 2 covers the items round 1 listed for the one rewrite, by path:
 * the rewrite may only change those items, never delete or add one (the script
 * removes what is still not verified), so the item paths of the rewritten
 * entry are those of the round-1 snapshot, and every item that was not listed
 * is identical at its path. A listed item implies its descendants (a screen
 * its fields and rules): their claims carry the parent's text, so they may
 * change with it.
 *
 * The items of a round are cut into parts, each its own verify file and its own
 * verdict file, so that a verifier can read one in a single read: filled
 * greedily in item order, at most `PART_MAX_BYTES` of JSON and `PART_MAX_ITEMS`
 * items a part; an item larger than the byte limit alone is a part of its own
 * and is not cut.
 */

import { join } from 'node:path';

import { codeBlocks } from './code-slice.mjs';
import { itemClaims } from './claims.mjs';
import { entryItems } from './items.mjs';

export const VERIFY_DIR = 'verify';
export const VERDICT_DIR = 'verdicts';
export const REWRITE_DIR = 'rewrite';
export const ROUNDS = Object.freeze([1, 2]);

export const PART_MAX_BYTES = 60000;
export const PART_MAX_ITEMS = 25;

/** The directory of the feature's verify parts (and the part file in it) for a round. */
export const verifyDirPath = (outDir, id, round) => join(outDir, VERIFY_DIR, `round-${round}`, id);
export const verifyPartPath = (outDir, id, round, part) => join(verifyDirPath(outDir, id, round), `part-${part}.json`);
export const verdictDirPath = (outDir, id, round) => join(outDir, VERDICT_DIR, `round-${round}`, id);
export const verdictPartPath = (outDir, id, round, part) => join(verdictDirPath(outDir, id, round), `part-${part}.json`);
export const snapshotPath = (outDir, id) => join(outDir, VERIFY_DIR, 'round-1', `${id}.entry.json`);
export const rewriteFilePath = (outDir, id) => join(outDir, REWRITE_DIR, `${id}.json`);

/** The items of `entry` that carry evidence, in entry order. `ui` is the run's fixed-text table; `files` a projectFiles reader. */
export function verifyItems(entry, { ui, files }) {
  const claims = itemClaims(entry, ui);
  return entryItems(entry).filter((item) => item.evidence.length > 0).map((item) => {
    const claim = claims.get(item.path);
    if (claim === undefined) throw new Error(`no claim for item ${item.path}`);
    return {
      id: item.path,
      claim,
      evidence: codeBlocks(files, item.evidence),
      fingerprint: JSON.stringify([claim, item.evidence.map((entry) => [entry.file, entry.passage])]),
    };
  });
}

/** The verify file's items: the same as `items` without the fingerprint. */
export const fileItems = (items) => items.map(({ id, claim, evidence }) => ({ id, claim, evidence }));

/** The content of a verify part file. */
export const partFile = (feature, round, part, parts, items) => ({ feature, round, part, parts, items });

/**
 * Cut the file items (`fileItems`) of a round into parts: `[{ items }]` in item
 * order, as `partFile` contents without their numbers. A part is full when one
 * more item would take its JSON, as writeJson writes it, over `PART_MAX_BYTES`
 * (the part numbers counted as four digits, so the written file is never over)
 * or its item count over `PART_MAX_ITEMS`; an item that alone is over the byte
 * limit still gets a part, alone.
 */
export function splitParts(feature, round, items) {
  const bytes = (list) => Buffer.byteLength(`${JSON.stringify(partFile(feature, round, 9999, 9999, list), null, 2)}\n`);
  const parts = [];
  let current = [];
  for (const item of items) {
    const grown = [...current, item];
    if (current.length > 0 && (grown.length > PART_MAX_ITEMS || bytes(grown) > PART_MAX_BYTES)) {
      parts.push(current);
      current = [item];
    } else {
      current = grown;
    }
  }
  if (current.length > 0 || parts.length === 0) parts.push(current);
  return parts;
}

const isBelow = (path, ancestor) => path.startsWith(`${ancestor}.`);

/**
 * The round-2 plan of a rewritten entry against the round-1 snapshot.
 * `rewrite` is the rewrite file's parsed content; `snapshot` and `current`
 * are the items (`verifyItems`) of the round-1 entry and the rewritten one.
 * Returns `{ problems, items }`: the problem lines (an item path that was
 * added or is missing, or an item that was not listed and changed) and the
 * items to verify, those of the listed items and their descendants.
 */
export function roundTwoPlan(rewrite, snapshot, current) {
  const problems = [];
  const listedIds = new Set(rewrite.items.map((item) => item.id));
  for (const id of listedIds) {
    if (!snapshot.some((item) => item.id === id)) problems.push(`rewrite file: ${id} is not an item of the round 1 entry`);
  }
  const before = new Map(snapshot.map((item) => [item.id, item]));
  const after = new Set(current.map((item) => item.id));
  for (const item of current) if (!before.has(item.id)) problems.push(`${item.id}: added`);
  for (const item of snapshot) if (!after.has(item.id)) problems.push(`${item.id}: missing`);
  const items = [];
  for (const item of current) {
    const old = before.get(item.id);
    if (old === undefined) continue;
    if (listedIds.has(item.id) || [...listedIds].some((ancestor) => isBelow(item.id, ancestor))) items.push(item);
    else if (old.fingerprint !== item.fingerprint) problems.push(`${item.id}: not listed for rewriting, but changed`);
  }
  return { problems, items };
}
