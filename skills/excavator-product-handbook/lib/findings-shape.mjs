/**
 * The shape of `<out>/entries/<featureId>.findings.json` (openspec change
 * handbook-feature-findings): exact keys and types, nothing about whether the
 * values are true. The findings of a feature are a unit of their own, whose id
 * is `<featureId>.findings`; a map id has no dot (ID_PATTERN), so that id can
 * never be a feature's or the overview's. A list may be empty: nothing to
 * prove, and a unit whose findings were all removed is the same file.
 */

import { evidenceList } from './map-shape.mjs';
import { arrayOf, enumOf, literal, nonEmptyString, objectOf, shapeProblems } from './schema.mjs';

export const FINDINGS_FORMAT = 'excavator-product-handbook-findings/1';
export const FINDINGS_SUFFIX = '.findings';
/** The root causes a finding is sorted by, in the order the handbook lists them; the display name of each is the fixed text `categoryKey(value)`. */
export const FINDING_CATEGORIES = Object.freeze(['authorization', 'error-handling', 'notification', 'consistency', 'calculation', 'hard-coded', 'contract', 'security', 'display', 'time', 'other']);

/** The key of a category's display name in the fixed-text table; keys hold letters and dots only, so `error-handling` is `errorHandling`. */
export const categoryKey = (category) => `md.findings.category.${category.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())}`;

export const findingsId = (featureId) => `${featureId}${FINDINGS_SUFFIX}`;
export const isFindingsId = (id) => id.endsWith(FINDINGS_SUFFIX) && id.length > FINDINGS_SUFFIX.length;
/** The feature a findings unit id belongs to. */
export const featureOfFindings = (id) => id.slice(0, -FINDINGS_SUFFIX.length);

const FINDINGS_SCHEMA = objectOf({
  format: literal(FINDINGS_FORMAT),
  id: nonEmptyString,
  findings: arrayOf(objectOf({ category: enumOf(...FINDING_CATEGORIES), text: nonEmptyString, evidence: evidenceList })),
  unknowns: arrayOf(objectOf({ item: nonEmptyString, searched: nonEmptyString })),
});

/** Shape problems of a parsed findings file. */
export const findingsShapeProblems = (doc) => shapeProblems(doc, FINDINGS_SCHEMA);
