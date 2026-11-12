/**
 * The unit a verification command works on (openspec changes
 * handbook-system-overview and handbook-feature-findings): a feature of the
 * map, the system overview, whose id is `overview`, or the findings of a
 * feature, whose id is `<featureId>.findings`, or the system findings of an
 * application root (openspec change handbook-system-findings), whose id is
 * `app<n>.system`. The id `priority` is the ranking of the findings, whose state is
 * kept by `mark` through here and whose checks are in priority-*.mjs; the id `remedies` is the
 * causes, measures and recommendations of the findings (checks in remedies-*.mjs); an id `topics:<lane>` is a lane of the cross-cutting topics, kept under `state.topics` (checks in topics-*.mjs). The slices, verdicts, trace,
 * trace-verdicts, mark and check commands go through the unit for everything
 * that differs: the shape, the items and claims, the trim, the checks and where
 * the state is kept. The verification rules themselves are written once.
 *
 * A feature's state is `state.features[id]`; the overview's is
 * `state.overview` and the findings' `state.findings[featureId]`, optional
 * keys whose absence means planned with no attempt, so an output directory from
 * before them needs no migration. The system findings' is
 * `state.systemFindings[app<n>]`, which also records the application `root`.
 */

import { entryShapeProblems } from './entry-shape.mjs';
import { UsageError } from './errors.mjs';
import { entryProblems } from './feature-check.mjs';
import { entryItems } from './items.mjs';
import { itemClaims } from './claims.mjs';
import { findingsProblems } from './findings-check.mjs';
import { findingScopeWords, findingsClaims, findingsItems, systemFindingsClaims, trimFindings } from './findings-items.mjs';
import { featureOfFindings, findingsShapeProblems, isFindingsId } from './findings-shape.mjs';
import { overviewProblems } from './overview-check.mjs';
import { overviewClaims, overviewItems, trimOverview } from './overview-items.mjs';
import { OVERVIEW_ID, overviewShapeProblems } from './overview-shape.mjs';
import { PRIORITY_ID } from './priority-shape.mjs';
import { REMEDIES_ID } from './remedies-shape.mjs';
import { isLaneUnitId, laneOfUnitId } from './topics-shape.mjs';
import { purposeRemoved } from './state.mjs';
import { systemFindingsProblems } from './system-check.mjs';
import { isSystemId, systemKey } from './system-shape.mjs';
import { trimEntry } from './trim-entry.mjs';

export { OVERVIEW_ID, featureOfFindings, isFindingsId, isSystemId };
export const isOverview = (id) => id === OVERVIEW_ID;
export const isPriority = (id) => id === PRIORITY_ID;
export const isRemedies = (id) => id === REMEDIES_ID;
export { isLaneUnitId as isTopics };

const FEATURE = Object.freeze({
  kind: 'feature',
  shapeProblems: entryShapeProblems,
  items: entryItems,
  claims: itemClaims,
  trim: trimEntry,
  problems: entryProblems,
  /** Whether what the earlier step removed makes the entry a settled one (its parts may be absent). */
  settledAfter: purposeRemoved,
  command: 'check-entry',
  recheck: (id) => `run check-entry for ${id}`,
  tryCommand: 'try-entry',
});

const OVERVIEW = Object.freeze({
  kind: 'overview',
  shapeProblems: overviewShapeProblems,
  items: overviewItems,
  claims: overviewClaims,
  trim: trimOverview,
  problems: (doc, id, ctx, options) => overviewProblems(doc, ctx, options),
  settledAfter: (record) => (record.removed ?? []).length > 0,
  command: 'check-overview',
  recheck: () => 'run check-overview',
  tryCommand: 'try-overview',
});

const FINDINGS = Object.freeze({
  kind: 'findings',
  shapeProblems: findingsShapeProblems,
  items: findingsItems,
  claims: findingsClaims,
  trim: trimFindings,
  /** The scope words of the statement of the item `path` (design D9): its trace item carries them. */
  scopeWords: findingScopeWords,
  problems: (doc, id, ctx) => findingsProblems(doc, id, ctx),
  settledAfter: () => true,
  /** A unit may hold no finding, and one that lost every finding to verification is still verified, with none. */
  mayBeEmpty: true,
  command: 'check-findings',
  recheck: (id) => `run check-findings for ${id}`,
  tryCommand: 'try-findings',
});

/** The system findings of an application root: a findings unit with its own claim word and its two extra checks (system-check.mjs). */
const SYSTEM = Object.freeze({
  ...FINDINGS,
  kind: 'system-findings',
  claims: systemFindingsClaims,
  problems: (doc, id, ctx) => systemFindingsProblems(doc, id, ctx),
  command: 'check-system-findings',
  recheck: (id) => `run check-system-findings for ${id}`,
  tryCommand: 'try-system-findings',
});

/** The unit of `id`. */
export const unitFor = (id) => (isOverview(id) ? OVERVIEW : isSystemId(id) ? SYSTEM : isFindingsId(id) ? FINDINGS : FEATURE);

const PLANNED = Object.freeze({ status: 'planned', attempts: 0 });

/** The state entry of unit `id`: a feature must be in state.json; the overview and the findings of a feature are planned until they have an entry. */
export function unitState(state, id) {
  if (isOverview(id)) return state.overview ?? { ...PLANNED };
  if (isPriority(id)) return state.priority ?? { ...PLANNED };
  if (isRemedies(id)) return state.remedies ?? { ...PLANNED };
  if (isLaneUnitId(id)) return state.topics?.[laneOfUnitId(id)] ?? { ...PLANNED };
  if (isSystemId(id)) return state.systemFindings?.[systemKey(id)] ?? { ...PLANNED };
  if (isFindingsId(id)) {
    const featureId = featureOfFindings(id);
    if (state.features[featureId] === undefined) throw new UsageError(`feature ${featureId} is not in state.json; run check-map first`);
    return state.findings?.[featureId] ?? { ...PLANNED };
  }
  const entry = state.features[id];
  if (entry === undefined) throw new UsageError(`feature ${id} is not in state.json; run check-map first`);
  return entry;
}

/** Write `value` as the state entry of unit `id`. */
export function setUnitState(state, id, value) {
  if (isOverview(id)) state.overview = value;
  else if (isPriority(id)) state.priority = value;
  else if (isRemedies(id)) state.remedies = value;
  else if (isLaneUnitId(id)) state.topics = { ...state.topics, [laneOfUnitId(id)]: value };
  else if (isSystemId(id)) {
    // The application root recorded for the unit stays through every change of its entry.
    const root = state.systemFindings?.[systemKey(id)]?.root;
    state.systemFindings = { ...state.systemFindings, [systemKey(id)]: root !== undefined && value.root === undefined ? { ...value, root } : value };
  } else if (isFindingsId(id)) state.findings = { ...state.findings, [featureOfFindings(id)]: value };
  else state.features[id] = value;
}
