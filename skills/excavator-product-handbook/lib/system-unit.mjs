/**
 * What a system findings unit (system-shape.mjs) needs beyond a findings unit
 * (openspec change handbook-system-findings, design D2 to D4): the application
 * root it belongs to, recorded in its state entry, and the context its two extra
 * checks read. The commands that load a unit (entry-check.mjs) and `mark` call
 * these; the verification rules themselves stay in unit.mjs.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { loadCandidates } from './candidates.mjs';
import { FINDINGS_FORMAT } from './findings-shape.mjs';
import { writeJson } from './json-file.mjs';
import { applicationOf, seedFilesOf } from './system-seeds.mjs';
import { systemKey } from './system-shape.mjs';

const PLANNED = Object.freeze({ status: 'planned', attempts: 0 });

/**
 * A problem line when `state.json` records an application root for the unit that
 * is not the root at that place of the application list today (the source
 * changed: another application order means another unit), else null.
 */
export function rootProblem(state, id, appDir) {
  const recorded = state.systemFindings?.[systemKey(id)]?.root;
  if (recorded === undefined || recorded === appDir) return null;
  return `${id}: state.json records the application root ${JSON.stringify(recorded)} for ${systemKey(id)}, but the root at that place of the application list is now ${JSON.stringify(appDir)}; the source changed, run again with --fresh`;
}

/**
 * Put the application root into the state entry of unit `id` (in memory; the
 * command that saves the state keeps it), creating a planned entry when there is
 * none and adding the root to one without. Returns the problem line of
 * `rootProblem` and changes nothing when the recorded root differs, else null.
 * A UsageError when the project has no such application.
 */
export function bindSystemRoot(state, id, projectRoot) {
  const { appDir } = applicationOf(projectRoot, id);
  const problem = rootProblem(state, id, appDir);
  if (problem !== null) return problem;
  const key = systemKey(id);
  const entry = state.systemFindings?.[key];
  if (entry === undefined || entry.root === undefined) state.systemFindings = { ...state.systemFindings, [key]: { ...(entry ?? PLANNED), root: appDir } };
  return null;
}

/**
 * The context of the two extra checks of unit `id`: `{ appDir, seeds }`, or
 * `{ stop }` with the lines of a candidates.json that cannot be read (candidates
 * come from the run's own file, like the map's conservation check).
 */
export function systemContext(outDir, projectRoot, id) {
  const { appDir } = applicationOf(projectRoot, id);
  const candidates = loadCandidates(outDir, projectRoot);
  if (!candidates.ok) return { stop: { status: 1, lines: candidates.problems } };
  return { appDir, seeds: new Set(seedFilesOf(candidates.items, appDir)) };
}

/**
 * An application with no seed file has nothing to read and no lane: when its
 * file does not exist, write the empty findings file, so check-system-findings
 * records the unit verified with none, like an empty list from a lane.
 */
export function writeEmptyWhenNoSeeds(outDir, id, system, path) {
  if (system.seeds.size > 0 || existsSync(join(outDir, path))) return;
  writeJson(join(outDir, path), { format: FINDINGS_FORMAT, id, findings: [], unknowns: [] });
}
