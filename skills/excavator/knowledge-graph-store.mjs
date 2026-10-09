/**
 * knowledge-graph-store.mjs
 *
 * Line-oriented persistence for the knowledge graph (openspec: changes/
 * knowledge-graph-line-store, capability `fact-graph`, design D1/D2). The
 * graph used to be one whole-document `knowledge-graph.json`, written from one
 * string and read back into one string, which capped the analyzable
 * repository size at V8's single-string limit (apache/hadoop's graph alone was
 * 80% of it). `knowledge-graph.jsonl` stores one JSON record per line, so the
 * longest string ever built is one record.
 *
 * Layout (one record per line, compact JSON):
 *   1. exactly one `header` record (must be line 1):
 *        { record: 'header', format, keys, fields, counts }
 *      - `keys`: the graph's own top-level keys, in their original order, so
 *        a read graph re-serializes byte-identically and a written-then-read
 *        graph keeps its key order;
 *      - `fields`: every top-level value that is not a record stream
 *        (`version`, `project`, `kind`, `contentLanguage`, `languageAudit`,
 *        and anything else) — a freshness check reads only this line;
 *      - `counts`: the number of records each present stream holds.
 *   2. one record per element of each record stream, streams in `keys`
 *      order, elements in array order:
 *        nodes  -> { record: 'node', node }
 *        edges  -> { record: 'edge', edge }
 *        layers -> { record: 'layer', layer }
 *        tour   -> { record: 'tour', step }
 *        gaps   -> { record: 'gap', gap }
 *      and, when the graph has `coverage`, one { record: 'coverage', coverage }.
 *
 * `readKnowledgeGraph` returns an object strictly deep-equal
 * (`isDeepStrictEqual`) to the graph that was written, including graphs
 * without `coverage`/`gaps` (the pre-v2 shape) and Full graphs with layers
 * and a tour. It validates as it reads: the first line must be a header with
 * the expected `format`; every record type must be known and belong to a
 * stream the header lists; a second header fails; the number of records per
 * stream must equal `counts`. Any failure throws `KnowledgeGraphFormatError`
 * — never a partial graph.
 *
 * `knowledge-graph.json` (the old whole-document format) is never read by
 * this module or anything downstream of it (zero-compat, AGENTS.md).
 * `LEGACY_KNOWLEDGE_GRAPH_FILE` is exported only so a caller can name it in
 * an honest gap ("only the legacy file is present").
 *
 * Contract: openspec/changes/knowledge-graph-line-store/specs/fact-graph/spec.md
 */

import { renameSync, rmSync } from 'node:fs';
import { DEFAULT_READ_BLOCK_SIZE, readLineFile, writeLineFile } from './jsonl-lines.mjs';
import { DEFAULT_LIMIT_CHARS, serializeJsonProduct } from './product-serialization.mjs';

/** The current on-disk file name. */
export const KNOWLEDGE_GRAPH_FILE = 'knowledge-graph.jsonl';

/** The RETIRED whole-document format's file name; never opened or parsed. */
export const LEGACY_KNOWLEDGE_GRAPH_FILE = 'knowledge-graph.json';

/** Stamped on every header record. An incompatible layout change bumps it. */
export const KNOWLEDGE_GRAPH_FORMAT = 'excavator-knowledge-graph-lines/1';

/** Top-level array keys stored one element per line, and the record type and
 *  value key each element is written under. */
const STREAMS = Object.freeze({
  nodes: { record: 'node', field: 'node' },
  edges: { record: 'edge', field: 'edge' },
  layers: { record: 'layer', field: 'layer' },
  tour: { record: 'tour', field: 'step' },
  gaps: { record: 'gap', field: 'gap' },
});
const STREAM_BY_RECORD = new Map(Object.entries(STREAMS).map(([key, s]) => [s.record, { key, field: s.field }]));
const COVERAGE_KEY = 'coverage';

export class KnowledgeGraphFormatError extends Error {
  constructor(message) {
    super(message);
    this.name = 'KnowledgeGraphFormatError';
  }
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

/**
 * Persist `graph` to `path` as line records. Each record is serialized on its
 * own through `serializeJsonProduct`, so a single record longer than `limit`
 * fails as a named `ProductTooLargeError`; the graph as a whole has no size
 * limit. Writes `path` directly — use `writeKnowledgeGraphAtomic` when the
 * final file must never be seen half-written.
 *
 * @param {string} path
 * @param {object} graph
 * @param {{ limit?: number, product?: string }} [options]
 * @returns {{ bytes: number, lines: number, maxLineChars: number }}
 */
export function writeKnowledgeGraph(path, graph, { limit = DEFAULT_LIMIT_CHARS, product = KNOWLEDGE_GRAPH_FILE } = {}) {
  if (graph === null || typeof graph !== 'object' || Array.isArray(graph)) {
    throw new TypeError('writeKnowledgeGraph: graph must be a plain object');
  }
  // JSON.stringify drops an undefined-valued key; mirror that so the file
  // round-trips to what a whole-document JSON round trip would give.
  const keys = Object.keys(graph).filter((key) => graph[key] !== undefined);
  const fields = {};
  const counts = {};
  for (const key of keys) {
    if (Object.hasOwn(STREAMS, key)) {
      if (!Array.isArray(graph[key])) {
        throw new TypeError(`writeKnowledgeGraph: graph.${key} must be an array`);
      }
      counts[key] = graph[key].length;
    } else if (key !== COVERAGE_KEY) {
      Object.defineProperty(fields, key, { value: graph[key], enumerable: true, writable: true, configurable: true });
    }
  }

  return writeLineFile(path, (push) => {
    const emit = (record) => push(serializeJsonProduct(product, record, { limit }));
    emit({ record: 'header', format: KNOWLEDGE_GRAPH_FORMAT, keys, fields, counts });
    for (const key of keys) {
      if (Object.hasOwn(STREAMS, key)) {
        const { record, field } = STREAMS[key];
        // An array hole or undefined element serializes as null in JSON.
        for (const element of graph[key]) emit({ record, [field]: element === undefined ? null : element });
      } else if (key === COVERAGE_KEY) {
        emit({ record: 'coverage', coverage: graph[key] });
      }
    }
  });
}

/**
 * `writeKnowledgeGraph` to a sibling temporary file, then rename it over
 * `path`, so readers see either the previous file or the complete new one.
 * The temporary file is removed if writing fails.
 *
 * @param {string} path
 * @param {object} graph
 * @param {{ limit?: number, product?: string }} [options]
 * @returns {{ bytes: number, lines: number, maxLineChars: number }}
 */
export function writeKnowledgeGraphAtomic(path, graph, options) {
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  try {
    const result = writeKnowledgeGraph(tmpPath, graph, options);
    renameSync(tmpPath, path);
    return result;
  } catch (error) {
    rmSync(tmpPath, { force: true });
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------

function checkHeader(record, fail) {
  if (record === null || typeof record !== 'object' || record.record !== 'header' || record.format !== KNOWLEDGE_GRAPH_FORMAT) {
    fail(`expected the first line to be a header record with format "${KNOWLEDGE_GRAPH_FORMAT}"`);
  }
  const { keys, fields, counts } = record;
  if (!Array.isArray(keys) || !keys.every((key) => typeof key === 'string') || new Set(keys).size !== keys.length) {
    fail('header "keys" must be an array of distinct strings');
  }
  if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) fail('header "fields" must be an object');
  if (counts === null || typeof counts !== 'object' || Array.isArray(counts)) fail('header "counts" must be an object');
  for (const key of keys) {
    if (Object.hasOwn(STREAMS, key)) {
      if (!Number.isInteger(counts[key]) || counts[key] < 0) fail(`header count for "${key}" must be a non-negative integer`);
    } else if (key !== COVERAGE_KEY && !Object.hasOwn(fields, key)) {
      fail(`header lists key "${key}" but carries no value for it`);
    }
  }
  for (const key of Object.keys(counts)) {
    if (!keys.includes(key) || !Object.hasOwn(STREAMS, key)) fail(`header has a count for "${key}", which is not a listed stream`);
  }
  for (const key of Object.keys(fields)) {
    if (!keys.includes(key) || Object.hasOwn(STREAMS, key) || key === COVERAGE_KEY) {
      fail(`header field "${key}" is not a listed non-stream key`);
    }
  }
}

/**
 * Read only the header line of a `knowledge-graph.jsonl` file: the graph's
 * key order, its non-stream fields (`project`, `version`, ...) and the
 * stream counts. For freshness checks that must not parse the whole graph.
 *
 * @param {string} path
 * @returns {{ keys: string[], fields: Record<string, *>, counts: Record<string, number> }}
 */
export function readKnowledgeGraphHeader(path) {
  let header = null;
  const fail = (message) => {
    throw new KnowledgeGraphFormatError(`${path}: ${message} (line 1)`);
  };
  readLineFile(path, (line) => {
    let record;
    try {
      record = JSON.parse(line);
    } catch (error) {
      fail(`invalid JSON (${error.message})`);
    }
    checkHeader(record, fail);
    header = record;
    return false;
  });
  if (header === null) fail('missing header record (file is empty)');
  return { keys: header.keys, fields: header.fields, counts: header.counts };
}

/**
 * Read a `knowledge-graph.jsonl` file written by `writeKnowledgeGraph`,
 * validating it as it is read. Throws `KnowledgeGraphFormatError` — never
 * returns a partial graph.
 *
 * @param {string} path
 * @param {{ blockSize?: number }} [options]
 * @returns {object}
 */
export function readKnowledgeGraph(path, { blockSize = DEFAULT_READ_BLOCK_SIZE } = {}) {
  let header = null;
  let lineNo = 0;
  const streams = new Map();
  const coverage = [];

  function fail(message) {
    throw new KnowledgeGraphFormatError(`${path}: ${message} (line ${lineNo})`);
  }

  readLineFile(path, (line) => {
    lineNo += 1;
    let record;
    try {
      record = JSON.parse(line);
    } catch (error) {
      fail(`invalid JSON (${error.message})`);
    }

    if (header === null) {
      checkHeader(record, fail);
      header = record;
      for (const key of header.keys) if (Object.hasOwn(STREAMS, key)) streams.set(key, []);
      return;
    }

    const kind = record !== null && typeof record === 'object' ? record.record : undefined;
    if (kind === 'header') fail('a second header record is not allowed after line 1');
    if (kind === 'coverage') {
      if (!header.keys.includes(COVERAGE_KEY)) fail('coverage record present but the header does not list "coverage"');
      if (!Object.hasOwn(record, 'coverage')) fail('coverage record has no "coverage" value');
      coverage.push(record.coverage);
      return;
    }
    const stream = STREAM_BY_RECORD.get(kind);
    if (!stream) fail(`unknown record type: ${JSON.stringify(kind)}`);
    if (!streams.has(stream.key)) fail(`${kind} record present but the header does not list "${stream.key}"`);
    if (!Object.hasOwn(record, stream.field)) fail(`${kind} record has no "${stream.field}" value`);
    streams.get(stream.key).push(record[stream.field]);
  }, { blockSize });

  if (header === null) fail('missing header record (file is empty)');
  for (const [key, values] of streams) {
    if (values.length !== header.counts[key]) {
      fail(`${key} count mismatch: header declares ${header.counts[key]}, found ${values.length}`);
    }
  }
  const coverageExpected = header.keys.includes(COVERAGE_KEY) ? 1 : 0;
  if (coverage.length !== coverageExpected) {
    fail(`coverage record count mismatch: expected ${coverageExpected}, found ${coverage.length}`);
  }

  // defineProperty, not assignment: keys come from the file, and assigning a
  // key named "__proto__" would replace the object's prototype instead of
  // creating an own property.
  const graph = {};
  for (const key of header.keys) {
    const value = streams.has(key) ? streams.get(key) : key === COVERAGE_KEY ? coverage[0] : header.fields[key];
    Object.defineProperty(graph, key, { value, enumerable: true, writable: true, configurable: true });
  }
  return graph;
}

export default {
  KNOWLEDGE_GRAPH_FILE,
  LEGACY_KNOWLEDGE_GRAPH_FILE,
  KNOWLEDGE_GRAPH_FORMAT,
  KnowledgeGraphFormatError,
  writeKnowledgeGraph,
  writeKnowledgeGraphAtomic,
  readKnowledgeGraph,
  readKnowledgeGraphHeader,
};
