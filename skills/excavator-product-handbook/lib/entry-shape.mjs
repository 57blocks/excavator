/** The shape of `<out>/entries/<id>.json` (design D5): exact keys and types, nothing about whether the values are true. */

import { evidenceList } from './map-shape.mjs';
import { arrayOf, enumOf, literal, nonEmptyString, objectOf, shapeProblems } from './schema.mjs';

export const ENTRY_FORMAT = 'excavator-product-handbook-entry/1';
export const SIDES = Object.freeze(['frontend', 'backend']);

const rule = objectOf({ side: enumOf(...SIDES), text: nonEmptyString, evidence: evidenceList });
const field = objectOf({ label: nonEmptyString, evidence: evidenceList, rules: arrayOf(rule) });
const screen = objectOf({ name: nonEmptyString, evidence: evidenceList, fields: arrayOf(field) });
const sentence = objectOf({ text: nonEmptyString, evidence: evidenceList });

const purpose = objectOf({ text: nonEmptyString, evidence: evidenceList });

/**
 * A written entry has a purpose. An entry settled by verdicts round 2 has no
 * `purpose` key when the purpose was not verified and was removed (design D14),
 * like the other removed items it is simply absent; `settled` allows that.
 */
const entrySchema = (settled) => objectOf({
  format: literal(ENTRY_FORMAT),
  id: nonEmptyString,
  ...(settled ? {} : { purpose }),
  who: arrayOf(objectOf({ role: nonEmptyString, can: nonEmptyString, evidence: evidenceList })),
  where: arrayOf(objectOf({ label: nonEmptyString, evidence: evidenceList })),
  screens: arrayOf(screen),
  operations: arrayOf(objectOf({ name: nonEmptyString, sentences: arrayOf(sentence, { min: 1 }) })),
  states: arrayOf(objectOf({ label: nonEmptyString, meaning: nonEmptyString, evidence: evidenceList })),
  notifications: arrayOf(objectOf({
    trigger: nonEmptyString, recipient: nonEmptyString, channel: nonEmptyString, content: nonEmptyString, evidence: evidenceList,
  })),
  automatic: arrayOf(objectOf({ when: nonEmptyString, effect: nonEmptyString, evidence: evidenceList })),
  unknowns: arrayOf(objectOf({ item: nonEmptyString, searched: nonEmptyString })),
}, settled ? { purpose } : {});

const ENTRY_SCHEMA = entrySchema(false);
const SETTLED_SCHEMA = entrySchema(true);

/** Shape problems of a parsed entry file; `settled` accepts an entry whose purpose was removed. */
export const entryShapeProblems = (entry, { settled = false } = {}) => shapeProblems(entry, settled ? SETTLED_SCHEMA : ENTRY_SCHEMA);
