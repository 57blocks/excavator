// Compressed sparse row adjacency over the decoded edges, and directory /
// member aggregation (artifact-view task 6.1): the data the graph view's
// neighborhood queries and aggregated level read. Pure and DOM-free, so it
// runs in the data Worker and in Node tests.
//
// Layout: edge types are numbered by their sorted type strings (T types). For
// node row r and type t, the out-edges are
// `outEdges[outOffsets[r * T + t] .. outOffsets[r * T + t + 1])` (edge rows, in
// graph order); in-edges likewise through `inOffsets` / `inEdges`. One flat
// offsets array per direction (nodes * T + 1 entries) keeps a per-type
// neighborhood a single slice.
//
// Edges whose source or target id is not a node row are not in the CSR; they
// are counted in `unresolvedEdges`, never silently dropped.
import { isTable, type Segments } from '../data';

/** Type label for an edge whose type cell is not a string. */
export const UNTYPED = '(untyped)';

export interface Adjacency {
  nodeCount: number;
  edgeCount: number;
  /** Distinct edge types, sorted; an edge's type index points here. */
  types: string[];
  /** Per edge row: source / target node row, or -1 when the id is not a node. */
  src: Int32Array;
  dst: Int32Array;
  /** Per edge row: index into `types`. */
  type: Int32Array;
  outOffsets: Int32Array;
  outEdges: Int32Array;
  inOffsets: Int32Array;
  inEdges: Int32Array;
  /** Edges with a source or target that is not a node row (not in the CSR). */
  unresolvedEdges: number;
  /** Node ids that occur on more than one row (edges resolve to the first). */
  duplicateNodeIds: number;
}

function text(strings: string[], cell: number | undefined): string | null {
  return cell !== undefined && cell >= 0 && typeof strings[cell] === 'string' ? strings[cell] : null;
}

/** Counting-sort CSR for one direction: `from[e]` is the node row the edge is listed under. */
function csr(from: Int32Array, type: Int32Array, nodeCount: number, typeCount: number): { offsets: Int32Array; edges: Int32Array } {
  const offsets = new Int32Array(nodeCount * typeCount + 1);
  for (let e = 0; e < from.length; e += 1) if (from[e] >= 0) offsets[from[e] * typeCount + type[e] + 1] += 1;
  for (let i = 1; i < offsets.length; i += 1) offsets[i] += offsets[i - 1];
  const edges = new Int32Array(offsets[offsets.length - 1]);
  const cursor = offsets.slice(0, offsets.length - 1);
  for (let e = 0; e < from.length; e += 1) {
    if (from[e] < 0) continue;
    edges[cursor[from[e] * typeCount + type[e]]++] = e;
  }
  return { offsets, edges };
}

export function buildAdjacency(segments: Segments, strings: string[]): Adjacency {
  const nodes = segments.nodes;
  const edgesTable = segments.edges;
  const nodeCount = isTable(nodes) ? nodes.rows : 0;
  const edgeCount = isTable(edgesTable) ? edgesTable.rows : 0;

  const rowByIdCell = new Map<number, number>();
  let duplicateNodeIds = 0;
  if (isTable(nodes)) {
    const ids = nodes.columns.id;
    for (let row = 0; row < nodeCount; row += 1) {
      if (rowByIdCell.has(ids[row])) duplicateNodeIds += 1;
      else rowByIdCell.set(ids[row], row);
    }
  }

  const typeCells = isTable(edgesTable) ? edgesTable.columns.type : undefined;
  const typeNames = new Set<string>();
  for (let e = 0; e < edgeCount; e += 1) typeNames.add(text(strings, typeCells?.[e]) ?? UNTYPED);
  const types = [...typeNames].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const typeIndex = new Map(types.map((t, i) => [t, i]));

  const src = new Int32Array(edgeCount);
  const dst = new Int32Array(edgeCount);
  const type = new Int32Array(edgeCount);
  let unresolvedEdges = 0;
  for (let e = 0; e < edgeCount; e += 1) {
    const s = rowByIdCell.get((edgesTable as { columns: Record<string, Int32Array> }).columns.src[e]);
    const d = rowByIdCell.get((edgesTable as { columns: Record<string, Int32Array> }).columns.dst[e]);
    type[e] = typeIndex.get(text(strings, typeCells?.[e]) ?? UNTYPED) as number;
    if (s === undefined || d === undefined) {
      src[e] = -1;
      dst[e] = -1;
      unresolvedEdges += 1;
    } else {
      src[e] = s;
      dst[e] = d;
    }
  }

  const out = csr(src, type, nodeCount, types.length);
  const inn = csr(dst, type, nodeCount, types.length);
  return {
    nodeCount, edgeCount, types, src, dst, type,
    outOffsets: out.offsets, outEdges: out.edges, inOffsets: inn.offsets, inEdges: inn.edges,
    unresolvedEdges, duplicateNodeIds,
  };
}

/**
 * Edge rows at a node in one direction, restricted to the given type indexes
 * (all types when `types` is omitted); grouped by type, graph order within a type.
 */
export function edgesAt(adj: Adjacency, row: number, direction: 'out' | 'in', types?: Iterable<number>): Int32Array {
  const T = adj.types.length;
  if (row < 0 || row >= adj.nodeCount || T === 0) return new Int32Array(0);
  const offsets = direction === 'out' ? adj.outOffsets : adj.inOffsets;
  const edges = direction === 'out' ? adj.outEdges : adj.inEdges;
  if (types === undefined) return edges.slice(offsets[row * T], offsets[row * T + T]);
  const parts: Int32Array[] = [];
  for (const t of [...new Set(types)].sort((a, b) => a - b)) {
    if (t >= 0 && t < T) parts.push(edges.subarray(offsets[row * T + t], offsets[row * T + t + 1]));
  }
  const result = new Int32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    result.set(part, at);
    at += part.length;
  }
  return result;
}

/**
 * Nodes within `hops` of `row` following edges in either direction (or the
 * given one), restricted to the given types: node row -> distance, in
 * breadth-first order. The start node is at distance 0.
 */
export function neighborhood(adj: Adjacency, row: number, hops: number, options: { direction?: 'out' | 'in' | 'both'; types?: Iterable<number> } = {}): Map<number, number> {
  const distance = new Map<number, number>();
  if (row < 0 || row >= adj.nodeCount) return distance;
  const direction = options.direction ?? 'both';
  const types = options.types === undefined ? undefined : [...options.types];
  distance.set(row, 0);
  let frontier = [row];
  for (let hop = 1; hop <= hops && frontier.length > 0; hop += 1) {
    const next: number[] = [];
    const visit = (other: number) => {
      if (!distance.has(other)) {
        distance.set(other, hop);
        next.push(other);
      }
    };
    for (const at of frontier) {
      if (direction !== 'in') for (const e of edgesAt(adj, at, 'out', types)) visit(adj.dst[e]);
      if (direction !== 'out') for (const e of edgesAt(adj, at, 'in', types)) visit(adj.src[e]);
    }
    frontier = next;
  }
  return distance;
}

/** A node's directory: the path without its last segment ('.' at the root). */
export function directoryOf(path: string | null): string | null {
  if (path === null) return null;
  const at = path.lastIndexOf('/');
  return at < 0 ? '.' : path.slice(0, at);
}

/** A node's member repository: the first path segment ('.' for a root-level path). */
export function memberOf(path: string | null): string | null {
  if (path === null) return null;
  const at = path.indexOf('/');
  return at < 0 ? '.' : path.slice(0, at);
}

/** Group key for nodes without a path. */
export const NO_PATH = '(no path)';

export interface AggregateGroup {
  key: string;
  nodes: number;
  /** Per edge type: edges from this group to another group. */
  outByType: Int32Array;
  /** Per edge type: edges from another group into this one. */
  inByType: Int32Array;
  /** Per edge type: edges with both ends in this group. */
  internalByType: Int32Array;
}

export interface AggregateLink {
  source: number;
  target: number;
  type: number;
  count: number;
}

export interface Aggregate {
  types: string[];
  /** Groups sorted by key. */
  groups: AggregateGroup[];
  /** Per node row: its group index. */
  groupOf: Int32Array;
  /** Cross-group edges by (source group, target group, type), sorted in that order. */
  links: AggregateLink[];
  /** Edges not counted anywhere because an endpoint is not a node (same as the adjacency's). */
  unresolvedEdges: number;
}

/**
 * Aggregate nodes and edges by a key of the node's path (`directoryOf`,
 * `memberOf`). Nodes without a path form the NO_PATH group.
 */
export function aggregate(adj: Adjacency, segments: Segments, strings: string[], keyOf: (path: string | null) => string | null): Aggregate {
  const nodes = segments.nodes;
  const T = adj.types.length;
  const keys: string[] = new Array(adj.nodeCount);
  for (let row = 0; row < adj.nodeCount; row += 1) {
    const path = isTable(nodes) ? text(strings, nodes.columns.path?.[row]) : null;
    keys[row] = keyOf(path) ?? NO_PATH;
  }
  const sortedKeys = [...new Set(keys)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const indexOf = new Map(sortedKeys.map((k, i) => [k, i]));
  const groups: AggregateGroup[] = sortedKeys.map((key) => ({
    key, nodes: 0, outByType: new Int32Array(T), inByType: new Int32Array(T), internalByType: new Int32Array(T),
  }));
  const groupOf = new Int32Array(adj.nodeCount);
  for (let row = 0; row < adj.nodeCount; row += 1) {
    groupOf[row] = indexOf.get(keys[row]) as number;
    groups[groupOf[row]].nodes += 1;
  }
  const linkCounts = new Map<number, number>();
  const G = groups.length;
  for (let e = 0; e < adj.edgeCount; e += 1) {
    if (adj.src[e] < 0) continue;
    const a = groupOf[adj.src[e]];
    const b = groupOf[adj.dst[e]];
    const t = adj.type[e];
    if (a === b) {
      groups[a].internalByType[t] += 1;
      continue;
    }
    groups[a].outByType[t] += 1;
    groups[b].inByType[t] += 1;
    const key = (a * G + b) * T + t;
    linkCounts.set(key, (linkCounts.get(key) ?? 0) + 1);
  }
  const links = [...linkCounts.entries()]
    .sort((x, y) => x[0] - y[0])
    .map(([key, count]) => ({ source: Math.floor(key / T / G), target: Math.floor(key / T) % G, type: key % T, count }));
  return { types: adj.types, groups, groupOf, links, unresolvedEdges: adj.unresolvedEdges };
}
