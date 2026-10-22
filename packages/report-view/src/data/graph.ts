/**
 * Parses the knowledge-graph payload, `knowledge-graph.jsonl` (openspec:
 * changes/viewer-app, design D3; the record layout is the one
 * skills/excavator/knowledge-graph-store.mjs writes): a `header` record on the
 * first line, then `node`, `edge`, `layer`, `tour` and `gap` records and at
 * most one `coverage` record.
 *
 * Nothing is dropped silently: a line that is not JSON, a record of an unknown
 * type, a record without the fields the page needs, a second header or
 * coverage, and a stream whose record count differs from the header's all
 * land in `problems`.
 */

export const GRAPH_FORMAT = 'excavator-knowledge-graph-lines/1';

export interface GraphNode {
  id: string;
  type: string;
  name: string;
  filePath?: string;
  lineRange?: [number, number];
  owner?: string;
  summary?: string;
  tags?: string[];
  [field: string]: unknown;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
  direction?: string;
  weight?: number;
  [field: string]: unknown;
}

export interface GraphLayer {
  id: string;
  name: string;
  description?: string;
  nodeIds: string[];
  [field: string]: unknown;
}

export interface GraphHeader {
  record: 'header';
  format: string;
  keys: string[];
  fields: Record<string, unknown>;
  counts: Record<string, number>;
}

export interface GraphProblem {
  /** 1-based line of the JSONL text. */
  line: number;
  kind: 'not-json' | 'unknown-record' | 'invalid-record' | 'second-header' | 'second-coverage';
  detail: string;
}

export interface CountMismatch {
  stream: string;
  header: number;
  read: number;
}

export interface ParsedGraph {
  header: GraphHeader;
  nodes: GraphNode[];
  edges: GraphEdge[];
  layers: GraphLayer[];
  tour: unknown[];
  gaps: unknown[];
  coverage: unknown;
  problems: GraphProblem[];
  countMismatches: CountMismatch[];
}

/** Record type to header stream key, as the store writes them. */
const STREAM_OF_RECORD: Record<string, string> = {
  node: 'nodes',
  edge: 'edges',
  layer: 'layers',
  tour: 'tour',
  gap: 'gaps',
};

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string';

function invalidNode(value: unknown): string | null {
  if (!isObject(value)) return 'the node is not an object';
  if (!isString(value.id) || value.id === '') return 'the node has no id';
  if (!isString(value.type)) return 'the node has no type';
  return null;
}

function invalidEdge(value: unknown): string | null {
  if (!isObject(value)) return 'the edge is not an object';
  if (!isString(value.source) || !isString(value.target)) return 'the edge has no source or target';
  if (!isString(value.type)) return 'the edge has no type';
  return null;
}

function invalidLayer(value: unknown): string | null {
  if (!isObject(value)) return 'the layer is not an object';
  if (!isString(value.id)) return 'the layer has no id';
  if (!Array.isArray(value.nodeIds)) return 'the layer has no nodeIds';
  return null;
}

function checkHeader(value: unknown): GraphHeader {
  if (!isObject(value) || value.record !== 'header') throw new Error('the knowledge graph does not start with a header record');
  if (value.format !== GRAPH_FORMAT) throw new Error(`the knowledge graph has format ${JSON.stringify(value.format)}; the page reads ${GRAPH_FORMAT}`);
  if (!isObject(value.counts) || !isObject(value.fields)) throw new Error('the knowledge graph header has no counts or fields');
  return {
    record: 'header',
    format: value.format,
    keys: Array.isArray(value.keys) ? value.keys.filter(isString) : [],
    fields: value.fields,
    counts: value.counts as Record<string, number>,
  };
}

/** Parse a knowledge-graph JSONL text; throws only when the first record is not a usable header. */
export function parseGraphJsonl(text: string): ParsedGraph {
  let header: GraphHeader | null = null;
  const graph: Omit<ParsedGraph, 'header'> = {
    nodes: [],
    edges: [],
    layers: [],
    tour: [],
    gaps: [],
    coverage: null,
    problems: [],
    countMismatches: [],
  };
  const read: Record<string, number> = {};
  let coverageSeen = false;
  const problem = (line: number, kind: GraphProblem['kind'], detail: string) => graph.problems.push({ line, kind, detail });

  // One line at a time, without splitting the whole text into an array first.
  let lineNo = 0;
  let start = 0;
  while (start <= text.length) {
    let end = text.indexOf('\n', start);
    if (end === -1) end = text.length;
    const line = text.slice(start, end);
    start = end + 1;
    lineNo += 1;
    if (line.trim() === '') continue;

    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch (error) {
      if (header === null) throw new Error(`the knowledge graph's first line is not valid JSON: ${(error as Error).message}`);
      problem(lineNo, 'not-json', (error as Error).message);
      continue;
    }
    if (header === null) {
      header = checkHeader(record);
      continue;
    }
    const kind = isObject(record) ? record.record : undefined;
    if (kind === 'header') {
      problem(lineNo, 'second-header', 'a second header record');
      continue;
    }
    if (kind === 'coverage' && isObject(record)) {
      if (coverageSeen) problem(lineNo, 'second-coverage', 'a second coverage record');
      else graph.coverage = record.coverage ?? null;
      coverageSeen = true;
      continue;
    }
    const stream = isString(kind) ? STREAM_OF_RECORD[kind] : undefined;
    if (!stream || !isObject(record)) {
      problem(lineNo, 'unknown-record', `record type ${JSON.stringify(kind)}`);
      continue;
    }
    read[stream] = (read[stream] ?? 0) + 1;
    let invalid: string | null = null;
    if (kind === 'node') {
      invalid = invalidNode(record.node);
      if (!invalid) graph.nodes.push(record.node as GraphNode);
    } else if (kind === 'edge') {
      invalid = invalidEdge(record.edge);
      if (!invalid) graph.edges.push(record.edge as GraphEdge);
    } else if (kind === 'layer') {
      invalid = invalidLayer(record.layer);
      if (!invalid) graph.layers.push(record.layer as GraphLayer);
    } else if (kind === 'tour') {
      graph.tour.push(record.step);
    } else {
      graph.gaps.push(record.gap);
    }
    if (invalid) problem(lineNo, 'invalid-record', invalid);
  }
  if (header === null) throw new Error('the knowledge graph is empty');

  for (const stream of new Set([...Object.keys(header.counts), ...Object.keys(read)])) {
    const expected = header.counts[stream] ?? 0;
    const got = read[stream] ?? 0;
    if (expected !== got) graph.countMismatches.push({ stream, header: expected, read: got });
  }
  return { header, ...graph };
}
