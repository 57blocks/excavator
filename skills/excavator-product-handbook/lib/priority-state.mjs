/**
 * The state of the priority unit and the ranking a run holds (openspec change
 * handbook-findings-priority, design D3 and D6). The unit has the id `priority`
 * and its entry is `state.priority` (absent means planned with no attempt, so an
 * output directory from before it needs no migration). Its status is `planned`,
 * `dispatched`, `checked` (the ranking lane wrote items that passed
 * check-priority; final in the light scheme, openspec change
 * handbook-light-scheme), `verified` (two judges settled each group, an older
 * run) or `failed`. `load-run.mjs` reads the ranking through `loadPriority`:
 * only a checked or verified unit whose file is still the one that was checked
 * has one, a checked one marked `unverified`; any other state is no ranking,
 * which the outputs show as unranked and say so.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { readJson } from './json-file.mjs';
import { PRIORITY_FILE, priorityShapeProblems } from './priority-shape.mjs';
import { entryDigest } from './state.mjs';

const PLANNED = Object.freeze({ status: 'planned', attempts: 0 });

/** The entry of the priority unit in `state`: planned with no attempt when there is none. */
export const priorityEntry = (state) => state.priority ?? { ...PLANNED };

/**
 * The ranking of a loaded state: `{ status, doc, unranked, unverified? }`. `doc`
 * is the parsed priority file when the unit is checked or verified and the file
 * passes its shape and is the file that was checked (its digest), else null;
 * `unranked` is what the judges did not confirm, `[{ key, reasons }]`, empty
 * without a `doc` and for a checked unit; `unverified` is true for a checked unit.
 */
export function loadPriority(outDir, state) {
  const entry = priorityEntry(state);
  const none = { status: entry.status, doc: null, unranked: [] };
  if (!['checked', 'verified'].includes(entry.status)) return none;
  const path = join(outDir, PRIORITY_FILE);
  if (!existsSync(path)) return none;
  const read = readJson(path);
  if (!read.ok || priorityShapeProblems(read.value).length > 0) return none;
  if (entryDigest(path) !== entry.entryDigest) return none;
  return { status: entry.status, doc: read.value, unranked: entry.unranked ?? [], ...(entry.status === 'checked' ? { unverified: true } : {}) };
}
