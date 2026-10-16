// The page's query engine (artifact-view task 5.2). It lives in the data
// Worker next to the decoder, keeping its own copy of the columns it needs,
// and answers search queries; on the main-thread fallback the page runs the
// same engine over the decoded segments. Pure and DOM-free.
//
// Nothing here is built on the ready path: the name index is built on the
// first name search, and the identifier term index (rebuilt postings, seconds
// and hundreds of MB on a large graph) on the first identifier search.
import { isTable, type Segments, type Table } from '../data';
import { lookupTerm, rebuildPostings, splitIdentifier, type TermIndex } from './postings';
import { buildNameIndex, searchNames, type NameIndex, type NameSearchResult } from './search';
import { GraphEngine, type FileViewResult, type GraphInitResult, type GraphViewResult, type NeighborhoodResult, type NodeEdgesResult } from './graph-model';

export type Query =
  | { op: 'names'; text: string; limit: number }
  | { op: 'identifiers'; text: string; limit: number }
  /** Builds the CSR adjacency on first use (with progress); later calls return at once. */
  | { op: 'graph-init' }
  /** `scope` null: the member level; otherwise a directory. */
  | { op: 'graph-view'; scope: string | null }
  | { op: 'graph-file'; path: string }
  /** `types` null: every edge type. */
  | { op: 'neighborhood'; row: number; hops: number; types: string[] | null }
  | { op: 'node-edges'; row: number };

export type IdentifierSearchResult =
  | { available: false; query: string }
  | {
    available: true;
    query: string;
    /** The query's terms after the source index's own subword split. */
    terms: string[];
    /** Terms with no chunk at all. */
    missingTerms: string[];
    scope: TermIndex['scope'];
    /** Node rows whose chunk holds every term, before the limit. */
    total: number;
    rows: number[];
    /** Matching chunks whose node is not in the graph (counted, never shown as nodes). */
    chunksOutsideGraph: number;
    /** Time spent rebuilding the term index for this query (0 when it was already built). */
    buildMs: number;
  };

export type QueryResult =
  | NameSearchResult
  | IdentifierSearchResult
  | GraphInitResult
  | GraphViewResult
  | FileViewResult
  | NeighborhoodResult
  | NodeEdgesResult;

/** Table columns the engine reads; everything else stays out of its copy. */
const RETAINED: Record<string, string[]> = {
  nodes: ['id', 'name', 'path', 'type'],
  edges: ['src', 'dst', 'type'],
  'index.chunks': ['node', 'idOffset', 'idCount', 'commentOffset', 'commentCount', 'stringOffset', 'stringCount'],
  'index.tokens': ['token'],
  indexLiterals: ['text'],
};
const RETAINED_ARRAYS = ['strings', 'indexLiterals.strings'];

/**
 * The engine's own copy of what it reads, taken in the Worker before the
 * decoded columns are transferred to the page (a transfer detaches them).
 * Plain arrays (the string tables) are shared, not copied: the transfer
 * structured-clones them for the page and leaves the Worker's intact.
 */
export function retainForQueries(segments: Segments): Segments {
  const kept: Segments = {};
  for (const [name, columns] of Object.entries(RETAINED)) {
    const table = segments[name];
    if (!isTable(table)) continue;
    const copy: Table = { rows: table.rows, columns: {} };
    for (const column of columns) if (table.columns[column]) copy.columns[column] = new Int32Array(table.columns[column]);
    kept[name] = copy;
  }
  for (const name of RETAINED_ARRAYS) if (Array.isArray(segments[name])) kept[name] = segments[name];
  return kept;
}

function intersectSorted(a: Int32Array, b: Int32Array): Int32Array {
  const out = new Int32Array(Math.min(a.length, b.length));
  let i = 0;
  let j = 0;
  let n = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out[n++] = a[i];
      i += 1;
      j += 1;
    } else if (a[i] < b[j]) i += 1;
    else j += 1;
  }
  return out.subarray(0, n);
}

export type PostingsState = 'idle' | 'building' | 'ready' | 'unavailable';

export class QueryEngine {
  private names: NameIndex | null = null;
  private terms: TermIndex | null = null;
  private termsState: PostingsState;
  private rowByIdCell: Map<number, number> | null = null;
  private readonly strings: string[];
  private graph: GraphEngine | null = null;

  constructor(private readonly segments: Segments) {
    this.strings = Array.isArray(segments.strings) ? (segments.strings as string[]) : [];
    this.termsState = isTable(segments['index.chunks']) && isTable(segments['index.tokens']) ? 'idle' : 'unavailable';
  }

  get postingsState(): PostingsState {
    return this.termsState;
  }

  run(query: Query, onProgress?: (done: number, total: number) => void, now: () => number = Date.now): QueryResult {
    if (query.op === 'names') {
      this.names ??= buildNameIndex(this.segments, this.strings);
      return searchNames(this.names, query.text, query.limit);
    }
    if (query.op === 'identifiers') return this.identifiers(query.text, query.limit, onProgress, now);
    this.graph ??= new GraphEngine(this.segments, this.strings);
    if (query.op === 'graph-init') return this.graph.init(onProgress, now);
    if (query.op === 'graph-view') return this.graph.graphView(query.scope);
    if (query.op === 'graph-file') return this.graph.fileView(query.path);
    if (query.op === 'neighborhood') return this.graph.neighborhoodView(query.row, query.hops, query.types);
    return this.graph.nodeEdges(query.row);
  }

  private identifiers(text: string, limit: number, onProgress: ((done: number, total: number) => void) | undefined, now: () => number): IdentifierSearchResult {
    if (this.termsState === 'unavailable') return { available: false, query: text };
    let buildMs = 0;
    if (this.terms === null) {
      const started = now();
      this.termsState = 'building';
      this.terms = rebuildPostings(this.segments, this.strings, onProgress);
      buildMs = now() - started;
      if (this.terms === null) {
        this.termsState = 'unavailable';
        return { available: false, query: text };
      }
      this.termsState = 'ready';
    }
    const index = this.terms;
    const terms = [...new Set(splitIdentifier(text))];
    const lists = terms.map((term) => lookupTerm(index, term));
    const missingTerms = terms.filter((_, i) => lists[i].length === 0);
    let chunkRows: Int32Array = new Int32Array(0);
    if (terms.length > 0 && missingTerms.length === 0) {
      chunkRows = [...lists].sort((a, b) => a.length - b.length).reduce((acc, list) => intersectSorted(acc, list));
    }
    const { rows, outside } = this.chunkNodeRows(chunkRows);
    return {
      available: true,
      query: text,
      terms,
      missingTerms,
      scope: index.scope,
      total: rows.length,
      rows: rows.slice(0, Math.max(0, limit)),
      chunksOutsideGraph: outside,
      buildMs,
    };
  }

  /** Node rows of chunk rows, deduplicated, in chunk order, and how many chunks have no node in the graph. */
  private chunkNodeRows(chunkRows: Int32Array): { rows: number[]; outside: number } {
    const chunks = this.segments['index.chunks'] as Table;
    const nodes = this.segments.nodes;
    if (!isTable(nodes)) return { rows: [], outside: chunkRows.length };
    if (this.rowByIdCell === null) {
      this.rowByIdCell = new Map();
      const ids = nodes.columns.id;
      for (let row = 0; row < nodes.rows; row += 1) if (!this.rowByIdCell.has(ids[row])) this.rowByIdCell.set(ids[row], row);
    }
    const seen = new Set<number>();
    const rows: number[] = [];
    let outside = 0;
    for (const chunk of chunkRows) {
      const row = this.rowByIdCell.get(chunks.columns.node[chunk]);
      if (row === undefined) {
        outside += 1;
        continue;
      }
      if (seen.has(row)) continue;
      seen.add(row);
      rows.push(row);
    }
    return { rows, outside };
  }
}
