/**
 * The checked state of a handbook run, loaded for an output (design D11,
 * D13): the candidates, the map, the state, the fixed-text table and every
 * verified entry. The map and each verified entry are checked again against the
 * project, so a run whose files changed after their check is refused instead
 * of written out; a verified entry must also still be the file the verifier
 * saw (its digest in state.json). A feature that is only checked has no entry
 * in the output. `assemble` and `page` both start here, so they refuse the
 * same runs.
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

/**
 * Returns `{ ok: true, outDir, map, entries, state, candidates, ui }` (entries:
 * id -> entry of each verified feature; candidates: candidates.json's items;
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

  // Only a verified feature reaches the output (design D14); its entry is checked again, and must be the file that was verified.
  const entries = new Map();
  const problems = [];
  for (const id of ids.filter((featureId) => state.features[featureId].status === 'verified')) {
    const result = checkEntryFile(outDir, id, root, { map, mapLabels: mapChecked.verified, files, memberDirs, languageCheck });
    if (result.problems.length > 0) {
      problems.push(...result.problems.map((line) => (line.startsWith(`${id}:`) ? line : `${id}: ${line}`)), `${id}: ${entryPath(id)} no longer passes check-entry; run check-entry for ${id}`);
    } else if (entryDigest(join(outDir, entryPath(id))) !== state.features[id].entryDigest) {
      problems.push(`${id}: ${entryPath(id)} changed after it was verified; run check-entry for ${id} and verify it again`);
    } else {
      entries.set(id, readJson(join(outDir, entryPath(id))).value);
    }
  }
  if (problems.length > 0) return { ok: false, lines: problems };
  return { ok: true, outDir, map, entries, state, candidates: candidates.items, ui: ui.strings };
}
