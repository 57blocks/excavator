/**
 * `handbook.mjs check-topics <out> [--lane <id>] --project <root>` (openspec
 * change handbook-topics, design D4): check the part file a lane wrote,
 * `<out>/topics/part-<lane>.json`, against the facts `topic-facts` prints for it.
 * Every problem is printed, one line each:
 *
 * - the shape (topics-shape.mjs): the topic of a row is in the table, its fields
 *   are exactly the columns of its topic, each a string; a domain lane writes
 *   only the first four topics and the repeated lane only the fifth;
 * - the cites: each row cites at least one id, and every id is a fact of this
 *   lane now (a fact of another lane is not);
 * - the columns that name things: a data row's `to` is this lane and its `from` is
 *   another domain of the handbook, with content; an access row names a feature
 *   with a verified entry in this lane and cites at least one of its items;
 * - the text (every column but the ids): the checks of reader text (no
 *   code-shaped word, no file name, the run's language) and the advice words, which
 *   topics, as the findings, may not use; one line; and every number in it occurs
 *   in the cited text (a level name such as P0 is no number).
 *
 * On success the lane is recorded as `checked` with the digests of its file and
 * its facts, otherwise as `failed` with every problem, and the last line is a
 * `Next:` line. Without `--lane`, every lane is checked in turn and the rows of the
 * lanes that hold are merged into `<out>/entries/topics.json` (by topic, lane, row).
 */

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { UsageError } from './errors.mjs';
import { readJson, writeJson } from './json-file.mjs';
import { readerTextProblems } from './priority-context.mjs';
import { MAX_ATTEMPTS, entryDigest, loadState, saveState } from './state.mjs';
import { currentEntry, loadTopicsContext, requireLane } from './topics-context.mjs';
import {
  TOPICS_FILE, TOPICS_FORMAT, columnProblems, isIdColumn, laneUnitId, mergeRows, partFileName, partFilePath, topicOf, topicsStructureProblems,
} from './topics-shape.mjs';
import { readLaneFile } from './topics-state.mjs';
import { setUnitState } from './unit.mjs';
import { missingNumbers } from './values.mjs';

/** A level name is not a number of the text: `P0` is stripped before the digits are read. */
const withoutLevels = (text) => text.replace(/\bP[0-2]\b/g, ' ');

/** The text of a cited fact for the number check: an item's own text, a group's fields. */
const passageOf = (row) => withoutLevels(row.kind === 'item' ? row.text : row.fields.join(' '));

/** The problems of a part file against its lane and the facts: `[line]`. */
export function laneProblems(doc, lane, facts, run) {
  const structure = topicsStructureProblems(doc);
  if (structure.length > 0) return structure;
  const problems = [];
  if (doc.lane !== lane.id) problems.push(`lane: must be ${JSON.stringify(lane.id)}, found ${JSON.stringify(doc.lane)}`);
  const otherDomains = new Set(facts.domains.map((domain) => domain.id).filter((id) => id !== lane.id));
  const texts = [];
  doc.rows.forEach((row, index) => {
    const path = `rows[${index}]`;
    const topic = topicOf(row.topic);
    if (topic.lane !== lane.kind) {
      problems.push(`${path}.topic: ${JSON.stringify(row.topic)} is not written by ${lane.kind === 'domain' ? 'a domain lane' : 'the repeated lane'}`);
      return;
    }
    const columnsWrong = columnProblems(row, index);
    problems.push(...columnsWrong);
    if (columnsWrong.length > 0) return;
    const columns = Object.entries(row.fields);
    if (columns.every(([, value]) => value.trim() === '')) problems.push(`${path}.fields: every column is empty; write only what the cited items say`);
    if (row.cites.length === 0) problems.push(`${path}.cites: must cite at least one fact`);
    const cited = row.cites.map((id) => lane.byId.get(id));
    row.cites.forEach((id, j) => {
      if (cited[j] === undefined) problems.push(`${path}.cites[${j}]: ${JSON.stringify(id)} is not a fact of topic-facts for this lane`);
    });
    if (row.topic === 'handoffs') {
      const { from, to, content } = row.fields;
      if (to !== lane.id) problems.push(`${path}.fields.to: ${JSON.stringify(to)} must be this lane, ${lane.id}`);
      if (!otherDomains.has(from)) problems.push(`${path}.fields.from: ${JSON.stringify(from)} is not another domain of the handbook`);
      if (content.trim() === '') problems.push(`${path}.fields.content: a data row needs content`);
    }
    if (row.topic === 'access') {
      const { feature } = row.fields;
      if (!lane.featureIds.includes(feature)) problems.push(`${path}.fields.feature: ${JSON.stringify(feature)} is not a feature with a verified entry in this lane`);
      else if (!row.cites.some((id) => id.startsWith(`${feature}#`))) problems.push(`${path}.cites: an access row must cite at least one item of ${feature}`);
    }
    const passages = cited.filter((one) => one !== undefined).map(passageOf);
    for (const [column, value] of columns) {
      if (isIdColumn(row.topic, column) || value.trim() === '') continue;
      const where = `${path}.fields.${column}`;
      if (/[\r\n]/.test(value.trim())) problems.push(`${where}: must be one line`);
      texts.push({ path: where, text: value.trim() });
      for (const number of missingNumbers(withoutLevels(value), passages)) problems.push(`${where}: number ${number} does not occur in the items it cites`);
    }
  });
  problems.push(...readerTextProblems(texts, run, { advice: true }));
  return problems;
}

const NEXT_AGAIN = (lane) => `Next: delete ${partFileName(lane)}, mark ${laneUnitId(lane)} dispatched and re-dispatch the lane once with the lines above (attempt 2 of 2)`;
const NEXT_STAYS = (lane) => `Next: ${laneUnitId(lane)} stays failed (${MAX_ATTEMPTS} of ${MAX_ATTEMPTS} attempts)`;

/**
 * Check one lane and record the result in `state` (the caller saves it). Returns `{ lines, ok, again, status, doc }`: `lines` the
 * problems (empty when ok), `again` whether the lane may be written once more, `status` the lane's status afterwards.
 */
function checkLane(context, state, lane) {
  const { run, outDir, facts } = context;
  const id = lane.id;
  const unit = laneUnitId(id);
  const own = currentEntry(state, lane);
  // A lane that two judges settled for these facts and whose file is unchanged is not checked again: that would drop what the judges recorded.
  const settled = own.status === 'verified' ? readLaneFile(outDir, id, own).doc : null;
  if (settled !== null) return { ok: true, lines: [], status: 'verified', message: `${unit}: verified, unchanged since it was verified`, doc: settled };
  const attempts = own.attempts;
  const path = partFilePath(outDir, id);
  let problems;
  if (!existsSync(path)) problems = [`lane-wrote-nothing: ${partFileName(id)} is missing`];
  else {
    const read = readJson(path);
    problems = read.ok ? laneProblems(read.value, lane, facts, run) : [`${partFileName(id)} ${read.reason}`];
  }
  if (problems.length > 0) {
    setUnitState(state, unit, { status: 'failed', attempts, factsDigest: lane.digest, failure: { step: 'check-entry', reasons: problems } });
    return { ok: false, lines: problems, again: attempts < MAX_ATTEMPTS, status: 'failed', doc: null };
  }
  setUnitState(state, unit, { status: 'checked', attempts, factsDigest: lane.digest, entryDigest: entryDigest(path) });
  const doc = readJson(path).value;
  return { ok: true, lines: [], status: 'checked', message: `${unit}: checked (${doc.rows.length} rows)`, doc };
}

/** Run check-topics. Returns { status, lines }; `laneId` undefined checks every lane and merges. */
export function checkTopics(outDirArg, root, laneId) {
  const context = loadTopicsContext(outDirArg, root);
  if (context.stop) return context.stop;
  if (!context.hasLanes) return { status: 0, lines: ['Topics: no verified entry and no verified finding; nothing to check'] };
  const stateRead = loadState(context.outDir);
  if (!stateRead.ok) {
    if (stateRead.missing) throw new UsageError(stateRead.problem);
    return { status: 1, lines: [stateRead.problem] };
  }
  const { state } = stateRead;
  if (laneId !== undefined) {
    const lane = requireLane(context, laneId);
    const result = checkLane(context, state, lane);
    saveState(context.outDir, state);
    if (result.ok) return { status: 0, lines: [result.message, ...(result.status === 'checked' ? ['Next: run topic-judge'] : [])] };
    return { status: 1, lines: [...result.lines, result.again ? NEXT_AGAIN(lane.id) : NEXT_STAYS(lane.id)] };
  }

  const lines = [];
  const next = [];
  const docs = [];
  let again = false;
  let checked = false;
  for (const lane of context.facts.lanes) {
    const result = checkLane(context, state, lane);
    if (result.ok) {
      lines.push(result.message);
      docs.push(result.doc);
      checked ||= result.status === 'checked';
    } else {
      lines.push(...result.lines.map((line) => `lane ${lane.id}: ${line}`));
      next.push(result.again ? NEXT_AGAIN(lane.id) : NEXT_STAYS(lane.id));
      again ||= result.again;
    }
  }
  saveState(context.outDir, state);
  const file = join(context.outDir, TOPICS_FILE);
  if (docs.length === 0) rmSync(file, { force: true });
  else {
    mkdirSync(dirname(file), { recursive: true });
    const rows = mergeRows(docs);
    writeJson(file, { schema: TOPICS_FORMAT, rows });
    lines.push(`topics: merged (${docs.length} lanes, ${rows.length} rows)`);
  }
  lines.push(...next, ...(checked ? ['Next: run topic-judge'] : []));
  return { status: again ? 1 : 0, lines };
}
