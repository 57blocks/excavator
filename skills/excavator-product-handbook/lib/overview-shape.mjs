/**
 * The shape of `<out>/entries/overview.json` (openspec change
 * handbook-system-overview): exact keys and types, nothing about whether the
 * values are true. A written overview has one to three summary items and at
 * least one application; an overview settled by the verification steps may
 * have lost all of them (an item that is not verified is removed, as a feature
 * entry may lose its purpose), so `settled` allows empty arrays there.
 */

import { evidenceList } from './map-shape.mjs';
import { arrayOf, literal, nonEmptyString, objectOf, shapeProblems } from './schema.mjs';

export const OVERVIEW_FORMAT = 'excavator-product-handbook-overview/1';
/** The id of the system overview as a unit; no feature of a map may have it (check-map). */
export const OVERVIEW_ID = 'overview';
/** At most this many summary items: what the system is and does, in one to three sentences. */
export const SUMMARY_MAX = 3;

const overviewSchema = (settled) => objectOf({
  format: literal(OVERVIEW_FORMAT),
  id: literal(OVERVIEW_ID),
  summary: arrayOf(objectOf({ text: nonEmptyString, evidence: evidenceList }), settled ? { max: SUMMARY_MAX } : { min: 1, max: SUMMARY_MAX }),
  audiences: arrayOf(objectOf({ who: nonEmptyString, does: nonEmptyString, evidence: evidenceList })),
  applications: arrayOf(objectOf({ dir: nonEmptyString, name: nonEmptyString, does: nonEmptyString, evidence: evidenceList }), settled ? {} : { min: 1 }),
  integrations: arrayOf(objectOf({ system: nonEmptyString, use: nonEmptyString, callers: arrayOf(nonEmptyString, { min: 1 }), evidence: evidenceList })),
  unknowns: arrayOf(objectOf({ item: nonEmptyString, searched: nonEmptyString })),
});

const OVERVIEW_SCHEMA = overviewSchema(false);
const SETTLED_SCHEMA = overviewSchema(true);

/** Shape problems of a parsed overview file; `settled` accepts an overview that verification trimmed. */
export const overviewShapeProblems = (doc, { settled = false } = {}) => shapeProblems(doc, settled ? SETTLED_SCHEMA : OVERVIEW_SCHEMA);
