/**
 * The sources and scope part of the appendix (openspec change
 * handbook-history-appendix, design D3): what each section of the run wrote and
 * what the checks left of it, counted from state.json, its removal records and the
 * verified files, never by a model. For each of the four sections that have units
 * (the overview, the feature entries, the findings of the features, the system
 * findings): the units, the units that are verified, the items kept in the
 * verified units (the items that carry a citation, which the verifiers judge), the
 * records of items the verifiers removed, the records of items the tracers removed
 * and the units written again (one for each lane run after the first; a rewrite of
 * the citations inside a run leaves no record and is not counted). For the ranking,
 * the remedies and the topics: what was kept and what the judges left out. Pure and
 * deterministic.
 */

import { findingsId } from './findings-shape.mjs';
import { systemUnitId } from './system-shape.mjs';
import { OVERVIEW_ID, unitFor } from './unit.mjs';

/** The items of a verified document that carry a citation: the ones a verifier judged. */
const keptItems = (id, doc) => unitFor(id).items(doc).filter((item) => item.evidence.length > 0).length;

/** The row of a section from its state entries (`[{ id, entry }]`, the state of each unit) and the verified documents (`Map` unit id -> file). */
function sectionRow(id, units, docs) {
  const entries = units.map((unit) => unit.entry);
  const removed = entries.flatMap((entry) => entry.removed ?? []);
  return {
    id,
    units: units.length,
    verified: units.filter((unit) => docs.has(unit.id)).length,
    items: units.reduce((sum, unit) => sum + (docs.has(unit.id) ? keptItems(unit.id, docs.get(unit.id)) : 0), 0),
    removedVerify: removed.filter((record) => record.step !== 'trace').length,
    removedTrace: removed.filter((record) => record.step === 'trace').length,
    again: entries.reduce((sum, entry) => sum + Math.max(0, (entry.attempts ?? 0) - 1), 0),
  };
}

const PLANNED = Object.freeze({ status: 'planned', attempts: 0 });

/**
 * `{ parts, ranked }` of a loaded run. `parts`: `[{ id, units, verified, items, removedVerify, removedTrace, again }]` for `overview`,
 * `features`, `findings` and `system-findings`; `ranked`: `{ priority, remedies, topics }`, each `{ kept, left }`. `applications` is the
 * number of application roots (one system findings unit each); `findings`, `remedies` and `topics` are the models the outputs share.
 */
export function buildSources(run, { applications, findings, remedies, topics }) {
  const { state, map } = run;
  const featureIds = map.features.map((feature) => feature.id);
  const featureUnits = featureIds.map((id) => ({ id, entry: state.features[id] }));
  const findingsUnits = featureIds.map((id) => ({ id: findingsId(id), entry: state.findings?.[id] ?? PLANNED }));
  const systemUnits = Array.from({ length: applications }, (_, index) => ({ id: systemUnitId(index + 1), entry: state.systemFindings?.[`app${index + 1}`] ?? PLANNED }));
  const findingDocs = new Map([...run.findings].map(([id, doc]) => [findingsId(id), doc]));
  const { counts } = findings.priority;
  return {
    parts: [
      sectionRow('overview', [{ id: OVERVIEW_ID, entry: state.overview ?? PLANNED }], new Map(run.entries.has(OVERVIEW_ID) ? [[OVERVIEW_ID, run.entries.get(OVERVIEW_ID)]] : [])),
      sectionRow('features', featureUnits, new Map([...run.entries].filter(([id]) => id !== OVERVIEW_ID && !run.chapters?.has(id)))),
      sectionRow('findings', findingsUnits, findingDocs),
      sectionRow('system-findings', systemUnits, run.systemFindings ?? new Map()),
    ],
    ranked: {
      priority: { kept: counts.P0 + counts.P1 + counts.P2, left: counts.unranked },
      remedies: { kept: remedies.categories.length + remedies.recommendations.length, left: remedies.dropped.length },
      topics: { kept: topics.rowsKept, left: topics.dropped.length },
    },
  };
}
