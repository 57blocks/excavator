/**
 * check-entry (design D5 to D9): one entry file against the map and the
 * project: shape, id, roles from the map, citations, labels, numbers and the
 * banned-words gate; then the result goes into state.json. A missing entry
 * file is `lane-wrote-nothing`. try-entry runs the same checks for the lane
 * itself and records nothing.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { memberDirectories } from './banned-words.mjs';
import { entryShapeProblems } from './entry-shape.mjs';
import { UsageError } from './errors.mjs';
import { entryItems } from './items.mjs';
import { readJson } from './json-file.mjs';
import { mapVerifiedLabels, readMap } from './map-check.mjs';
import { projectFiles } from './project-files.mjs';
import { reviewItems } from './review.mjs';
import { featureState, loadState, nextLine, saveState } from './state.mjs';

export const entryPath = (id) => `entries/${id}.json`;

/** Every way a parsed entry fails, given the map's roles and map-wide verified labels. */
export function entryProblems(entry, id, { map, files, memberDirs, mapLabels }) {
  const shape = entryShapeProblems(entry);
  if (shape.length > 0) return shape;
  const problems = [];
  if (entry.id !== id) problems.push(`id: ${JSON.stringify(entry.id)} is not ${JSON.stringify(id)}, the feature this entry is checked as`);
  const roles = map.roles.map((role) => role.label);
  entry.who.forEach((who, i) => {
    if (!roles.includes(who.role)) problems.push(`who[${i}].role: ${JSON.stringify(who.role)} is not a role in map.json (roles: ${roles.map((r) => JSON.stringify(r)).join(', ') || 'none'})`);
  });
  problems.push(...reviewItems(entryItems(entry), { files, memberDirs, exemptLabels: mapLabels }).problems);
  return problems;
}

/** The problems of `<out>/entries/<id>.json`, or the single missing-file reason; no state is read or written. */
export function checkEntryFile(outDir, id, root, { map, mapLabels = null, files = projectFiles(root), memberDirs = memberDirectories(root) }) {
  const file = join(outDir, entryPath(id));
  const labels = mapLabels ?? mapVerifiedLabels(map, { files, memberDirs }).verified;
  const read = readJson(file);
  if (read.missing) return { step: 'lane', problems: [`${id}: lane-wrote-nothing: ${entryPath(id)} is missing`] };
  if (!read.ok) return { step: 'check-entry', problems: [`${entryPath(id)} ${read.reason}`] };
  return { step: 'check-entry', problems: entryProblems(read.value, id, { map, files, memberDirs, mapLabels: labels }) };
}

/** The checked map and project facts check-entry and try-entry share, or the lines that stop them. */
function loadForEntry(outDir, id, root) {
  if (!existsSync(outDir)) throw new UsageError(`out directory ${outDir} does not exist`);
  const mapRead = readMap(outDir);
  if (!mapRead.ok) return { stop: { status: 1, lines: [mapRead.line] } };
  const map = mapRead.value;
  const files = projectFiles(root);
  const memberDirs = memberDirectories(root);
  const labels = mapVerifiedLabels(map, { files, memberDirs });
  if (labels.shapeProblems.length > 0) return { stop: { status: 1, lines: [...labels.shapeProblems.map((line) => `map.json: ${line}`), 'map.json is malformed; run check-map first'] } };
  if (!map.features.some((feature) => feature.id === id)) throw new UsageError(`feature ${id} is not in map.json`);
  return { map, files, memberDirs, mapLabels: labels.verified };
}

/** Run check-entry for feature `id` of `<out>` and record the result. Returns { status, lines }. */
export function checkEntry(outDir, id, root) {
  const loaded = loadForEntry(outDir, id, root);
  if (loaded.stop) return loaded.stop;
  const stateRead = loadState(outDir);
  if (!stateRead.ok) {
    if (stateRead.missing) throw new UsageError(stateRead.problem);
    return { status: 1, lines: [stateRead.problem] };
  }
  const { state } = stateRead;
  const current = featureState(state, id);

  const result = checkEntryFile(outDir, id, root, loaded);
  if (result.problems.length === 0) {
    state.features[id] = { status: 'checked', attempts: current.attempts };
    saveState(outDir, state);
    return { status: 0, lines: [`${id}: checked`] };
  }
  state.features[id] = { status: 'failed', attempts: current.attempts, failure: { step: result.step, reasons: result.problems } };
  saveState(outDir, state);
  return { status: 1, lines: [...result.problems, nextLine(id, current.attempts)] };
}

/**
 * The same checks as check-entry for a lane to run on its own file before it
 * replies; reads and writes no state, so it neither counts as an attempt nor
 * records a result. Returns { status, lines }.
 */
export function tryEntry(outDir, id, root) {
  const loaded = loadForEntry(outDir, id, root);
  if (loaded.stop) return loaded.stop;
  const result = checkEntryFile(outDir, id, root, loaded);
  if (result.problems.length === 0) return { status: 0, lines: [`${id}: ok`] };
  return { status: 1, lines: [...result.problems, `Next: fix each line above in ${entryPath(id)} and run try-entry again`] };
}
