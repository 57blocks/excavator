/**
 * The unit a verification command works on (openspec change
 * handbook-system-overview): a feature of the map, or the system overview,
 * whose id is `overview`. The slices, verdicts, trace, trace-verdicts, mark and
 * check commands go through the unit for everything that differs: the shape,
 * the items and claims, the trim, the checks and where the state is kept. The
 * verification rules themselves are written once.
 *
 * A feature's state is `state.features[id]`; the overview's is
 * `state.overview`, an optional key whose absence means planned with no
 * attempt, so an output directory from before the overview needs no migration.
 */

import { entryShapeProblems } from './entry-shape.mjs';
import { UsageError } from './errors.mjs';
import { entryProblems } from './feature-check.mjs';
import { entryItems } from './items.mjs';
import { itemClaims } from './claims.mjs';
import { overviewProblems } from './overview-check.mjs';
import { overviewClaims, overviewItems, trimOverview } from './overview-items.mjs';
import { OVERVIEW_ID, overviewShapeProblems } from './overview-shape.mjs';
import { purposeRemoved } from './state.mjs';
import { trimEntry } from './trim-entry.mjs';

export { OVERVIEW_ID };
export const isOverview = (id) => id === OVERVIEW_ID;

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

/** The unit of `id`. */
export const unitFor = (id) => (isOverview(id) ? OVERVIEW : FEATURE);

const PLANNED = Object.freeze({ status: 'planned', attempts: 0 });

/** The state entry of unit `id`: a feature must be in state.json; the overview is planned until it has an entry. */
export function unitState(state, id) {
  if (isOverview(id)) return state.overview ?? { ...PLANNED };
  const entry = state.features[id];
  if (entry === undefined) throw new UsageError(`feature ${id} is not in state.json; run check-map first`);
  return entry;
}

/** Write `value` as the state entry of unit `id`. */
export function setUnitState(state, id, value) {
  if (isOverview(id)) state.overview = value;
  else state.features[id] = value;
}
