/**
 * The items a verifier judges (design D14), and which of them a round covers.
 *
 * An item is a node of an entry that carries evidence, named by its JSON path
 * (items.mjs): `{ id, claim, evidence, fingerprint }`. Round 1 covers every
 * item. Round 2 covers the items round 1 listed for the one rewrite, by path:
 * the rewrite may only change those items, never delete or add one (the script
 * removes what is still not verified), so the item paths of the rewritten
 * entry are those of the round-1 snapshot (less the items round 1 removed),
 * and every item that was not listed is identical at its path. A listed item
 * implies its descendants (a screen its fields and rules). The rewrite may
 * change the claim text and the citations of these items (a narrowing), never
 * the name and label keys of name-keys.mjs.
 *
 * The items of a round are cut into parts, each its own verify file and its own
 * two verdict files, so that a verifier can read one in a single read: filled
 * greedily in item order, at most `PART_MAX_BYTES` of JSON and `PART_MAX_ITEMS`
 * items a part; an item larger than the byte limit alone is a part of its own
 * and is not cut.
 */

import { join } from 'node:path';

import { codeBlocks } from './code-slice.mjs';
import { nameChanges } from './name-keys.mjs';
import { shiftedPath } from './shift-paths.mjs';

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
/** The two verifiers of a part, each with a verdict file of its own: `part-<n>.a.json` and `part-<n>.b.json`. */
export const VERIFIERS = Object.freeze(['a', 'b']);
export const verdictPartPath = (outDir, id, round, part, letter) => join(verdictDirPath(outDir, id, round), `part-${part}.${letter}.json`);
export const snapshotPath = (outDir, id) => join(outDir, VERIFY_DIR, 'round-1', `${id}.entry.json`);
export const rewriteFilePath = (outDir, id) => join(outDir, REWRITE_DIR, `${id}.json`);

/** The items of `entry` (of the unit `unit`, unit.mjs) that carry evidence, in entry order. `ui` is the run's fixed-text table; `files` a projectFiles reader. */
export function verifyItems(unit, entry, { ui, files, map = null }) {
  const claims = unit.claims(entry, ui, { map });
  return unit.items(entry).filter((item) => item.evidence.length > 0).map((item) => {
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
 * are the items (`verifyItems`) of the round-1 entry and the rewritten one;
 * `removedAtRound1` the paths round 1 removed from the entry (the records of
 * state.json; only a state written before round 1 stopped removing has any):
 * those items and what hangs on them are gone from the rewritten
 * entry on purpose, so they are not missing, and the items after them in an
 * array have moved up, so the snapshot is read at their new paths (the paths
 * the rewrite file names). `names` is `{ before, after }`, the name and label
 * keys (name-keys.mjs `identityKeys`) of the round-1 entry read at those same
 * paths and of the rewritten one; it is required, so the names are always compared.
 * A listed item, and each item below one, may change its claim and its
 * citations, but not a name or label key of its own node or of a node above it.
 * Returns `{ problems, items, narrowed }`: the problem lines (an item path that
 * was added or is missing, an item that was not listed and changed, a listed
 * item whose name or label changed), the items to verify, those of the listed
 * items and their descendants, and `{ path, from, to }` for each of them whose
 * claim differs from round 1.
 */
export function roundTwoPlan(rewrite, snapshot, current, removedAtRound1, names) {
  if (names === undefined || names === null) throw new Error('roundTwoPlan needs the name and label keys of both entries');
  const problems = [];
  const gone = new Set(removedAtRound1);
  const isGone = (id) => gone.has(id) || [...gone].some((ancestor) => isBelow(id, ancestor));
  const kept = snapshot.filter((item) => !isGone(item.id)).map((item) => ({ ...item, id: shiftedPath(item.id, gone) }));
  const listedIds = new Set(rewrite.items.map((item) => item.id));
  for (const id of listedIds) {
    if (!kept.some((item) => item.id === id)) problems.push(`rewrite file: ${id} is not an item of the round 1 entry`);
  }
  const before = new Map(kept.map((item) => [item.id, item]));
  const after = new Set(current.map((item) => item.id));
  for (const item of current) if (!before.has(item.id)) problems.push(`${item.id}: added`);
  for (const item of kept) if (!after.has(item.id)) problems.push(`${item.id}: missing`);
  const items = [];
  const narrowed = [];
  for (const item of current) {
    const old = before.get(item.id);
    if (old === undefined) continue;
    if (listedIds.has(item.id) || [...listedIds].some((ancestor) => isBelow(item.id, ancestor))) {
      items.push(item);
      const renamed = nameChanges(names.before, names.after, item.id);
      if (renamed.length > 0) problems.push(`${item.id}: listed for rewriting, but a name or label changed (${renamed.join(', ')}); names and labels may not change`);
      else if (old.claim !== item.claim) narrowed.push({ path: item.id, from: old.claim, to: item.claim });
    } else if (old.fingerprint !== item.fingerprint) {
      problems.push(`${item.id}: not listed for rewriting, but changed`);
    }
  }
  return { problems, items, narrowed };
}
