// What the node detail panel reads from the decoded segments on the main
// thread (artifact-view task 6.3): the node's fact fields, its source-index
// chunk terms and evidence rows. Pure and DOM-free.
import { isTable, type Meta, type Segments, type Table } from '../data';
import { indexLiteralsStatus } from './overview';

const rowIndexCache = new WeakMap<object, Map<string, number>>();

/** node id -> first row, built once per decoded bundle. */
export function nodeRowIndex(segments: Segments, strings: string[]): Map<string, number> {
  const cached = rowIndexCache.get(segments);
  if (cached) return cached;
  const index = new Map<string, number>();
  const nodes = segments.nodes;
  if (isTable(nodes) && nodes.columns.id) {
    const ids = nodes.columns.id;
    for (let row = 0; row < nodes.rows; row += 1) {
      const id = ids[row] >= 0 ? strings[ids[row]] : undefined;
      if (typeof id === 'string' && !index.has(id)) index.set(id, row);
    }
  }
  rowIndexCache.set(segments, index);
  return index;
}

/** A cell as display text: a string, a JSON value from `values`, or null when absent / null. */
export function cellValue(segments: Segments, strings: string[], cell: number | undefined): string | null {
  if (cell === undefined || cell === -1 || cell === -2) return null;
  if (cell >= 0) return typeof strings[cell] === 'string' ? strings[cell] : null;
  const values = Array.isArray(segments.values) ? segments.values : [];
  const value = values[-3 - cell];
  return value === undefined ? null : typeof value === 'string' ? value : JSON.stringify(value);
}

export interface NodeFacts {
  id: string | null;
  type: string | null;
  name: string | null;
  path: string | null;
  line0: number;
  line1: number;
  owner: string | null;
  complexity: string | null;
  anchorSource: string | null;
}

export function nodeFacts(segments: Segments, strings: string[], row: number): NodeFacts {
  const nodes = segments.nodes as Table;
  const col = (name: string) => nodes.columns[name]?.[row];
  const str = (name: string) => cellValue(segments, strings, col(name));
  return {
    id: str('id'),
    type: str('type'),
    name: str('name'),
    path: str('path'),
    line0: col('line0') ?? -1,
    line1: col('line1') ?? -1,
    owner: str('owner'),
    complexity: str('complexity'),
    anchorSource: str('anchorSource'),
  };
}

export type ChunkTerms =
  | { state: 'no-index' }
  | { state: 'no-chunk' }
  | {
    state: 'chunk';
    identifiers: string[];
    /** null: the literal text is not embedded (`literals` says why). */
    comments: string[] | null;
    strings: string[] | null;
    literals: { state: string; label: string };
  };

const chunkIndexCache = new WeakMap<object, Map<number, number>>();

/** The source-index chunk of a node (matched by id cell). */
export function chunkTerms(segments: Segments, strings: string[], meta: Meta, row: number): ChunkTerms {
  const chunks = segments['index.chunks'];
  const tokens = segments['index.tokens'];
  const nodes = segments.nodes;
  if (!isTable(chunks) || !isTable(tokens) || !isTable(nodes)) return { state: 'no-index' };
  let byId = chunkIndexCache.get(segments);
  if (!byId) {
    byId = new Map();
    for (let c = 0; c < chunks.rows; c += 1) if (!byId.has(chunks.columns.node[c])) byId.set(chunks.columns.node[c], c);
    chunkIndexCache.set(segments, byId);
  }
  const chunk = byId.get(nodes.columns.id[row]);
  if (chunk === undefined) return { state: 'no-chunk' };
  const c = chunks.columns;
  const identifiers: string[] = [];
  for (let i = c.idOffset[chunk]; i < c.idOffset[chunk] + Math.max(0, c.idCount[chunk]); i += 1) {
    const text = cellValue(segments, strings, tokens.columns.token[i]);
    if (text !== null) identifiers.push(text);
  }
  const literalTable = segments.indexLiterals;
  const literalStrings = Array.isArray(segments['indexLiterals.strings']) ? (segments['indexLiterals.strings'] as string[]) : null;
  const literals = (offset: number, count: number): string[] | null => {
    if (count < 0 || !isTable(literalTable) || literalStrings === null) return null;
    const out: string[] = [];
    for (let i = offset; i < offset + count; i += 1) {
      const cell = literalTable.columns.text[i];
      if (cell >= 0 && typeof literalStrings[cell] === 'string') out.push(literalStrings[cell]);
    }
    return out;
  };
  return {
    state: 'chunk',
    identifiers,
    comments: literals(c.commentOffset[chunk], c.commentCount[chunk]),
    strings: literals(c.stringOffset[chunk], c.stringCount[chunk]),
    literals: indexLiteralsStatus(meta),
  };
}

export interface EvidenceRow {
  row: number;
  file: string | null;
  line: number;
  endLine: number;
  source: string | null;
}

/** An edge's evidence rows (at most `limit`), and how many it has. */
export function edgeEvidence(segments: Segments, strings: string[], edgeRow: number, limit: number): { total: number; rows: EvidenceRow[] } {
  const edges = segments.edges;
  const evidence = segments.evidence;
  if (!isTable(edges) || !isTable(evidence)) return { total: 0, rows: [] };
  const count = Math.max(0, edges.columns.evCount?.[edgeRow] ?? 0);
  const offset = edges.columns.evOffset?.[edgeRow] ?? -1;
  if (offset < 0) return { total: 0, rows: [] };
  const rows: EvidenceRow[] = [];
  for (let r = offset; r < offset + Math.min(count, limit); r += 1) {
    rows.push({
      row: r,
      file: cellValue(segments, strings, evidence.columns.file[r]),
      line: evidence.columns.line[r],
      endLine: evidence.columns.endLine[r],
      source: cellValue(segments, strings, evidence.columns.source[r]),
    });
  }
  return { total: count, rows };
}

/** "file:line" or "file:line-endLine". */
export function evidenceLocation(ev: EvidenceRow): string {
  const at = ev.line >= 0 ? `:${ev.line}${ev.endLine > ev.line ? `-${ev.endLine}` : ''}` : '';
  return `${ev.file ?? '(no file)'}${at}`;
}
