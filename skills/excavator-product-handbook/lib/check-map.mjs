/** `handbook.mjs check-map <out> --project <root>`: check map.json against candidates.json and the project, then settle state.json. */

import { existsSync } from 'node:fs';

import { memberDirectories } from './banned-words.mjs';
import { loadCandidates } from './candidates.mjs';
import { UsageError } from './errors.mjs';
import { languageGate } from './language-check.mjs';
import { mapProblems, readMap } from './map-check.mjs';
import { projectFiles } from './project-files.mjs';
import { settleState } from './state.mjs';

/**
 * Read and check map.json and candidates.json of `<out>`: `{ ok: true, map,
 * candidates }` (candidates: candidates.json's items) or `{ ok: false, lines }`.
 * Throws a UsageError for an out directory that does not exist. Changes no file.
 */
export function loadCheckedMap(outDir, root) {
  if (!existsSync(outDir)) throw new UsageError(`out directory ${outDir} does not exist`);
  const candidates = loadCandidates(outDir, root);
  if (!candidates.ok) return { ok: false, lines: candidates.problems };
  const read = readMap(outDir);
  if (!read.ok) return { ok: false, lines: [read.line] };
  const map = read.value;
  const gate = languageGate(outDir, map);
  if (!gate.ok) return { ok: false, lines: gate.lines };
  const { problems } = mapProblems(map, { candidates: candidates.items, files: projectFiles(root), memberDirs: memberDirectories(root), languageCheck: gate.check });
  return problems.length > 0 ? { ok: false, lines: problems } : { ok: true, map, candidates: candidates.items };
}

/** Returns { status, lines }. */
export function checkMap(outDir, root) {
  const loaded = loadCheckedMap(outDir, root);
  if (!loaded.ok) return { status: 1, lines: loaded.lines };
  const { map, candidates } = loaded;
  const stateProblems = settleState(outDir, map.features.map((feature) => feature.id));
  if (stateProblems.length > 0) return { status: 1, lines: stateProblems };
  const unassigned = map.unassigned.length;
  return {
    status: 0,
    lines: [`map ok: ${map.areas.length} areas, ${map.features.length} features, ${candidates.length} candidates (${unassigned} unassigned)`],
  };
}
