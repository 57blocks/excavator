/**
 * The checked state of a handbook run, loaded for an output (design D11,
 * D13): the candidates, the map, the state, the fixed-text table and every
 * verified entry. The map and each verified entry are checked again against the
 * project, so a run whose files changed after their check is refused instead
 * of written out; a verified entry must also still be the file the verifiers
 * and the tracers saw (its digest in state.json), and a confirmed one (settled
 * by the verifiers, not yet traced) is checked the same way. Only a verified
 * feature has an entry in the output; a confirmed or checked one has none. The system
 * overview is one more unit of the same kind: its entry is in `entries` under
 * the key `overview` once it is verified. `assemble` and `page` both start
 * here, so they refuse the same runs.
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { memberDirectories } from './banned-words.mjs';
import { loadCandidates } from './candidates.mjs';
import { checkEntryFile, entryPath } from './entry-check.mjs';
import { UsageError } from './errors.mjs';
import { readJson } from './json-file.mjs';
import { languageGate } from './language-check.mjs';
import { mapProblems, readMap } from './map-check.mjs';
import { projectFiles } from './project-files.mjs';
import { entryDigest, loadState } from './state.mjs';
import { loadUi } from './ui.mjs';
import { OVERVIEW_ID, unitFor, unitState } from './unit.mjs';

/**
 * Returns `{ ok: true, outDir, map, entries, state, candidates, ui }` (entries:
 * id -> entry of each verified feature, and of the overview under `overview`; candidates: candidates.json's items;
 * ui: the strings table) or `{ ok: false, lines }` with every reason. Throws a
 * UsageError for an out directory or state that does not exist.
 */
export function loadCheckedRun(outDirArg, root) {
  const outDir = resolve(outDirArg);
  if (!existsSync(outDir)) throw new UsageError(`out directory ${outDir} does not exist`);
  const candidates = loadCandidates(outDir, root);
  if (!candidates.ok) return { ok: false, lines: candidates.problems };
  const mapRead = readMap(outDir);
  if (!mapRead.ok) return { ok: false, lines: [mapRead.line] };
  const map = mapRead.value;
  const files = projectFiles(root);
  const memberDirs = memberDirectories(root);
  const gate = languageGate(outDir, map);
  if (!gate.ok) return { ok: false, lines: gate.lines };
  const languageCheck = gate.check;
  const mapChecked = mapProblems(map, { candidates: candidates.items, files, memberDirs, languageCheck });
  if (mapChecked.problems.length > 0) return { ok: false, lines: mapChecked.problems.map((line) => `map.json: ${line}`) };

  const loaded = loadState(outDir);
  if (!loaded.ok) {
    if (loaded.missing) throw new UsageError(loaded.problem);
    return { ok: false, lines: [loaded.problem] };
  }
  const { state } = loaded;
  const ids = map.features.map((feature) => feature.id);
  const recorded = Object.keys(state.features);
  if (recorded.length !== ids.length || ids.some((id) => state.features[id] === undefined)) {
    return { ok: false, lines: ['state.json lists different features than map.json; run check-map again (with --fresh when the map changed)'] };
  }

  const ui = loadUi(outDir);
  if (!ui.ok) return { ok: false, lines: ui.lines };

  // Only a verified feature reaches the output (design D14), but a confirmed one (settled by the verifiers, not yet traced)
  // is checked the same way: its entry is checked again, and must be the file that was verified or confirmed.
  const entries = new Map();
  const problems = [];
  const settled = [...ids, OVERVIEW_ID].filter((unitId) => ['confirmed', 'verified'].includes(unitState(state, unitId).status));
  for (const id of settled) {
    const current = unitState(state, id);
    const result = checkEntryFile(outDir, id, root, { map, mapLabels: mapChecked.verified, files, memberDirs, languageCheck }, { settled: true });
    if (result.problems.length > 0) {
      problems.push(...result.problems.map((line) => (line.startsWith(`${id}:`) ? line : `${id}: ${line}`)), `${id}: ${entryPath(id)} no longer passes ${unitFor(id).command}; ${unitFor(id).recheck(id)}`);
    } else if (entryDigest(join(outDir, entryPath(id))) !== current.entryDigest) {
      const was = current.status === 'confirmed' ? 'confirmed' : 'verified';
      problems.push(`${id}: ${entryPath(id)} changed after it was ${was}; ${unitFor(id).recheck(id)} and verify it again`);
    } else if (current.status === 'verified') {
      entries.set(id, readJson(join(outDir, entryPath(id))).value);
    }
  }
  if (problems.length > 0) return { ok: false, lines: problems };
  return { ok: true, outDir, map, entries, state, candidates: candidates.items, ui: ui.strings };
}
