/**
 * graph-lines.mjs
 *
 * Reads `knowledge-graph.jsonl` one line at a time into interned Int32
 * columns (openspec change `artifact-view`, design D3/D4). The graph is never
 * materialized as an object graph and never held as one string: memory grows
 * with the columns and the string table only. Pure: the caller supplies the
 * lines (the bake from Node's readline, the page from a dropped File), so the
 * bake and a dropped directory apply the same rules.
 *
 * Validation follows the graph store's read contract
 * (`knowledge-graph-store.mjs`): line 1 must be a header with the store's
 * format; every record type must be known and belong to a stream the header
 * lists; a second header fails; per-stream record counts must equal the
 * header's `counts`. Every failure throws the error `makeError` builds (the
 * bake passes the store's own `KnowledgeGraphFormatError`).
 *
 * Fields the columns do not carry are never dropped silently: each unknown
 * key is counted per record kind in `unembedded`, and each value a column
 * could not represent (a non-integer line number) is counted in `anomalies`.
 */

import { Int32Builder, table } from '../bundle-codec.mjs';
import { KNOWLEDGE_GRAPH_FORMAT } from './formats.mjs';

export class GraphLinesError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'KnowledgeGraphFormatError';
  }
}

const STREAM_BY_RECORD = Object.freeze({
  node: { key: 'nodes', field: 'node' },
  edge: { key: 'edges', field: 'edge' },
  layer: { key: 'layers', field: 'layer' },
  tour: { key: 'tour', field: 'step' },
  gap: { key: 'gaps', field: 'gap' },
});
const KNOWN_STREAMS = new Set(Object.values(STREAM_BY_RECORD).map((s) => s.key));

export const NODE_COLUMNS = Object.freeze([
  'id', 'type', 'name', 'path', 'line0', 'line1', 'owner', 'complexity', 'anchorSource', 'summary', 'tagOffset', 'tagCount',
]);
const NODE_KEYS = new Set(['id', 'type', 'name', 'filePath', 'lineRange', 'owner', 'complexity', 'anchorSource', 'summary', 'tags']);

export const EDGE_COLUMNS = Object.freeze([
  'src', 'dst', 'type', 'direction', 'weight', 'provenance', 'evCount', 'evOffset',
]);
const EDGE_KEYS = new Set(['source', 'target', 'type', 'direction', 'weight', 'provenance', 'evidence']);

export const EVIDENCE_COLUMNS = Object.freeze(['file', 'line', 'endLine', 'source', 'token', 'context', 'resolution']);
const EVIDENCE_KEYS = new Set(EVIDENCE_COLUMNS);

/** @param {string[]} names */
function builders(names) {
  return Object.fromEntries(names.map((name) => [name, new Int32Builder()]));
}

/** @param {Record<string, Int32Builder>} cols */
function finishTable(cols) {
  const entries = Object.entries(cols).map(([name, b]) => [name, b.finish()]);
  return table(entries[0][1].length, Object.fromEntries(entries));
}

/**
 * @param {import('../bundle-codec.mjs').Interner} interner
 * @param {{ source: string, makeError?: (message: string) => Error }} options
 *   `source` names the file in error messages
 */
export function createGraphReader(interner, { source, makeError = (message) => new GraphLinesError(message) }) {
  /** @type {any} */
  let header = null;
  let lineNo = 0;
  const seen = { nodes: 0, edges: 0, layers: 0, tour: 0, gaps: 0 };
  let coverageRecords = 0;
  let coverage;
  const gaps = [];
  const layers = [];
  const tour = [];
  const nodes = builders(NODE_COLUMNS);
  const nodeTags = builders(['tag']);
  const edges = builders(EDGE_COLUMNS);
  const evidence = builders(EVIDENCE_COLUMNS);
  /** @type {Record<string, Record<string, number>>} */
  const unembedded = { node: {}, edge: {}, evidence: {} };
  /** @type {Record<string, number>} */
  const anomalies = {};

  /** @param {string} message */
  const fail = (message) => {
    throw makeError(`${source}: ${message} (line ${lineNo})`);
  };
  /** @param {string} kind @param {object} value @param {Set<string>} known */
  const noteUnknown = (kind, value, known) => {
    for (const key of Object.keys(value)) {
      if (!known.has(key)) unembedded[kind][key] = (unembedded[kind][key] ?? 0) + 1;
    }
  };
  /** @param {unknown} value @param {string} where */
  const int = (value, where) => {
    if (value === undefined || value === null) return -1;
    if (Number.isInteger(value) && /** @type {number} */ (value) >= -1 && /** @type {number} */ (value) <= 0x7fffffff) {
      return /** @type {number} */ (value);
    }
    anomalies[where] = (anomalies[where] ?? 0) + 1;
    return -1;
  };

  /** @param {any} node */
  const addNode = (node) => {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) fail('node record value is not an object');
    noteUnknown('node', node, NODE_KEYS);
    nodes.id.push(interner.cell(node.id));
    nodes.type.push(interner.cell(node.type));
    nodes.name.push(interner.cell(node.name));
    nodes.path.push(interner.cell(node.filePath));
    const range = Array.isArray(node.lineRange) ? node.lineRange : null;
    if (node.lineRange !== undefined && (!range || range.length !== 2)) anomalies['node.lineRange'] = (anomalies['node.lineRange'] ?? 0) + 1;
    nodes.line0.push(range ? int(range[0], 'node.lineRange') : -1);
    nodes.line1.push(range ? int(range[1], 'node.lineRange') : -1);
    nodes.owner.push(interner.cell(node.owner));
    nodes.complexity.push(interner.cell(node.complexity));
    nodes.anchorSource.push(interner.cell(node.anchorSource));
    nodes.summary.push(interner.cell(node.summary));
    nodes.tagOffset.push(nodeTags.tag.length);
    const tags = Array.isArray(node.tags) ? node.tags : [];
    if (node.tags !== undefined && !Array.isArray(node.tags)) anomalies['node.tags'] = (anomalies['node.tags'] ?? 0) + 1;
    for (const tag of tags) nodeTags.tag.push(interner.cell(tag));
    nodes.tagCount.push(tags.length);
  };

  /** @param {any} edge */
  const addEdge = (edge) => {
    if (edge === null || typeof edge !== 'object' || Array.isArray(edge)) fail('edge record value is not an object');
    noteUnknown('edge', edge, EDGE_KEYS);
    edges.src.push(interner.cell(edge.source));
    edges.dst.push(interner.cell(edge.target));
    edges.type.push(interner.cell(edge.type));
    edges.direction.push(interner.cell(edge.direction));
    edges.weight.push(interner.cell(edge.weight));
    edges.provenance.push(interner.cell(edge.provenance));
    const items = Array.isArray(edge.evidence) ? edge.evidence : [];
    if (edge.evidence !== undefined && !Array.isArray(edge.evidence)) anomalies['edge.evidence'] = (anomalies['edge.evidence'] ?? 0) + 1;
    edges.evOffset.push(evidence.file.length);
    edges.evCount.push(items.length);
    for (const ev of items) {
      const item = ev !== null && typeof ev === 'object' ? ev : {};
      if (item !== ev) anomalies['edge.evidence[]'] = (anomalies['edge.evidence[]'] ?? 0) + 1;
      noteUnknown('evidence', item, EVIDENCE_KEYS);
      evidence.file.push(interner.cell(item.file));
      evidence.line.push(int(item.line, 'evidence.line'));
      evidence.endLine.push(int(item.endLine, 'evidence.endLine'));
      evidence.source.push(interner.cell(item.source));
      evidence.token.push(interner.cell(item.token));
      evidence.context.push(interner.cell(item.context));
      evidence.resolution.push(interner.cell(item.resolution));
    }
  };

  /** @param {string} line one line of the file, without its line break */
  const read = (line) => {
    lineNo += 1;
    if (line.length === 0) return;
    let record;
    try {
      record = JSON.parse(line);
    } catch (error) {
      fail(`invalid JSON (${/** @type {Error} */ (error).message})`);
    }
    if (header === null) {
      if (record === null || typeof record !== 'object' || record.record !== 'header' || record.format !== KNOWLEDGE_GRAPH_FORMAT) {
        fail(`expected the first line to be a header record with format "${KNOWLEDGE_GRAPH_FORMAT}"`);
      }
      if (!Array.isArray(record.keys) || record.fields === null || typeof record.fields !== 'object'
        || record.counts === null || typeof record.counts !== 'object') {
        fail('header must carry "keys" (array), "fields" (object) and "counts" (object)');
      }
      for (const key of record.keys) {
        if (KNOWN_STREAMS.has(key) && (!Number.isInteger(record.counts[key]) || record.counts[key] < 0)) {
          fail(`header count for "${key}" must be a non-negative integer`);
        }
      }
      header = record;
      return;
    }
    const kind = record !== null && typeof record === 'object' ? record.record : undefined;
    if (kind === 'header') fail('a second header record is not allowed after line 1');
    if (kind === 'coverage') {
      if (!header.keys.includes('coverage')) fail('coverage record present but the header does not list "coverage"');
      coverageRecords += 1;
      coverage = record.coverage;
      return;
    }
    const stream = Object.hasOwn(STREAM_BY_RECORD, kind) ? STREAM_BY_RECORD[kind] : undefined;
    if (!stream) fail(`unknown record type: ${JSON.stringify(kind)}`);
    if (!header.keys.includes(stream.key)) fail(`${kind} record present but the header does not list "${stream.key}"`);
    if (!Object.hasOwn(record, stream.field)) fail(`${kind} record has no "${stream.field}" value`);
    seen[stream.key] += 1;
    const value = record[stream.field];
    if (kind === 'node') addNode(value);
    else if (kind === 'edge') addEdge(value);
    else if (kind === 'gap') gaps.push(value);
    else if (kind === 'layer') layers.push(value);
    else tour.push(value);
  };

  const finish = () => {
    if (header === null) fail('missing header record (file is empty)');
    for (const key of header.keys) {
      if (KNOWN_STREAMS.has(key) && seen[key] !== header.counts[key]) {
        fail(`${key} count mismatch: header declares ${header.counts[key]}, found ${seen[key]}`);
      }
    }
    const coverageExpected = header.keys.includes('coverage') ? 1 : 0;
    if (coverageRecords !== coverageExpected) {
      fail(`coverage record count mismatch: expected ${coverageExpected}, found ${coverageRecords}`);
    }

    return {
      header: { keys: header.keys, fields: header.fields, counts: header.counts },
      nodes: finishTable(nodes),
      nodeTags: finishTable(nodeTags),
      edges: finishTable(edges),
      evidence: finishTable(evidence),
      coverage: coverage ?? null,
      gaps,
      layers,
      tour,
      counts: { ...seen, evidence: evidence.file.length },
      unembedded,
      anomalies,
    };
  };
  return { line: read, finish };
}
