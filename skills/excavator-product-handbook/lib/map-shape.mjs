/** The shape of `<out>/map.json` (design D4): exact keys and types, nothing about whether the values are true. */

import { arrayOf, enumOf, literal, nonEmptyString, objectOf, shapeProblems } from './schema.mjs';

export const MAP_FORMAT = 'excavator-product-handbook-map/1';
/** How a reader gets to a feature, in the order the handbook lists them. */
export const REACHES = Object.freeze(['menu', 'link', 'automated', 'interface', 'operator']);
/** An id becomes a file name (entries/<id>.json), so it is a plain token. */
export const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;

const evidenceItem = objectOf({ file: nonEmptyString, passage: nonEmptyString });
export const evidenceList = arrayOf(evidenceItem, { min: 1 });

const labelled = objectOf({ label: nonEmptyString, evidence: evidenceList });

const MAP_SCHEMA = objectOf({
  format: literal(MAP_FORMAT),
  language: nonEmptyString,
  areas: arrayOf(objectOf({ id: nonEmptyString, name: nonEmptyString }, { evidence: evidenceList })),
  features: arrayOf(objectOf(
    {
      id: nonEmptyString,
      name: nonEmptyString,
      area: nonEmptyString,
      reach: enumOf(...REACHES),
      candidates: arrayOf(nonEmptyString),
      seedFiles: arrayOf(nonEmptyString),
    },
    { label: nonEmptyString, evidence: evidenceList },
  )),
  unassigned: arrayOf(objectOf({ candidate: nonEmptyString, reason: nonEmptyString })),
  roles: arrayOf(labelled),
  names: arrayOf(labelled),
});

/** Shape problems of a parsed map.json. */
export const mapShapeProblems = (map) => shapeProblems(map, MAP_SCHEMA);
