/**
 * check-entry (design D5 to D9): one entry file against the map and the
 * project: shape, id, roles from the map, citations, labels, numbers and the
 * banned-words gate and the narrative language check (language-check.mjs);
 * then the result goes into state.json. A missing entry file is
 * `lane-wrote-nothing`. try-entry runs the same checks for the lane itself
 * and records nothing. A feature waiting for its one rewrite (design D14)
 * that fails here is `failed` at step `rewrite`; there is no second rewrite.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { memberDirectories } from './banned-words.mjs';
import { entryShapeProblems } from './entry-shape.mjs';
import { UsageError } from './errors.mjs';
import { entryItems } from './items.mjs';
import { readJson } from './json-file.mjs';
import { languageGate } from './language-check.mjs';
import { mapVerifiedLabels, readMap } from './map-check.mjs';
import { projectFiles } from './project-files.mjs';
import { reviewItems } from './review.mjs';
import { featureState, loadState, nextLine, purposeRemoved, rewriteNextLine, saveState } from './state.mjs';

export const entryPath = (id) => `entries/${id}.json`;

/**
 * Every way a parsed entry fails, given the map's roles and map-wide verified
 * labels. `settled` is for an entry that verdicts round 2 has trimmed (design
 * D14): its purpose may be absent. A written entry (check-entry, try-entry)
 * is never settled, so its purpose stays required.
 */
export function entryProblems(entry, id, { map, files, memberDirs, mapLabels, languageCheck = null }, { settled = false } = {}) {
  const shape = entryShapeProblems(entry, { settled });
  if (shape.length > 0) return shape;
  const problems = [];
  if (entry.id !== id) problems.push(`id: ${JSON.stringify(entry.id)} is not ${JSON.stringify(id)}, the feature this entry is checked as`);
  const roles = map.roles.map((role) => role.label);
  entry.who.forEach((who, i) => {
    if (!roles.includes(who.role)) problems.push(`who[${i}].role: ${JSON.stringify(who.role)} is not a role in map.json (roles: ${roles.map((r) => JSON.stringify(r)).join(', ') || 'none'})`);
  });
  problems.push(...reviewItems(entryItems(entry), { files, memberDirs, exemptLabels: mapLabels, languageCheck }).problems);
  return problems;
}

/** The problems of `<out>/entries/<id>.json`, or the single missing-file reason; no state is read or written. */
export function checkEntryFile(outDir, id, root, { map, mapLabels = null, files = projectFiles(root), memberDirs = memberDirectories(root), languageCheck = null }, { settled = false } = {}) {
  const file = join(outDir, entryPath(id));
  const labels = mapLabels ?? mapVerifiedLabels(map, { files, memberDirs }).verified;
  const read = readJson(file);
  if (read.missing) return { step: 'lane', problems: [`${id}: lane-wrote-nothing: ${entryPath(id)} is missing`] };
  if (!read.ok) return { step: 'check-entry', problems: [`${entryPath(id)} ${read.reason}`] };
  return { step: 'check-entry', problems: entryProblems(read.value, id, { map, files, memberDirs, mapLabels: labels, languageCheck }, { settled }) };
}

/** The checked map and project facts check-entry and try-entry share, or the lines that stop them. */
export function loadForEntry(outDir, id, root) {
  if (!existsSync(outDir)) throw new UsageError(`out directory ${outDir} does not exist`);
  const mapRead = readMap(outDir);
  if (!mapRead.ok) return { stop: { status: 1, lines: [mapRead.line] } };
  const map = mapRead.value;
  const files = projectFiles(root);
  const memberDirs = memberDirectories(root);
  const labels = mapVerifiedLabels(map, { files, memberDirs });
  if (labels.shapeProblems.length > 0) return { stop: { status: 1, lines: [...labels.shapeProblems.map((line) => `map.json: ${line}`), 'map.json is malformed; run check-map first'] } };
  if (!map.features.some((feature) => feature.id === id)) throw new UsageError(`feature ${id} is not in map.json`);
  const gate = languageGate(outDir, map);
  if (!gate.ok) return { stop: { status: 1, lines: gate.lines } };
  return { map, files, memberDirs, mapLabels: labels.verified, languageCheck: gate.check };
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

  // A feature waiting for its one rewrite keeps what round 1 removed, and its entry has no purpose when round 1 removed it.
  const kept = current.rewriting && current.removed !== undefined ? { removed: current.removed } : {};
  const result = checkEntryFile(outDir, id, root, loaded, { settled: current.rewriting === true && purposeRemoved(current) });
  if (result.problems.length === 0) {
    // A feature waiting for its one rewrite stays so; anything else starts over as checked (a verified one is no longer verified).
    state.features[id] = current.rewriting ? { status: 'checked', attempts: current.attempts, rewriting: true, ...kept } : { status: 'checked', attempts: current.attempts };
    saveState(outDir, state);
    return { status: 0, lines: [`${id}: checked`] };
  }
  if (current.rewriting) {
    // The one rewrite (design D14) did not pass: there is no second one.
    state.features[id] = { status: 'failed', attempts: current.attempts, failure: { step: 'rewrite', reasons: result.problems }, ...kept };
    saveState(outDir, state);
    return { status: 1, lines: [...result.problems, rewriteNextLine(id)] };
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
