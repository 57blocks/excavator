/**
 * Keeps the comparison candidate ids in the batch files other than c-* pointing at the candidates they were written for
 * (openspec change handbook-process-review). Candidate ids are positions in entries/review-compare.json and every
 * `review compare-facts` numbers them again, so a run that adds or drops an earlier candidate gives every later one
 * another id. A domain batch file holds the review of its features as well as the conclusions on its two-implementation
 * candidates, so it is not removed like a c-* batch file; its candidate ids are rewritten instead. Only an id that the
 * previous run gave to a candidate of the same batch is touched: it gets the new id of that candidate, or is dropped when
 * the candidate is gone or moved to another batch, so that the candidate shows as without a conclusion rather than another
 * candidate taking its conclusion. Any other id (unknown, or of another batch, as in a process batch) was already wrong
 * and is left for the batch check to report. When the previous candidates file is unreadable every id is dropped.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { isObject, readJson, writeJson } from './json-file.mjs';

/** What `rebind` returns for an id it drops; every other value, null included, stays in the file. */
const DROP = Symbol('drop');

/** What a candidate is, without its id and batch. */
const keyOf = (candidate) => JSON.stringify([candidate.source, candidate.features, candidate.facts, candidate.places]);

/** Old id -> `{ batch, next }`: its batch then, and the new candidate with the same key or null. Equal keys are paired in order. */
export function candidateRenames(previous, candidates) {
  const renames = new Map();
  if (previous === null) return renames;
  const free = new Map();
  for (const candidate of candidates) {
    const key = keyOf(candidate);
    if (!free.has(key)) free.set(key, []);
    free.get(key).push(candidate);
  }
  for (const old of previous) {
    if (!isObject(old) || typeof old.id !== 'string') continue;
    const queue = free.get(keyOf(old));
    renames.set(old.id, { batch: old.batch, next: queue !== undefined && queue.length > 0 ? queue.shift() : null });
  }
  return renames;
}

/**
 * Rewrites the candidate ids of the items and dismissals of entries/review/<batch>.json and <batch>.unpruned.json for
 * every batch other than c-*; writes a file only when one of its ids changes. Returns `{ name, renamed, dropped }` per
 * written file.
 */
export function rebindBatchFiles(outDir, previous, candidates) {
  const dir = join(outDir, 'entries', 'review');
  if (!existsSync(dir)) return [];
  const renames = candidateRenames(previous, candidates);
  const written = [];
  for (const name of readdirSync(dir).sort()) {
    const found = /^([^.]+)(?:\.unpruned)?\.json$/.exec(name);
    if (found === null || found[1].startsWith('c-')) continue;
    const batch = found[1];
    const read = readJson(join(dir, name));
    if (!read.ok || !isObject(read.value)) continue;
    let renamed = 0;
    let dropped = 0;
    /** The new id of `id`, or DROP; a value that is not a string is left for the batch check. */
    const rebind = (id) => {
      if (typeof id !== 'string') return id;
      let next = DROP;
      if (previous !== null) {
        const rename = renames.get(id);
        if (rename === undefined || rename.batch !== batch) return id;
        if (rename.next !== null && rename.next.batch === batch) next = rename.next.id;
      }
      if (next === DROP) dropped += 1;
      else if (next !== id) renamed += 1;
      return next;
    };
    const value = { ...read.value };
    if (Array.isArray(value.items)) {
      value.items = value.items.map((item) => {
        if (!isObject(item) || !Array.isArray(item.candidates)) return item;
        const list = item.candidates.map(rebind).filter((id) => id !== DROP);
        if (list.length > 0 || item.candidates.length === 0) return { ...item, candidates: list };
        const { candidates: _gone, ...rest } = item;
        return rest;
      });
    }
    if (Array.isArray(value.dismissed)) {
      value.dismissed = value.dismissed
        .map((entry) => (isObject(entry) && Object.hasOwn(entry, 'candidate') ? { ...entry, candidate: rebind(entry.candidate) } : entry))
        .filter((entry) => !isObject(entry) || entry.candidate !== DROP);
    }
    if (renamed === 0 && dropped === 0) continue;
    writeJson(join(dir, name), value);
    written.push({ name, renamed, dropped });
  }
  return written;
}
