/**
 * `handbook.mjs assemble <out> --project <root>` (design D11): write
 * `<out>/handbook.md` from the map and the checked entries. The map and each
 * checked entry are checked again against the project first, so a run whose
 * files changed after their check is refused instead of assembled. Writes
 * nothing when anything fails.
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { memberDirectories } from './banned-words.mjs';
import { loadCandidates } from './candidates.mjs';
import { checkEntryFile, entryPath } from './entry-check.mjs';
import { UsageError } from './errors.mjs';
import { readJson, writeTextAtomic } from './json-file.mjs';
import { mapProblems, readMap } from './map-check.mjs';
import { projectFiles } from './project-files.mjs';
import { renderHandbook } from './render.mjs';
import { loadState } from './state.mjs';
import { loadUi } from './ui.mjs';

export const HANDBOOK_FILE = 'handbook.md';

/** Returns { status, lines }; on success the one line is the path written. */
export function assemble(outDirArg, root) {
  const outDir = resolve(outDirArg);
  if (!existsSync(outDir)) throw new UsageError(`out directory ${outDir} does not exist`);
  const candidates = loadCandidates(outDir, root);
  if (!candidates.ok) return { status: 1, lines: candidates.problems };
  const mapRead = readMap(outDir);
  if (!mapRead.ok) return { status: 1, lines: [mapRead.line] };
  const map = mapRead.value;
  const files = projectFiles(root);
  const memberDirs = memberDirectories(root);
  const mapChecked = mapProblems(map, { candidates: candidates.items, files, memberDirs });
  if (mapChecked.problems.length > 0) return { status: 1, lines: mapChecked.problems.map((line) => `map.json: ${line}`) };

  const loaded = loadState(outDir);
  if (!loaded.ok) {
    if (loaded.missing) throw new UsageError(loaded.problem);
    return { status: 1, lines: [loaded.problem] };
  }
  const { state } = loaded;
  const ids = map.features.map((feature) => feature.id);
  const recorded = Object.keys(state.features);
  if (recorded.length !== ids.length || ids.some((id) => state.features[id] === undefined)) {
    return { status: 1, lines: ['state.json lists different features than map.json; run check-map again (with --fresh when the map changed)'] };
  }

  const ui = loadUi(outDir);
  if (!ui.ok) return { status: 1, lines: ui.lines };

  const entries = new Map();
  const problems = [];
  for (const id of ids.filter((featureId) => state.features[featureId].status === 'checked')) {
    const result = checkEntryFile(outDir, id, root, { map, mapLabels: mapChecked.verified, files, memberDirs });
    if (result.problems.length > 0) {
      problems.push(...result.problems.map((line) => (line.startsWith(`${id}:`) ? line : `${id}: ${line}`)), `${id}: ${entryPath(id)} no longer passes check-entry; run check-entry for ${id}`);
    } else {
      entries.set(id, readJson(join(outDir, entryPath(id))).value);
    }
  }
  if (problems.length > 0) return { status: 1, lines: problems };

  const path = join(outDir, HANDBOOK_FILE);
  writeTextAtomic(path, renderHandbook({ map, entries, state, candidates: candidates.items, ui: ui.strings }));
  return { status: 0, lines: [path] };
}
