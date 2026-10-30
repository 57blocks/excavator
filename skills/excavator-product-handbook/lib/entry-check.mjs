/**
 * check-entry (design D5 to D9): one entry file against the map and the
 * project: shape, id, roles from the map, citations, labels, numbers and the
 * banned-words gate; then the result goes into state.json. A missing entry
 * file is `lane-wrote-nothing`.
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

/** Run check-entry for feature `id` of `<out>` and record the result. Returns { status, lines }. */
export function checkEntry(outDir, id, root) {
  if (!existsSync(outDir)) throw new UsageError(`out directory ${outDir} does not exist`);
  const mapRead = readMap(outDir);
  if (!mapRead.ok) return { status: 1, lines: [mapRead.line] };
  const map = mapRead.value;
  const loaded = loadState(outDir);
  if (!loaded.ok) {
    if (loaded.missing) throw new UsageError(loaded.problem);
    return { status: 1, lines: [loaded.problem] };
  }
  const files = projectFiles(root);
  const memberDirs = memberDirectories(root);
  const labels = mapVerifiedLabels(map, { files, memberDirs });
  if (labels.shapeProblems.length > 0) return { status: 1, lines: [...labels.shapeProblems.map((line) => `map.json: ${line}`), 'map.json is malformed; run check-map first'] };
  if (!map.features.some((feature) => feature.id === id)) throw new UsageError(`feature ${id} is not in map.json`);
  const { state } = loaded;
  const current = featureState(state, id);

  const result = checkEntryFile(outDir, id, root, { map, mapLabels: labels.verified, files, memberDirs });
  if (result.problems.length === 0) {
    state.features[id] = { status: 'checked', attempts: current.attempts };
    saveState(outDir, state);
    return { status: 0, lines: [`${id}: checked`] };
  }
  state.features[id] = { status: 'failed', attempts: current.attempts, failure: { step: result.step, reasons: result.problems } };
  saveState(outDir, state);
  return { status: 1, lines: [...result.problems, nextLine(id, current.attempts)] };
}
