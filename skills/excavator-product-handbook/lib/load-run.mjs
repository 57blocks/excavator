/**
 * The checked state of a handbook run, loaded for an output (design D11,
 * D13): the candidates, the map, the state, the fixed-text table and every
 * verified entry. The map and each verified entry are checked again against the
 * project, so a run whose files changed after their check is refused instead
 * of written out; a verified entry must also still be the file the verifiers
 * and the tracers saw (its digest in state.json), and a confirmed one (settled
 * by the verifiers, not yet traced) is checked the same way. Only a verified
 * feature has an entry in the output; a confirmed or checked one has none. The system
 * overview is one more unit of the same kind: its entry is in `entries` under
 * the key `overview` once it is verified. So are the findings of each feature
 * (openspec change handbook-feature-findings): the unit `<featureId>.findings`,
 * checked the same way, with its file in `findings` under the feature's id once
 * it is verified, whatever the state of the feature's own entry. So are the system
 * findings of each application root (openspec change handbook-system-findings):
 * the unit `app<n>.system`, with its file in `systemFindings` under that id. `assemble` and
 * `page` both start here, so they refuse the same runs.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { memberDirectories } from './banned-words.mjs';
import { loadCandidates } from './candidates.mjs';
import { loadDomains } from './domains-check.mjs';
import { chapterPath } from './chapter-file.mjs';
import { loadDomainFlows } from './domain-flows-check.mjs';
import { checkEntryFile, entryPath } from './entry-check.mjs';
import { adviceWordsOf } from './findings-check.mjs';
import { findingsId } from './findings-shape.mjs';
import { UsageError } from './errors.mjs';
import { readJson } from './json-file.mjs';
import { languageGate } from './language-check.mjs';
import { mapProblems, readMap } from './map-check.mjs';
import { loadPriority } from './priority-state.mjs';
import { loadRemedies } from './remedies-state.mjs';
import { loadTopics } from './topics-state.mjs';
import { projectFiles } from './project-files.mjs';
import { entryDigest, loadState } from './state.mjs';
import { loadSystemContext } from './system-unit.mjs';
import { loadUi } from './ui.mjs';
import { OVERVIEW_ID, featureOfFindings, isFindingsId, isSystemId, unitFor, unitState } from './unit.mjs';

/**
 * Returns `{ ok: true, outDir, map, domains, entries, chapters, findings, systemFindings, state, candidates, ui }` (findings:
 * feature id -> the findings file of each verified findings unit; systemFindings: unit id `app<n>.system` -> the file of each verified system unit; domains: the
 * business domains of domains.json when it passes check-domains, null otherwise, which
 * groups the outputs by the map's areas instead; entries:
 * id -> entry of each verified feature, and of the overview under `overview`, and of each checked /3 feature (not verified; `chapters`: id -> `{ text, items, notes }` of exactly those); domainFlows: `{ status: 'none' | 'failed' }` or `{ status: 'checked', models }` (domain-flows-check.mjs); candidates: candidates.json's items;
 * ui: the strings table; priority: `{ status, doc, unranked }` of the ranking of the findings (priority-state.mjs); remedies: `{ status, doc, dropped, factsDigest }` of the remedies (remedies-state.mjs); topics: `{ lanes }` of the topics lanes (topics-state.mjs); check: the facts a check of reader text needs,
 * `{ files, memberDirs, languageCheck, mapLabels }`) or `{ ok: false, lines }` with every reason. Throws a
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

  // A missing domains file, or one that does not pass its check, groups the outputs by the map's areas (domain-grouping.mjs).
  const domains = loadDomains(outDir, { map, files, memberDirs, languageCheck });

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

  // Only a verified feature reaches the output (design D14), but a confirmed one (settled by the verifiers, not yet traced)
  // is checked the same way: its entry is checked again, and must be the file that was verified or confirmed.
  const entries = new Map();
  const findings = new Map();
  const systemFindings = new Map();
  const problems = [];
  const adviceWords = adviceWordsOf(ui.strings);
  const systemIds = Object.keys(state.systemFindings ?? {}).map((key) => `${key}.system`);
  const settled = [...ids, OVERVIEW_ID, ...ids.map(findingsId), ...systemIds].filter((unitId) => ['confirmed', 'verified'].includes(unitState(state, unitId).status));
  for (const id of settled) {
    const current = unitState(state, id);
    // A system unit is checked with its application (and refused when the state records another root for it).
    let system = null;
    if (isSystemId(id)) {
      const loaded = loadSystemContext(outDir, root, id, state);
      if (loaded.problems) {
        problems.push(...loaded.problems.map((line) => (line.startsWith(`${id}:`) ? line : `${id}: ${line}`)));
        continue;
      }
      system = loaded.system;
    }
    const result = checkEntryFile(outDir, id, root, { map, mapLabels: mapChecked.verified, files, memberDirs, languageCheck, adviceWords, system }, { settled: true });
    if (result.problems.length > 0) {
      problems.push(...result.problems.map((line) => (line.startsWith(`${id}:`) ? line : `${id}: ${line}`)), `${id}: ${entryPath(id)} no longer passes ${unitFor(id).command}; ${unitFor(id).recheck(id)}`);
    } else if (entryDigest(join(outDir, entryPath(id))) !== current.entryDigest) {
      const was = current.status === 'confirmed' ? 'confirmed' : 'verified';
      problems.push(`${id}: ${entryPath(id)} changed after it was ${was}; ${unitFor(id).recheck(id)} and verify it again`);
    } else if (current.status === 'verified') {
      const doc = readJson(join(outDir, entryPath(id))).value;
      if (isSystemId(id)) systemFindings.set(id, doc);
      else if (isFindingsId(id)) findings.set(featureOfFindings(id), doc);
      else entries.set(id, doc);
    }
  }
  // A checked /3 entry (openspec change handbook-free-chapter D0) is not verified, and goes into the output marked as such: its fact
  // sheet and its chapter are checked again against the project, and what the check reports now (not what state.json kept) is what is written.
  const chapters = new Map();
  for (const id of ids) {
    const current = state.features[id];
    if (current.status !== 'checked' || current.chapter === undefined || current.rewriting) continue;
    const result = checkEntryFile(outDir, id, root, { map, mapLabels: mapChecked.verified, files, memberDirs, languageCheck, adviceWords });
    if (result.problems.length > 0 || result.chapter === undefined) {
      problems.push(...result.problems.map((line) => (line.startsWith(`${id}:`) ? line : `${id}: ${line}`)), `${id}: ${entryPath(id)} or ${chapterPath(id)} no longer passes check-entry; run check-entry for ${id}`);
      continue;
    }
    entries.set(id, readJson(join(outDir, entryPath(id))).value);
    chapters.set(id, { text: readFileSync(join(outDir, chapterPath(id)), 'utf-8'), items: result.chapter.items, notes: result.chapter.notes });
  }
  if (problems.length > 0) return { ok: false, lines: problems };
  // The domain flow diagrams (openspec change handbook-free-chapter) are checked again against the entries as they are now, and never a reason to refuse a run: one that no longer passes reads as failed.
  const domainFlows = loadDomainFlows(outDir, state, { map, domains: domains.doc, entries, chapters });
  // The ranking of the findings (openspec change handbook-findings-priority) is never a reason to refuse a run: a ranking that is not verified, or whose file is not the one the judges saw, is no ranking.
  const priority = loadPriority(outDir, state);
  // The remedies (openspec change handbook-remedies) are the same: never a reason to refuse a run; whether they are for the current facts is decided where the facts are built (remedies-model.mjs).
  const remedies = loadRemedies(outDir, state);
  // The topics (openspec change handbook-topics) are the same: never a reason to refuse a run; each lane is current only for the facts it was written for (topics-model.mjs).
  const topics = loadTopics(outDir, state);
  const check = { files, memberDirs, languageCheck, mapLabels: mapChecked.verified };
  return { ok: true, outDir, map, domains: domains.doc, entries, chapters, domainFlows, findings, systemFindings, priority, remedies, topics, check, state, candidates: candidates.items, ui: ui.strings };
}
