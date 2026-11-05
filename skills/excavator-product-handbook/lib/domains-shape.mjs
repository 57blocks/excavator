/**
 * The shape of `<out>/domains.json` (openspec change handbook-map-by-domain,
 * design D1): exact keys and types, nothing about whether the values are true.
 * A domain is a group of the map's features that readers handle together; the
 * map itself does not change.
 */

import { evidenceList } from './map-shape.mjs';
import { arrayOf, literal, nonEmptyString, objectOf, shapeProblems } from './schema.mjs';

export const DOMAINS_FORMAT = 'excavator-product-handbook-domains/1';
export const DOMAINS_FILE = 'domains.json';

const DOMAINS_SCHEMA = objectOf({
  format: literal(DOMAINS_FORMAT),
  language: nonEmptyString,
  domains: arrayOf(objectOf(
    { id: nonEmptyString, name: nonEmptyString, features: arrayOf(nonEmptyString) },
    { evidence: evidenceList },
  )),
});

/** Shape problems of a parsed domains.json. */
export const domainsShapeProblems = (doc) => shapeProblems(doc, DOMAINS_SCHEMA);
