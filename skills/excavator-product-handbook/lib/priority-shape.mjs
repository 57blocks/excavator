/**
 * The priority unit of a run (openspec change handbook-findings-priority):
 * the fixed table that turns a consequence into a level, the shape of the file
 * a ranking lane writes, the paths of the unit's files and the size of a part.
 * The unit has the id `priority`; check-map reserves it as it reserves `overview`.
 *
 * The level comes from the consequence by this table and from nothing else: the
 * model chooses a consequence, never a level.
 */

import { join } from 'node:path';

import { arrayOf, enumOf, literal, nonEmptyString, objectOf, shapeProblems } from './schema.mjs';

export const PRIORITY_ID = 'priority';
export const PRIORITY_FORMAT = 'excavator-product-handbook-priority/1';
export const PRIORITY_FILE = 'entries/priority.json';

/** Groups per part: a ranking lane gets at most this many groups, and each part has its own judge file (design D4). */
const DEFAULT_PART_SIZE = 40;
/** Tests shorten a part with this variable to make several parts from a few groups; the skill never sets it. */
const PART_SIZE_VARIABLE = 'EXCAVATOR_HANDBOOK_PRIORITY_PART_SIZE';
export function partSize() {
  const value = Number(process.env[PART_SIZE_VARIABLE]);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_PART_SIZE;
}

export const LEVELS = Object.freeze(['P0', 'P1', 'P2']);

/**
 * The consequences in the order of the table of design D2: `key`, the `level`
 * the key decides and the `meaning` the lane and the judges read (English text
 * for models, never shown to a reader; the reader sees `md.priority.consequence.<key>`).
 */
export const CONSEQUENCES = Object.freeze([
  { key: 'othersRecords', level: 'P0', meaning: 'A person can see or change records or actions that do not belong to them or that they have no right to handle, or can do so without logging in.' },
  { key: 'money', level: 'P0', meaning: 'An amount in billing, payment, reimbursement or a report is calculated wrongly.' },
  { key: 'dataLoss', level: 'P0', meaning: 'Records are lost, duplicated or written wrongly, and stay that way in the system.' },
  { key: 'secret', level: 'P0', meaning: 'A secret or a password is exposed, or input can change a query or a command that is executed.' },
  { key: 'wrongResult', level: 'P1', meaning: 'In normal use an operation gives a wrong result, or fails without telling anyone.' },
  { key: 'notification', level: 'P1', meaning: 'A person who should be notified is not, or the wrong person is, or the content is wrong.' },
  { key: 'blocked', level: 'P1', meaning: 'An operation the product offers cannot be completed.' },
  { key: 'display', level: 'P2', meaning: 'A display is wrong or confusing, but the data itself is right.' },
  { key: 'inert', level: 'P2', meaning: 'Code that does not run, a placeholder feature, or a fixed value that affects no one at present.' },
]);

export const CONSEQUENCE_KEYS = Object.freeze(CONSEQUENCES.map((row) => row.key));

/** The level (`P0`, `P1` or `P2`) a consequence key decides; throws for a key that is not in the table. */
export function levelOf(consequence) {
  const row = CONSEQUENCES.find((one) => one.key === consequence);
  if (row === undefined) throw new Error(`${JSON.stringify(consequence)} is not a consequence`);
  return row.level;
}

export const meaningOf = (consequence) => CONSEQUENCES.find((one) => one.key === consequence).meaning;

/** The key of a consequence's display name in the fixed-text table. */
export const consequenceKey = (consequence) => `md.priority.consequence.${consequence}`;

const PRIORITY_SCHEMA = objectOf({
  schema: literal(PRIORITY_FORMAT),
  items: arrayOf(objectOf({ key: nonEmptyString, consequence: enumOf(...CONSEQUENCE_KEYS), reason: nonEmptyString })),
});

/** Shape problems of a parsed priority file (or part file). */
export const priorityShapeProblems = (doc) => shapeProblems(doc, PRIORITY_SCHEMA);

/** Where the unit keeps its part files, judge files and verdict files, under `<out>`. */
export const PRIORITY_DIR = 'priority';
export const partFilePath = (outDir, part) => join(outDir, PRIORITY_DIR, `part-${part}.json`);
export const judgeFilePath = (outDir, part) => join(outDir, PRIORITY_DIR, 'judge', `part-${part}.json`);
export const judgeVerdictDir = (outDir) => join(outDir, PRIORITY_DIR, 'verdicts');
export const judgeVerdictPath = (outDir, part, letter) => join(judgeVerdictDir(outDir), `part-${part}.${letter}.json`);
export const JUDGES = Object.freeze(['a', 'b']);
export const JUDGE_VERDICTS = Object.freeze(['follows', 'doesNotFollow']);
