/**
 * tour.mjs
 *
 * Reads `tour.json` (the learning tour, format `excavator-tour/1`) into the payload
 * the Learn panel draws from (openspec: changes/viewer-learn, design D8). Identity is
 * judged here and never on the page:
 *   - `format` must be the one `tour.mjs report` writes, the top-level keys the page
 *     reads must be there, and every step, sentence and removal must carry the fields
 *     the page reads; a step that keeps a `contradicted` sentence is refused too, since
 *     no tour may show one, and so is a verdict other than verified, unverified or
 *     unchecked. Otherwise the file is unreadable and nothing of it is shown;
 *   - the tour is a different revision when its `factDigest` is not the knowledge
 *     graph's `factsDigest` (its `nodeIds` are ids into that exact fact graph), or
 *     when either records none, so it can never be taken as current unchecked. Both
 *     values are written down.
 * The payload keeps `contentLanguage`, `steps`, `removed`, `gaps` and `counts` as
 * written, in that order, and leaves out the rest. A different revision keeps only
 * `contentLanguage`, `gaps` and `counts`: its steps and removed sentences name node ids
 * that may not match this graph, so the page is never given them to show.
 *
 * Returns { state: 'absent' }, { state: 'unreadable', reason } or
 * { state: 'ok', bytes, counts, revision, differs, reason, factDigests }; it never
 * throws for a bad file. No model call.
 */

import { join } from 'node:path';

import { KNOWLEDGE_GRAPH_FILE } from '../excavator/knowledge-graph-store.mjs';
import { TOUR_FILE, TOUR_FORMAT } from '../excavator/tour-report.mjs';
import { describeFormat, parseJsonObject, readRegularFile } from './product-files.mjs';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isString = (value) => typeof value === 'string';

const REQUIRED = [
  ['contentLanguage', isString],
  ['sourceRevision', (value) => isString(value) && value !== ''],
  ['factDigest', (value) => value === null || isString(value)],
  ['steps', Array.isArray],
  ['removed', Array.isArray],
  ['gaps', Array.isArray],
  ['counts', isObject],
];

const STEP_FIELDS = [
  ['order', (value) => Number.isInteger(value), 'has no integer order'],
  ['title', isString, 'has no string title'],
  ['description', isString, 'has no string description'],
  ['nodeIds', (value) => Array.isArray(value) && value.every(isString), 'has no nodeIds list of strings'],
  ['sentences', Array.isArray, 'has no sentences list'],
];
const SENTENCE_FIELDS = ['id', 'text', 'verdict'];
const REMOVED_FIELDS = ['text', 'verdict'];
const KEPT_VERDICTS = ['verified', 'unverified', 'unchecked'];

const unreadable = (reason) => ({ state: 'unreadable', reason });

/** The first step, sentence or removal the page could not use, as a sentence; null when all can be. */
function badRecord(tour) {
  for (let i = 0; i < tour.steps.length; i++) {
    const step = tour.steps[i];
    const at = `${TOUR_FILE} steps[${i}]`;
    if (!isObject(step)) return `${at} is not an object`;
    const field = STEP_FIELDS.find(([key, valid]) => !valid(step[key]));
    if (field) return `${at} ${field[2]}`;
    if (step.languageLesson !== undefined && !isString(step.languageLesson)) return `${at} has a languageLesson that is not a string`;
    for (let j = 0; j < step.sentences.length; j++) {
      const sentence = step.sentences[j];
      if (!isObject(sentence)) return `${at}.sentences[${j}] is not an object`;
      const missing = SENTENCE_FIELDS.find((key) => !isString(sentence[key]));
      if (missing) return `${at}.sentences[${j}] has no string ${missing}`;
    }
  }
  for (let i = 0; i < tour.removed.length; i++) {
    const record = tour.removed[i];
    if (!isObject(record)) return `${TOUR_FILE} removed[${i}] is not an object`;
    const missing = REMOVED_FIELDS.find((key) => !isString(record[key]));
    if (missing) return `${TOUR_FILE} removed[${i}] has no string ${missing}`;
  }
  return null;
}

/** Why the tour's node ids cannot be trusted against this graph; null when the two digests are the same recorded value. */
function digestMismatch(tourDigest, graphDigest) {
  if (tourDigest === null || graphDigest === null) {
    return `${TOUR_FILE} records factDigest ${tourDigest ?? 'none'} and ${KNOWLEDGE_GRAPH_FILE} records factsDigest ${graphDigest ?? 'none'}, so the two cannot be compared`;
  }
  if (tourDigest !== graphDigest) {
    return `${TOUR_FILE} was made from other facts than ${KNOWLEDGE_GRAPH_FILE}: its factDigest is ${tourDigest} and the graph's factsDigest is ${graphDigest}`;
  }
  return null;
}

/**
 * @param {string} dataDir the project's `.excavator/`
 * @param {{ factsDigest: string|null }|null} graph the knowledge graph's identity when that product is readable, else null
 */
export function readTour(dataDir, graph) {
  const file = readRegularFile(join(dataDir, TOUR_FILE), TOUR_FILE);
  if (file.state === 'absent') return { state: 'absent' };
  if (file.state === 'unreadable') return unreadable(file.reason);
  const parsed = parseJsonObject(file.bytes, TOUR_FILE);
  if (!parsed.value) return unreadable(parsed.reason);
  const tour = parsed.value;
  if (tour.format !== TOUR_FORMAT) {
    return unreadable(`${TOUR_FILE} has format ${describeFormat(tour.format)}; the viewer reads ${TOUR_FORMAT}`);
  }
  const missing = REQUIRED.filter(([key, valid]) => !Object.hasOwn(tour, key) || !valid(tour[key])).map(([key]) => key);
  if (missing.length > 0) return unreadable(`${TOUR_FILE} is missing the top-level key(s): ${missing.join(', ')}`);
  const bad = badRecord(tour);
  if (bad) return unreadable(bad);
  const sentences = tour.steps.flatMap((step) => step.sentences);
  const contradicted = sentences.filter((sentence) => sentence.verdict === 'contradicted');
  if (contradicted.length > 0) {
    return unreadable(`${TOUR_FILE} keeps ${contradicted.length} contradicted sentence(s) in its steps (first: ${contradicted[0].id})`);
  }
  // Every kept sentence counts under one verdict the page knows; any other verdict would be a fourth, invisible state.
  const unknown = sentences.find((sentence) => !KEPT_VERDICTS.includes(sentence.verdict));
  if (unknown) return unreadable(`${TOUR_FILE} sentence ${unknown.id} has verdict ${JSON.stringify(unknown.verdict)}; the viewer reads ${KEPT_VERDICTS.join(', ')}`);
  if (graph === null) return unreadable(`${KNOWLEDGE_GRAPH_FILE} is not readable, so the tour's factDigest cannot be compared with the graph's factsDigest`);

  const factDigests = { tour: tour.factDigest, graph: graph.factsDigest };
  const mismatch = digestMismatch(factDigests.tour, factDigests.graph);
  const payload = mismatch === null
    ? { contentLanguage: tour.contentLanguage, steps: tour.steps, removed: tour.removed, gaps: tour.gaps, counts: tour.counts }
    : { contentLanguage: tour.contentLanguage, gaps: tour.gaps, counts: tour.counts };
  return {
    state: 'ok',
    bytes: Buffer.from(JSON.stringify(payload), 'utf-8'),
    counts: {
      steps: tour.steps.length,
      sentences: sentences.length,
      byVerdict: Object.fromEntries(KEPT_VERDICTS.map((verdict) => [verdict, sentences.filter((sentence) => sentence.verdict === verdict).length])),
      removedSentences: tour.removed.length,
    },
    revision: tour.sourceRevision,
    differs: mismatch !== null,
    reason: mismatch,
    factDigests,
  };
}
