/** The shape of `<out>/entries/<id>.json` (design D5): exact keys and types, nothing about whether the values are true. */

import { evidenceList } from './map-shape.mjs';
import { arrayOf, enumOf, literal, nonEmptyString, objectOf, shapeProblems } from './schema.mjs';

export const ENTRY_FORMAT = 'excavator-product-handbook-entry/2';
/** The fact sheet written next to a free chapter (openspec change handbook-free-chapter): what a new entry is. */
export const ENTRY_FORMAT_V3 = 'excavator-product-handbook-entry/3';
/** The format of an entry written before openspec change handbook-deep-entry: read only when settled, never written. */
export const ENTRY_FORMAT_V1 = 'excavator-product-handbook-entry/1';
export const SIDES = Object.freeze(['frontend', 'backend']);

const rule = objectOf({ side: enumOf(...SIDES), text: nonEmptyString, evidence: evidenceList });
const field = objectOf({ label: nonEmptyString, evidence: evidenceList, rules: arrayOf(rule) });
const screen = objectOf({ name: nonEmptyString, evidence: evidenceList, fields: arrayOf(field) });
const sentence = objectOf({ text: nonEmptyString, evidence: evidenceList });

const purpose = objectOf({ text: nonEmptyString, evidence: evidenceList });
const textPart = objectOf({ text: nonEmptyString, evidence: evidenceList });
const edge = objectOf({ when: nonEmptyString, then: nonEmptyString, evidence: evidenceList });
const handoff = objectOf({ feature: nonEmptyString, text: nonEmptyString, evidence: evidenceList });
const transition = objectOf({ from: nonEmptyString, to: nonEmptyString, by: nonEmptyString, evidence: evidenceList });
const operationV2 = objectOf({
  name: nonEmptyString,
  sentences: arrayOf(sentence, { min: 1 }),
  triggers: arrayOf(textPart),
  calculations: arrayOf(textPart),
  changes: arrayOf(textPart),
  edges: arrayOf(edge),
  handoffs: arrayOf(handoff),
});
const operationV1 = objectOf({ name: nonEmptyString, sentences: arrayOf(sentence, { min: 1 }) });

/**
 * A written entry has a purpose. An entry settled by verdicts round 2 has no
 * `purpose` key when the purpose was not verified and was removed (design D14),
 * like the other removed items it is simply absent; `settled` allows that.
 */
const entrySchema = (settled, v1) => objectOf({
  format: literal(v1 ? ENTRY_FORMAT_V1 : ENTRY_FORMAT),
  id: nonEmptyString,
  ...(settled ? {} : { purpose }),
  who: arrayOf(objectOf({ role: nonEmptyString, can: nonEmptyString, evidence: evidenceList })),
  where: arrayOf(objectOf({ label: nonEmptyString, evidence: evidenceList })),
  screens: arrayOf(screen),
  operations: arrayOf(v1 ? operationV1 : operationV2),
  states: arrayOf(objectOf({ label: nonEmptyString, meaning: nonEmptyString, evidence: evidenceList })),
  ...(v1 ? {} : { transitions: arrayOf(transition) }),
  notifications: arrayOf(objectOf({
    trigger: nonEmptyString, recipient: nonEmptyString, channel: nonEmptyString, content: nonEmptyString, evidence: evidenceList,
  })),
  automatic: arrayOf(objectOf({ when: nonEmptyString, effect: nonEmptyString, evidence: evidenceList })),
  unknowns: arrayOf(objectOf({ item: nonEmptyString, searched: nonEmptyString })),
}, settled ? { purpose } : {});

/** The /3 fact sheet: the keys the handbook's summaries read; screens carry their name only, operations live in the chapter. */
const entrySchemaV3 = (settled) => objectOf({
  format: literal(ENTRY_FORMAT_V3),
  id: nonEmptyString,
  ...(settled ? {} : { purpose }),
  who: arrayOf(objectOf({ role: nonEmptyString, can: nonEmptyString, evidence: evidenceList })),
  where: arrayOf(objectOf({ label: nonEmptyString, evidence: evidenceList })),
  screens: arrayOf(objectOf({ name: nonEmptyString, evidence: evidenceList })),
  handoffs: arrayOf(handoff),
  states: arrayOf(objectOf({ label: nonEmptyString, meaning: nonEmptyString, evidence: evidenceList })),
  transitions: arrayOf(transition),
  notifications: arrayOf(objectOf({
    trigger: nonEmptyString, recipient: nonEmptyString, channel: nonEmptyString, content: nonEmptyString, evidence: evidenceList,
  })),
  automatic: arrayOf(objectOf({ when: nonEmptyString, effect: nonEmptyString, evidence: evidenceList })),
  unknowns: arrayOf(objectOf({ item: nonEmptyString, searched: nonEmptyString })),
}, settled ? { purpose } : {});

/** A key the fact sheet does not list is content for the chapter. */
const withChapterHint = (line) => (/: unexpected key "[^"]*"$/.test(line) ? `${line}; what the fact sheet does not list (operations, fields, steps, rules) belongs in the chapter` : line);

const ENTRY_SCHEMA = entrySchema(false, false);
const SETTLED_SCHEMA = entrySchema(true, false);
const SETTLED_V1_SCHEMA = entrySchema(true, true);

/**
 * Shape problems of a parsed entry file; `settled` accepts an entry whose purpose was removed and
 * an entry of format /1 (which has none of the /2 lists). A newly written entry must be /3 (feature-check.mjs refuses /2 there); the /3 format is the fact sheet.
 */
export function entryShapeProblems(entry, { settled = false } = {}) {
  if (entry?.format === ENTRY_FORMAT_V3) return shapeProblems(entry, entrySchemaV3(settled)).map(withChapterHint);
  if (entry?.format === ENTRY_FORMAT_V1) {
    if (settled) return shapeProblems(entry, SETTLED_V1_SCHEMA);
    return [`format: must be ${JSON.stringify(ENTRY_FORMAT)}, found ${JSON.stringify(ENTRY_FORMAT_V1)}; a new entry is written in format /2`];
  }
  return shapeProblems(entry, settled ? SETTLED_SCHEMA : ENTRY_SCHEMA);
}
