/** `handbook.mjs check-map <out> --project <root>`: check map.json against candidates.json and the project, then settle state.json. */

import { existsSync } from 'node:fs';

import { memberDirectories } from './banned-words.mjs';
import { loadCandidates } from './candidates.mjs';
import { UsageError } from './errors.mjs';
import { mapProblems, readMap } from './map-check.mjs';
import { projectFiles } from './project-files.mjs';
import { settleState } from './state.mjs';

/** Returns { status, lines }. */
export function checkMap(outDir, root) {
  if (!existsSync(outDir)) throw new UsageError(`out directory ${outDir} does not exist`);
  const candidates = loadCandidates(outDir, root);
  if (!candidates.ok) return { status: 1, lines: candidates.problems };
  const read = readMap(outDir);
  if (!read.ok) return { status: 1, lines: [read.line] };
  const map = read.value;
  const { problems } = mapProblems(map, { candidates: candidates.items, files: projectFiles(root), memberDirs: memberDirectories(root) });
  if (problems.length > 0) return { status: 1, lines: problems };
  const stateProblems = settleState(outDir, map.features.map((feature) => feature.id));
  if (stateProblems.length > 0) return { status: 1, lines: stateProblems };
  const unassigned = map.unassigned.length;
  return {
    status: 0,
    lines: [`map ok: ${map.areas.length} areas, ${map.features.length} features, ${candidates.items.length} candidates (${unassigned} unassigned)`],
  };
}
