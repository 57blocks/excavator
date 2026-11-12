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
 * try-overview) and the findings of a feature (check-findings and
 * try-findings, the id `<featureId>.findings`): the unit of the id (unit.mjs)
 * decides what is checked. A findings file with no finding has nothing to
 * prove, so it is recorded as verified at once. The system findings of an
 * application root (check-system-findings and try-system-findings, the id
 * `app<n>.system`, openspec change handbook-system-findings) are checked the
 * same way with the application's context (system-unit.mjs); an application with
 * no seed file has its empty file written here and is verified at once.
 * A /3 entry (the fact sheet, openspec change handbook-free-chapter) is checked
 * together with its chapter, chapters/<id>.md: either failing fails the entry with
 * every line of both, and the checked state keeps the chapter's items with the
 * text of the lines each citation names (`chapter: { items, notes }`), so a later step can
 * tell that the source changed since.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { memberDirectories } from './banned-words.mjs';
import { countsLine, notesLine } from './chapter-check.mjs';
import { checkChapterFile } from './chapter-file.mjs';
import { ENTRY_FORMAT_V3 } from './entry-shape.mjs';
import { UsageError } from './errors.mjs';
import { adviceWordsOf } from './findings-check.mjs';
import { readJson } from './json-file.mjs';
import { languageGate } from './language-check.mjs';
import { mapVerifiedLabels, readMap } from './map-check.mjs';
import { projectFiles } from './project-files.mjs';
import { entryDigest, loadState, nextLine, rewriteNextLine, saveState } from './state.mjs';
import { bindSystemRoot, rootProblem, systemContext, writeEmptyWhenNoSeeds } from './system-unit.mjs';
import { loadUi } from './ui.mjs';
import { featureOfFindings, isFindingsId, isOverview, isSystemId, setUnitState, unitFor, unitState } from './unit.mjs';

export const entryPath = (id) => `entries/${id}.json`;

/** The problems of `<out>/entries/<id>.json`, or the single missing-file reason; no state is read or written. */
export function checkEntryFile(outDir, id, root, { map, mapLabels = null, files = projectFiles(root), memberDirs = memberDirectories(root), languageCheck = null, adviceWords = [], system = null }, { settled = false } = {}) {
  const file = join(outDir, entryPath(id));
  const labels = mapLabels ?? mapVerifiedLabels(map, { files, memberDirs }).verified;
  const read = readJson(file);
  if (read.missing) return { step: 'lane', problems: [`${id}: lane-wrote-nothing: ${entryPath(id)} is missing`] };
  if (!read.ok) return { step: 'check-entry', problems: [`${entryPath(id)} ${read.reason}`] };
  const unit = unitFor(id);
  const problems = unit.problems(read.value, id, { map, files, memberDirs, mapLabels: labels, languageCheck, adviceWords, system }, { settled });
  if (unit.kind !== 'feature' || read.value?.format !== ENTRY_FORMAT_V3) return { step: 'check-entry', problems };
  const chapter = checkChapterFile(outDir, id, { files, memberDirs, languageCheck });
  return {
    step: 'check-entry',
    problems: [...problems, ...chapter.problems],
    chapter: chapter.problems.length === 0 ? { items: chapter.items, notes: chapter.notes } : undefined,
    chapterLines: chapter.counts === null ? undefined : [countsLine(chapter.counts), ...chapter.noteLines, notesLine(chapter.notes)],
  };
}

/** The success lines of an entry: its state word, and the chapter's counts and notes for a /3 entry. */
const okLines = (head, result) => (result.chapterLines === undefined ? [head] : [head, ...result.chapterLines]);

/** The chapter of a checked /3 entry, as the state keeps it. */
const chapterState = (result) => (result.chapter === undefined ? {} : { chapter: result.chapter });

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
  const featureId = isFindingsId(id) ? featureOfFindings(id) : id;
  if (!isOverview(id) && !isSystemId(id) && !map.features.some((feature) => feature.id === featureId)) throw new UsageError(`feature ${featureId} is not in map.json`);
  const gate = languageGate(outDir, map);
  if (!gate.ok) return { stop: { status: 1, lines: gate.lines } };
  // A system unit belongs to the application root at its place of the application list; a state that
  // records another root for it is from other source. The state is read here only for that: a command
  // that needs it (check-system-findings) reads it again and reports a state it cannot read.
  let system = null;
  if (isSystemId(id)) {
    system = systemContext(outDir, root, id);
    if (system.stop) return { stop: system.stop };
    const stateRead = loadState(outDir);
    const problem = stateRead.ok ? rootProblem(stateRead.state, id, system.appDir) : null;
    if (problem !== null) return { stop: { status: 1, lines: [problem] } };
  }
  // The advice words are part of the run's fixed text, which only a findings unit reads.
  let adviceWords = [];
  if (isFindingsId(id) || isSystemId(id)) {
    const ui = loadUi(outDir);
    if (!ui.ok) return { stop: { status: 1, lines: ui.lines } };
    adviceWords = adviceWordsOf(ui.strings);
  }
  return { map, files, memberDirs, mapLabels: labels.verified, languageCheck: gate.check, adviceWords, system };
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
  if (isSystemId(id)) bindSystemRoot(state, id, root);
  const current = unitState(state, id);
  if (isSystemId(id)) writeEmptyWhenNoSeeds(outDir, id, loaded.system, entryPath(id));

  // A feature waiting for its one rewrite keeps what round 1 removed, and its entry has no purpose when round 1 removed it.
  const kept = current.rewriting && current.removed !== undefined ? { removed: current.removed } : {};
  // A verified or confirmed entry that is still the file that was settled is checked as load-run checks it (settled: true):
  // verification may have trimmed it, and a trimmed entry cannot pass the rules of a fresh one.
  const unchanged = ['verified', 'confirmed'].includes(current.status) && current.entryDigest !== undefined
    && existsSync(join(outDir, entryPath(id))) && entryDigest(join(outDir, entryPath(id))) === current.entryDigest;
  const result = checkEntryFile(outDir, id, root, loaded, { settled: unchanged || (current.rewriting === true && unit.settledAfter(current)) });
  if (unchanged && result.problems.length === 0) return { status: 0, lines: [`${id}: ${current.status}, unchanged since it was ${current.status}`] };
  if (result.problems.length === 0 && unit.mayBeEmpty && !current.rewriting && unit.items(readJson(join(outDir, entryPath(id))).value).every((item) => item.evidence.length === 0)) {
    // No finding: nothing to prove, so the verification steps have nothing to do with it.
    setUnitState(state, id, { status: 'verified', attempts: current.attempts, entryDigest: entryDigest(join(outDir, entryPath(id))) });
    saveState(outDir, state);
    return { status: 0, lines: [`${id}: verified (0 findings)`] };
  }
  if (result.problems.length === 0) {
    // A feature waiting for its one rewrite stays so; anything else starts over as checked (a verified one is no longer verified).
    setUnitState(state, id, current.rewriting ? { status: 'checked', attempts: current.attempts, rewriting: true, ...kept, ...chapterState(result) } : { status: 'checked', attempts: current.attempts, ...chapterState(result) });
    saveState(outDir, state);
    return { status: 0, lines: okLines(`${id}: checked`, result) };
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
  if (result.problems.length === 0) return { status: 0, lines: okLines(`${id}: ok`, result) };
  return { status: 1, lines: [...result.problems, `Next: fix each line above in ${entryPath(id)} and run ${unitFor(id).tryCommand} again`] };
}
