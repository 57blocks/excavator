/**
 * The topics units of a run (openspec change handbook-topics): the fixed table
 * of the five topics and their columns, the shape of the part file a lane
 * writes, the ids of the lanes and of the rows, and the paths of the unit's
 * files. The units are the lanes: one for each business domain that has a
 * verified entry (its id is the domain's, or the area's when the handbook groups
 * by area) and `repeated` for the verified findings. A lane's state is
 * `state.topics[<lane>]`; `mark` names it `topics:<lane>`.
 *
 * A row is `{ topic, fields: { <column>: <text> }, cites: [<id>] }`; a column
 * may be an empty string (what the cited items do not say is not written). Its
 * id, which a judge verdict and the record of a removed row name, is
 * `<lane>#<n>` with n counting from 1 in the order of the lane's file.
 */

import { join } from 'node:path';

import { arrayOf, enumOf, literal, nonEmptyString, objectOf, shapeProblems } from './schema.mjs';

export const TOPICS_FORMAT = 'excavator-product-handbook-topics/1';
export const TOPICS_PART_FORMAT = 'excavator-product-handbook-topics-part/1';
export const TOPICS_FILE = 'entries/topics.json';
export const TOPICS_DIR = 'topics';
export const REPEATED_LANE = 'repeated';
export const LANE_PREFIX = 'topics:';

/** The topics in the order of the chapter; `lane` says which kind of lane writes it, and `plain` the columns that hold reader text (the others are ids). */
export const TOPICS = Object.freeze([
  { id: 'approval', lane: 'domain', columns: Object.freeze(['business', 'route', 'skips', 'conditions', 'actors']) },
  { id: 'time', lane: 'domain', columns: Object.freeze(['rule', 'calendar', 'scope']) },
  { id: 'handoffs', lane: 'domain', columns: Object.freeze(['from', 'to', 'content']) },
  { id: 'access', lane: 'domain', columns: Object.freeze(['feature', 'who', 'pageCheck', 'serverCheck']) },
  { id: 'repeated', lane: 'repeated', columns: Object.freeze(['mechanism', 'places']) },
]);
export const TOPIC_IDS = Object.freeze(TOPICS.map((topic) => topic.id));
export const topicOf = (id) => TOPICS.find((topic) => topic.id === id);

/** The columns that hold ids and not reader text: a handoff's two domains and an access row's feature. */
const ID_COLUMNS = Object.freeze({ handoffs: ['from', 'to'], access: ['feature'] });
export const isIdColumn = (topic, column) => (ID_COLUMNS[topic] ?? []).includes(column);

/** The kind of lane for an id: `repeated` or a domain lane. */
export const laneKind = (lane) => (lane === REPEATED_LANE ? 'repeated' : 'domain');
export const rowIdOf = (lane, index) => `${lane}#${index + 1}`;
export const laneUnitId = (lane) => `${LANE_PREFIX}${lane}`;
export const isLaneUnitId = (id) => typeof id === 'string' && id.startsWith(LANE_PREFIX);
export const laneOfUnitId = (id) => id.slice(LANE_PREFIX.length);

const PART_SCHEMA = objectOf({
  schema: literal(TOPICS_PART_FORMAT),
  lane: nonEmptyString,
  rows: arrayOf(objectOf({ topic: enumOf(...TOPIC_IDS), fields: { type: 'object', required: {}, optional: {} }, cites: arrayOf(nonEmptyString) })),
});

/** Structural problems of a parsed part file: the keys and the topic of each row (not yet its columns). */
export const topicsStructureProblems = (doc) => shapeProblems(doc, PART_SCHEMA).filter((line) => !/\.fields: unexpected key/.test(line));

/** The problems of the columns of row `index`, which must be exactly the columns of its topic, each a string. */
export function columnProblems(row, index) {
  const columns = topicOf(row.topic).columns;
  const path = `rows[${index}].fields`;
  const problems = [];
  for (const column of Object.keys(row.fields)) if (!columns.includes(column)) problems.push(`${path}: ${JSON.stringify(column)} is not a column of ${row.topic}`);
  for (const column of columns) {
    if (!Object.hasOwn(row.fields, column)) problems.push(`${path}: missing column ${JSON.stringify(column)}`);
    else if (typeof row.fields[column] !== 'string') problems.push(`${path}.${column}: must be a string`);
  }
  return problems;
}

/** Shape problems of a parsed part file: the keys, the topic of each row, and for each row exactly the columns of its topic, each a string. */
export function topicsShapeProblems(doc) {
  const problems = topicsStructureProblems(doc);
  if (problems.length > 0) return problems;
  return doc.rows.flatMap((row, index) => columnProblems(row, index));
}

/** The rows of a valid part file with their ids: `[{ id, lane, topic, fields, cites }]`. */
export const rowsOf = (doc) => doc.rows.map((row, index) => ({ id: rowIdOf(doc.lane, index), lane: doc.lane, topic: row.topic, fields: row.fields, cites: row.cites }));

/** The rows of the lanes' part files in the order of the chapter: by topic, then by lane (the order of `docs`), then by row. */
export const mergeRows = (docs) => TOPICS.flatMap((topic) => docs.flatMap((doc) => rowsOf(doc).filter((row) => row.topic === topic.id)));

/** Where the unit keeps its part files, judge files and verdict files, under `<out>`. */
export const partFilePath = (outDir, lane) => join(outDir, TOPICS_DIR, `part-${lane}.json`);
export const partFileName = (lane) => `${TOPICS_DIR}/part-${lane}.json`;
export const judgeDir = (outDir) => join(outDir, TOPICS_DIR, 'judge');
export const verdictDir = (outDir) => join(outDir, TOPICS_DIR, 'verdicts');
export const judgeFilePath = (outDir, lane) => join(judgeDir(outDir), `${lane}.json`);
export const judgeVerdictPath = (outDir, lane, letter) => join(verdictDir(outDir), `${lane}.${letter}.json`);
export const JUDGES = Object.freeze(['a', 'b']);
export const JUDGE_VERDICTS = Object.freeze(['follows', 'doesNotFollow']);
