/**
 * The state of the remedies unit and the remedies a run holds (openspec change
 * handbook-remedies, design D3). The unit has the id `remedies` and its entry is
 * `state.remedies` (absent means planned with no attempt, so an output
 * directory from before it needs no migration). Its status is `planned`,
 * `dispatched`, `checked` (the lane wrote a file that passed check-remedies),
 * `verified` (two judges settled each paragraph, an older run) or `failed`; `checked` is final in the light scheme (openspec change handbook-light-scheme). The entry keeps
 * the digest of the facts the lane was given (`factsDigest`) and, once
 * verified, the paragraphs the judges did not both accept (`dropped`).
 * `load-run.mjs` reads the remedies through `loadRemedies`: only a checked or
 * verified unit whose file is still the one that was checked has any, a checked
 * one marked `unverified`; whether the facts are the
 * current ones is for the model that builds the outputs to decide
 * (remedies-model.mjs), since only it has the facts.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { readJson } from './json-file.mjs';
import { REMEDIES_FILE, remediesShapeProblems } from './remedies-shape.mjs';
import { entryDigest } from './state.mjs';

const PLANNED = Object.freeze({ status: 'planned', attempts: 0 });

/** The entry of the remedies unit in `state`: planned with no attempt when there is none. */
export const remediesEntry = (state) => state.remedies ?? { ...PLANNED };

/**
 * The remedies of a loaded state: `{ status, doc, dropped, factsDigest }`. `doc` is the parsed remedies file when the unit is
 * checked or verified and the file passes its shape and is the file that was checked (its digest), else null; `unverified` is true for a checked unit; `dropped` is what the judges
 * did not both accept, `[{ id, reasons }]`, empty without a `doc`; `factsDigest` is the digest the unit was made for.
 */
export function loadRemedies(outDir, state) {
  const entry = remediesEntry(state);
  const none = { status: entry.status, doc: null, dropped: [], factsDigest: entry.factsDigest ?? null };
  if (!['checked', 'verified'].includes(entry.status)) return none;
  const path = join(outDir, REMEDIES_FILE);
  if (!existsSync(path)) return none;
  const read = readJson(path);
  if (!read.ok || remediesShapeProblems(read.value).length > 0) return none;
  if (entryDigest(path) !== entry.entryDigest) return none;
  return { status: entry.status, doc: read.value, dropped: entry.dropped ?? [], factsDigest: entry.factsDigest ?? null, ...(entry.status === 'checked' ? { unverified: true } : {}) };
}
