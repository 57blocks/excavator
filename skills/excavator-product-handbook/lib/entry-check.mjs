/**
 * check-entry (design D5 to D9): one entry file against the map and the
 * project: shape, id, roles from the map, citations, labels, numbers and the
 * banned-words gate and the narrative language check (language-check.mjs);
 * then the result goes into state.json. A missing entry file is
 * `lane-wrote-nothing`. try-entry runs the same checks for the lane itself
 * and records nothing. A feature waiting for its one rewrite (design D14)
 * that fails here is `failed` at step `rewrite`; there is no second rewrite.
 * A verified or confirmed entry whose file is still the one that was settled is
 * checked as load-run checks it and stays as it is; a changed file starts over.
 * The same functions check the system overview (check-overview and
 * try-overview): the unit of the id (unit.mjs) decides what is checked.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { memberDirectories } from './banned-words.mjs';
import { UsageError } from './errors.mjs';
import { readJson } from './json-file.mjs';
import { languageGate } from './language-check.mjs';
import { mapVerifiedLabels, readMap } from './map-check.mjs';
import { projectFiles } from './project-files.mjs';
import { entryDigest, loadState, nextLine, rewriteNextLine, saveState } from './state.mjs';
import { isOverview, setUnitState, unitFor, unitState } from './unit.mjs';

export const entryPath = (id) => `entries/${id}.json`;

/** The problems of `<out>/entries/<id>.json`, or the single missing-file reason; no state is read or written. */
export function checkEntryFile(outDir, id, root, { map, mapLabels = null, files = projectFiles(root), memberDirs = memberDirectories(root), languageCheck = null }, { settled = false } = {}) {
  const file = join(outDir, entryPath(id));
  const labels = mapLabels ?? mapVerifiedLabels(map, { files, memberDirs }).verified;
  const read = readJson(file);
  if (read.missing) return { step: 'lane', problems: [`${id}: lane-wrote-nothing: ${entryPath(id)} is missing`] };
  if (!read.ok) return { step: 'check-entry', problems: [`${entryPath(id)} ${read.reason}`] };
  return { step: 'check-entry', problems: unitFor(id).problems(read.value, id, { map, files, memberDirs, mapLabels: labels, languageCheck }, { settled }) };
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
  if (!isOverview(id) && !map.features.some((feature) => feature.id === id)) throw new UsageError(`feature ${id} is not in map.json`);
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
  const unit = unitFor(id);
  const current = unitState(state, id);

  // A feature waiting for its one rewrite keeps what round 1 removed, and its entry has no purpose when round 1 removed it.
  const kept = current.rewriting && current.removed !== undefined ? { removed: current.removed } : {};
  // A verified or confirmed entry that is still the file that was settled is checked as load-run checks it (settled: true):
  // verification may have trimmed it, and a trimmed entry cannot pass the rules of a fresh one.
  const unchanged = ['verified', 'confirmed'].includes(current.status) && current.entryDigest !== undefined
    && existsSync(join(outDir, entryPath(id))) && entryDigest(join(outDir, entryPath(id))) === current.entryDigest;
  const result = checkEntryFile(outDir, id, root, loaded, { settled: unchanged || (current.rewriting === true && unit.settledAfter(current)) });
  if (unchanged && result.problems.length === 0) return { status: 0, lines: [`${id}: ${current.status}, unchanged since it was ${current.status}`] };
  if (result.problems.length === 0) {
    // A feature waiting for its one rewrite stays so; anything else starts over as checked (a verified one is no longer verified).
    setUnitState(state, id, current.rewriting ? { status: 'checked', attempts: current.attempts, rewriting: true, ...kept } : { status: 'checked', attempts: current.attempts });
    saveState(outDir, state);
    return { status: 0, lines: [`${id}: checked`] };
  }
  if (current.rewriting) {
    // The one rewrite (design D14) did not pass: there is no second one.
    setUnitState(state, id, { status: 'failed', attempts: current.attempts, failure: { step: 'rewrite', reasons: result.problems }, ...kept });
    saveState(outDir, state);
    return { status: 1, lines: [...result.problems, rewriteNextLine(id)] };
  }
  setUnitState(state, id, { status: 'failed', attempts: current.attempts, failure: { step: result.step, reasons: result.problems } });
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
  return { status: 1, lines: [...result.problems, `Next: fix each line above in ${entryPath(id)} and run ${unitFor(id).tryCommand} again`] };
}
