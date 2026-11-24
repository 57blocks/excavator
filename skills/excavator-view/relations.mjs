/**
 * relations.mjs
 *
 * Reads `relations-graph.json` and its coverage report `reports/relations-coverage.json` (both written by
 * `/excavator-relations`) and judges them the way `domain.mjs` judges the domain graph. Identity and freshness are
 * judged here and never on the page:
 *   - `format` must be the one the merge writes (`GRAPH_FORMAT` of merge-relations.mjs), and `units`, `externals`,
 *     `relations`, `buckets`, `measurements`, `sourceRevision` and `factDigest` must be there, with every unit
 *     carrying a string id and name, every external a string id, and every relation a string id and bucket (not a
 *     kind: the merge keeps a malformed analyzer relation, whose kind may be missing or not a string, as quote-failed);
 *     otherwise the file is unreadable and nothing of it is shown;
 *   - the graph is a different revision when its `sourceRevision` is not the snapshot's (or it records none), or its
 *     `factDigest` is not the knowledge graph's `factsDigest` (its node ids are ids into that fact graph). A graph made
 *     without a knowledge graph records a null `factDigest` and is judged on the source revision alone. A graph whose
 *     `factDigest` cannot be compared, because the knowledge graph is not readable, is a different revision with that
 *     reason: unlike a domain step, nothing the relations view draws needs the knowledge graph, so the content is shown
 *     under the notice rather than hidden. Every value compared is written down.
 * The coverage report has a state of its own (included, not-run, unreadable, other-run) and never hides the graph:
 * it is packed only when it is readable, has the format the merge writes and was written by the same run
 * (`inputDigest` equal to the graph's); any other state is written down with its reason.
 *
 * The payloads keep what the page reads, as written: the graph's `status`, `units`, `externals`, `relations`,
 * `buckets`, `outOfScope` and `measurements`, and the coverage report without its `format`, `token` and
 * `inputDigest`.
 *
 * Returns { state: 'absent' }, { state: 'unreadable', reason } or { state: 'ok', bytes, coverage, counts, revision,
 * differs, reason }; it never throws for a bad file. No model call.
 */

import { join } from 'node:path';

import { COVERAGE_FORMAT, GRAPH_FILE, GRAPH_FORMAT } from '../excavator-relations/merge-relations.mjs';
import { describeFormat, parseJsonObject, readRegularFile } from './product-files.mjs';

export const RELATIONS_FILE = GRAPH_FILE;
export const COVERAGE_FILE = 'reports/relations-coverage.json';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonEmpty = (value) => typeof value === 'string' && value !== '';

const REQUIRED = [
  ['units', Array.isArray],
  ['externals', Array.isArray],
  ['relations', Array.isArray],
  ['buckets', isObject],
  ['measurements', isObject],
  ['sourceRevision', (value) => value === null || typeof value === 'string'],
  ['factDigest', (value) => value === null || typeof value === 'string'],
];
const GRAPH_KEYS = ['status', 'units', 'externals', 'relations', 'buckets', 'outOfScope', 'measurements'];
const COVERAGE_LEFT_OUT = new Set(['format', 'token', 'inputDigest']);

const unreadable = (reason) => ({ state: 'unreadable', reason });

/** The first record of `list` the page could not use, as a sentence; null when all can be. */
function badRecord(list, name, fields) {
  for (let i = 0; i < list.length; i++) {
    if (!isObject(list[i])) return `${RELATIONS_FILE} ${name}[${i}] is not an object`;
    const missing = fields.find((field) => typeof list[i][field] !== 'string');
    if (missing) return `${RELATIONS_FILE} ${name}[${i}] has no string ${missing}`;
  }
  return null;
}

/** The coverage report's state and, when it can be packed, its bytes. */
function readCoverage(dataDir, inputDigest) {
  const file = readRegularFile(join(dataDir, COVERAGE_FILE), COVERAGE_FILE);
  if (file.state === 'absent') return { state: 'not-run', reason: `${COVERAGE_FILE} was not produced` };
  if (file.state === 'unreadable') return { state: 'unreadable', reason: file.reason };
  const parsed = parseJsonObject(file.bytes, COVERAGE_FILE);
  if (!parsed.value) return { state: 'unreadable', reason: parsed.reason };
  const report = parsed.value;
  if (report.format !== COVERAGE_FORMAT) {
    return { state: 'unreadable', reason: `${COVERAGE_FILE} has format ${describeFormat(report.format)}; the viewer reads ${COVERAGE_FORMAT}` };
  }
  if (report.inputDigest !== inputDigest) {
    return {
      state: 'other-run',
      reason: `${COVERAGE_FILE} was written by another run than ${RELATIONS_FILE}: its inputDigest ${report.inputDigest ?? 'is not recorded'}, the graph's ${inputDigest ?? 'is not recorded'}`,
    };
  }
  const kept = Object.fromEntries(Object.entries(report).filter(([key]) => !COVERAGE_LEFT_OUT.has(key)));
  return { state: 'included', reason: null, bytes: Buffer.from(JSON.stringify(kept), 'utf-8') };
}

/**
 * @param {string} dataDir the project's `.excavator/`
 * @param {{ factsDigest: string|null }|null} graph the knowledge graph's identity when that product is readable, else null
 * @param {string} snapshotRevision the source snapshot's revision
 */
export function readRelations(dataDir, graph, snapshotRevision) {
  const file = readRegularFile(join(dataDir, RELATIONS_FILE), RELATIONS_FILE);
  if (file.state === 'absent') return { state: 'absent' };
  if (file.state === 'unreadable') return unreadable(file.reason);
  const parsed = parseJsonObject(file.bytes, RELATIONS_FILE);
  if (!parsed.value) return unreadable(parsed.reason);
  const relations = parsed.value;
  if (relations.format !== GRAPH_FORMAT) {
    return unreadable(`${RELATIONS_FILE} has format ${describeFormat(relations.format)}; the viewer reads ${GRAPH_FORMAT}`);
  }
  const missing = REQUIRED.filter(([key, valid]) => !Object.hasOwn(relations, key) || !valid(relations[key])).map(([key]) => key);
  if (missing.length > 0) return unreadable(`${RELATIONS_FILE} is missing the top-level key(s): ${missing.join(', ')}`);
  const bad = badRecord(relations.units, 'units', ['id', 'name'])
    ?? badRecord(relations.externals, 'externals', ['id'])
    ?? badRecord(relations.relations, 'relations', ['id', 'bucket']);
  if (bad) return unreadable(bad);

  const notes = [];
  if (!nonEmpty(relations.sourceRevision)) notes.push(`${RELATIONS_FILE} records no sourceRevision`);
  if (nonEmpty(relations.factDigest)) {
    if (graph === null) {
      notes.push(`knowledge-graph.jsonl is not readable, so the relations graph's factDigest ${relations.factDigest} cannot be compared with the graph's factsDigest`);
    } else if (relations.factDigest !== graph.factsDigest) {
      notes.push(`${RELATIONS_FILE} was made from other facts than knowledge-graph.jsonl: its factDigest is ${relations.factDigest} and the graph's factsDigest is ${graph.factsDigest ?? 'not recorded'}`);
    }
  }
  const revision = nonEmpty(relations.sourceRevision) ? relations.sourceRevision : null;
  const payload = Object.fromEntries(GRAPH_KEYS.filter((key) => Object.hasOwn(relations, key)).map((key) => [key, relations[key]]));
  return {
    state: 'ok',
    bytes: Buffer.from(JSON.stringify(payload), 'utf-8'),
    coverage: readCoverage(dataDir, relations.inputDigest),
    counts: {
      units: relations.units.length,
      relations: relations.relations.length,
      linked: relations.relations.filter((r) => r.bucket === 'linked').length,
      externals: relations.externals.length,
    },
    revision,
    differs: revision !== snapshotRevision || notes.length > 0,
    reason: notes.length === 0 ? null : notes.join('; '),
  };
}
