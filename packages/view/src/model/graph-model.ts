// The graph view's data model (artifact-view tasks 6.2 / 6.3): which items
// the explorer draws at each level, and the neighborhood and edge lists the
// node page reads. Pure and DOM-free; the GraphEngine runs in the data Worker
// (or on the main thread when there is no Worker) and in Node tests. The CSR
// adjacency is built on the first graph query, never on the ready path.
//
// Levels, drilled into one at a time:
// - member (`#/graph`): the top of the path tree (member repositories of a
//   multi-repo target, or the top-level directories) and top-level files.
// - directory (`#/graph/<dir>`): the directory's subdirectories and files.
// - file (`#/graph/file/<path>`): the symbols in one file and the edges
//   between them.
// - symbol (`#/node/<id>`): the nodes within 1-2 hops of one node.
// Every level is capped at MAX_VISIBLE items: past the cap the lightest items
// fold into one "more" item that says how many it holds. A directory chain
// with a single subdirectory and no files is shown as one item
// (`a/b/c`), so no level degenerates into one undivided block.
//
// Every node lands in a visible bucket: an item, the "more" item, the
// no-path item, or (directory level) the outside-the-directory totals; edges
// whose endpoint is not a node are counted, never drawn as if resolved.
import { isTable, type Segments } from '../data';
import { aggregate, buildAdjacency, edgesAt, neighborhood, NO_PATH, type Adjacency } from './adjacency';

/** Hard cap on items drawn at any level. */
export const MAX_VISIBLE = 400;
/** Aggregated links drawn at most (the heaviest first). */
export const MAX_LINKS = 600;
/** Neighborhood nodes drawn at most (breadth-first order). */
export const NEIGHBORHOOD_LIMIT = MAX_VISIBLE;
/** Neighborhood edges drawn at most. */
export const NEIGHBORHOOD_EDGE_LIMIT = 2000;
/** Edges listed per type and direction in the node detail. */
export const DETAIL_EDGES_PER_TYPE = 100;

const OUTSIDE = '\u0000outside';
const MORE = 'more';

export interface DirInfo {
  path: string;
  dirs: string[];
  files: string[];
  /** Nodes anchored anywhere under this directory. */
  nodes: number;
}

export interface PathTree {
  dirs: Map<string, DirInfo>;
  /** Per file path: nodes anchored in the file (the file node included). */
  fileNodes: Map<string, number>;
  /** Per file path: the row of its `file` node, when the graph has one. */
  fileRow: Map<string, number>;
  /** Nodes without a path. */
  noPath: number;
}

export function parentDir(path: string): string {
  const at = path.lastIndexOf('/');
  return at < 0 ? '' : path.slice(0, at);
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The directory tree of every node path ('' is the top). */
export function buildPathTree(paths: Array<string | null>, types: Array<string | null>): PathTree {
  const dirs = new Map<string, DirInfo>([['', { path: '', dirs: [], files: [], nodes: 0 }]]);
  const fileNodes = new Map<string, number>();
  const fileRow = new Map<string, number>();
  let noPath = 0;
  const dirFor = (path: string): DirInfo => {
    let info = dirs.get(path);
    if (info) return info;
    info = { path, dirs: [], files: [], nodes: 0 };
    dirs.set(path, info);
    dirFor(parentDir(path)).dirs.push(path);
    return info;
  };
  for (let row = 0; row < paths.length; row += 1) {
    const path = paths[row];
    if (path === null || path === '') {
      noPath += 1;
      continue;
    }
    if (!fileNodes.has(path)) {
      fileNodes.set(path, 0);
      dirFor(parentDir(path)).files.push(path);
    }
    fileNodes.set(path, (fileNodes.get(path) as number) + 1);
    if (types[row] === 'file' && !fileRow.has(path)) fileRow.set(path, row);
  }
  // A path that is both a file and a directory prefix keeps both roles.
  const total = (info: DirInfo): number => {
    let n = 0;
    for (const file of info.files) n += fileNodes.get(file) as number;
    for (const dir of info.dirs) n += total(dirs.get(dir) as DirInfo);
    info.nodes = n;
    info.dirs.sort(compare);
    info.files.sort(compare);
    return n;
  };
  total(dirs.get('') as DirInfo);
  return { dirs, fileNodes, fileRow, noPath };
}

/** Follow single-subdirectory chains (no files along the way) to their end. */
export function chainEnd(tree: PathTree, path: string): string {
  let at = path;
  for (;;) {
    const info = tree.dirs.get(at);
    if (!info || info.files.length > 0 || info.dirs.length !== 1) return at;
    at = info.dirs[0];
  }
}

function relative(from: string, path: string): string {
  return from === '' ? path : path.slice(from.length + 1);
}

export type ItemKind = 'dir' | 'file' | 'more' | 'nopath';

export interface GraphItem {
  key: string;
  kind: ItemKind;
  /** Directory or file path. */
  path: string;
  label: string;
  /** Nodes the item aggregates. */
  nodes: number;
  /** Edges with both ends inside the item. */
  internal: number;
  /** The file node row (file items with a file node). */
  fileRow?: number;
  /** "more": how many items it holds. */
  folded?: number;
}

/** Items one level below `dir`: compressed subdirectories, then one item per file. */
export function childItems(tree: PathTree, dir: string): GraphItem[] {
  const info = tree.dirs.get(dir);
  if (!info) return [];
  const items: GraphItem[] = info.dirs.map((sub) => {
    const end = chainEnd(tree, sub);
    return { key: `d:${end}`, kind: 'dir', path: end, label: `${relative(dir, end)}/`, nodes: (tree.dirs.get(end) as DirInfo).nodes, internal: 0 };
  });
  for (const file of info.files) {
    const row = tree.fileRow.get(file);
    items.push({ key: `p:${file}`, kind: 'file', path: file, label: relative(dir, file), nodes: tree.fileNodes.get(file) as number, internal: 0, ...(row !== undefined ? { fileRow: row } : {}) });
  }
  return items;
}

/** Keep the MAX_VISIBLE - 1 heaviest items and fold the rest into one "more" item. */
export function capItems(items: GraphItem[], cap = MAX_VISIBLE): { items: GraphItem[]; folded: Set<string> } {
  if (items.length <= cap) return { items, folded: new Set() };
  const sorted = [...items].sort((a, b) => b.nodes - a.nodes || compare(a.key, b.key));
  const kept = sorted.slice(0, cap - 1);
  const rest = sorted.slice(cap - 1);
  const more: GraphItem = {
    key: MORE, kind: 'more', path: '', label: `${rest.length} more`, nodes: rest.reduce((n, i) => n + i.nodes, 0), internal: 0, folded: rest.length,
  };
  return { items: [...kept, more], folded: new Set(rest.map((i) => i.key)) };
}

export interface ViewLink {
  source: number;
  target: number;
  /** Index into `types`. */
  type: number;
  count: number;
}

export type GraphViewResult =
  | { found: false; scope: string }
  | {
    found: true;
    level: 'member' | 'directory';
    /** The directory asked for ('' for the member level). */
    scope: string;
    /** The directory whose children are shown (the scope's chain end). */
    shown: string;
    types: string[];
    items: GraphItem[];
    /** Items before the cap (the "more" item folds the rest). */
    itemsTotal: number;
    links: ViewLink[];
    linksTotal: number;
    /** Edges leaving / entering the shown directory, per type (empty at the top). */
    outsideOut: number[];
    outsideIn: number[];
    unresolvedEdges: number;
  };

export interface NeighborhoodResult {
  found: boolean;
  row: number;
  hops: number;
  types: string[];
  /** Node rows in breadth-first order (the start first), and their distances. */
  rows: number[];
  distance: number[];
  /** Nodes within reach before the limit. */
  total: number;
  /** Flat [edge row, source index, target index, type index] per edge among the drawn nodes. */
  edges: number[];
  edgesTotal: number;
}

export interface EdgeGroup {
  type: string;
  total: number;
  /** Flat [edge row, peer node row] pairs, at most DETAIL_EDGES_PER_TYPE. */
  edges: number[];
}

export interface FileViewResult {
  found: boolean;
  path: string;
  types: string[];
  /** The file's own node row, or -1. */
  fileRow: number;
  /** Rows of the symbols anchored in the file (its file node excluded), in graph order, at most MAX_VISIBLE. */
  rows: number[];
  /** Symbols in the file before the cap. */
  total: number;
  /** Flat [edge row, source index, target index, type index] per edge between drawn symbols. */
  edges: number[];
  edgesTotal: number;
  /** Edges from the file's symbols to nodes outside the file, and into them, per type. */
  outsideOut: number[];
  outsideIn: number[];
}

export interface NodeEdgesResult {
  found: boolean;
  row: number;
  out: EdgeGroup[];
  in: EdgeGroup[];
  /** Edge rows at this node whose other endpoint id is not a node (not in the adjacency). */
  unresolvedOut: number[];
  unresolvedIn: number[];
}

export interface GraphInitResult {
  buildMs: number;
  types: string[];
  nodes: number;
  edges: number;
  unresolvedEdges: number;
}

function cellString(strings: string[], cell: number | undefined): string | null {
  return cell !== undefined && cell >= 0 && typeof strings[cell] === 'string' ? strings[cell] : null;
}

export class GraphEngine {
  private adj: Adjacency | null = null;
  private tree: PathTree | null = null;
  private paths: Array<string | null> | null = null;
  private unresolved: { out: Map<number, number[]>; in: Map<number, number[]> } | null = null;
  private buildMs = 0;

  constructor(private readonly segments: Segments, private readonly strings: string[]) {}

  get built(): boolean {
    return this.adj !== null;
  }

  init(onProgress?: (done: number, total: number) => void, now: () => number = Date.now): GraphInitResult {
    if (this.adj === null) {
      const started = now();
      this.adj = buildAdjacency(this.segments, this.strings, onProgress);
      this.buildMs = now() - started;
    }
    const adj = this.adj;
    return { buildMs: this.buildMs, types: adj.types, nodes: adj.nodeCount, edges: adj.edgeCount, unresolvedEdges: adj.unresolvedEdges };
  }

  private adjacency(): Adjacency {
    this.init();
    return this.adj as Adjacency;
  }

  private nodePaths(): Array<string | null> {
    if (this.paths === null) {
      const nodes = this.segments.nodes;
      const rows = isTable(nodes) ? nodes.rows : 0;
      this.paths = new Array(rows);
      for (let row = 0; row < rows; row += 1) this.paths[row] = cellString(this.strings, isTable(nodes) ? nodes.columns.path?.[row] : undefined);
    }
    return this.paths;
  }

  private pathTree(): PathTree {
    if (this.tree === null) {
      const nodes = this.segments.nodes;
      const paths = this.nodePaths();
      const types = paths.map((_, row) => cellString(this.strings, isTable(nodes) ? nodes.columns.type?.[row] : undefined));
      this.tree = buildPathTree(paths, types);
    }
    return this.tree;
  }

  /** `scope` null: the member level (the top); otherwise the directory level of that directory. */
  graphView(scope: string | null): GraphViewResult {
    const adj = this.adjacency();
    const tree = this.pathTree();
    if (scope !== null && !tree.dirs.has(scope)) return { found: false, scope };
    const shown = chainEnd(tree, scope ?? '');
    const raw = childItems(tree, shown);
    if (scope === null && tree.noPath > 0) raw.push({ key: NO_PATH, kind: 'nopath', path: '', label: NO_PATH, nodes: tree.noPath, internal: 0 });
    const { items, folded } = capItems(raw);

    // path -> item key, memoized per distinct path.
    const dirKey = new Map<string, string>();
    const fileKey = new Map<string, string>();
    for (const item of raw) {
      const key = folded.has(item.key) ? MORE : item.key;
      if (item.kind === 'dir') dirKey.set(item.path, key);
      else if (item.kind === 'file') fileKey.set(item.path, key);
    }
    const inScope = (dir: string) => shown === '' || dir === shown || dir.startsWith(`${shown}/`);
    const memo = new Map<string, string>();
    const keyOf = (path: string | null): string | null => {
      if (path === null || path === '') return scope === null ? NO_PATH : OUTSIDE;
      const hit = memo.get(path);
      if (hit !== undefined) return hit;
      let key = OUTSIDE;
      const direct = fileKey.get(path);
      if (direct !== undefined) key = direct;
      else {
        const dir = parentDir(path);
        if (inScope(dir)) {
          for (let at = dir; ; at = parentDir(at)) {
            const found = dirKey.get(at);
            if (found !== undefined) {
              key = found;
              break;
            }
            if (at === '' || at === shown) break;
          }
        }
      }
      memo.set(path, key);
      return key;
    };
    const agg = aggregate(adj, this.segments, this.strings, keyOf);
    const indexOfKey = new Map(items.map((item, i) => [item.key, i]));
    const groupItem = agg.groups.map((g) => indexOfKey.get(g.key) ?? -1);
    const outsideGroup = agg.groups.findIndex((g) => g.key === OUTSIDE);
    const T = adj.types.length;
    const outsideOut = new Array<number>(T).fill(0);
    const outsideIn = new Array<number>(T).fill(0);
    for (let g = 0; g < agg.groups.length; g += 1) {
      const i = groupItem[g];
      if (i < 0) continue;
      items[i] = { ...items[i], internal: agg.groups[g].internalByType.reduce((n, c) => n + c, 0) };
    }
    const links: ViewLink[] = [];
    for (const link of agg.links) {
      if (link.source === outsideGroup) outsideIn[link.type] += link.count;
      else if (link.target === outsideGroup) outsideOut[link.type] += link.count;
      const s = groupItem[link.source];
      const t = groupItem[link.target];
      if (s >= 0 && t >= 0) links.push({ source: s, target: t, type: link.type, count: link.count });
    }
    links.sort((a, b) => b.count - a.count || a.source - b.source || a.target - b.target || a.type - b.type);
    return {
      found: true,
      level: scope === null ? 'member' : 'directory',
      scope: scope ?? '',
      shown,
      types: adj.types,
      items,
      itemsTotal: raw.length,
      links: links.slice(0, MAX_LINKS),
      linksTotal: links.length,
      outsideOut,
      outsideIn,
      unresolvedEdges: adj.unresolvedEdges,
    };
  }

  /** The symbols of one file (`#/graph/file/<path>`). */
  fileView(path: string): FileViewResult {
    const adj = this.adjacency();
    const tree = this.pathTree();
    const T = adj.types.length;
    const outsideOut = new Array<number>(T).fill(0);
    const outsideIn = new Array<number>(T).fill(0);
    const found = tree.fileNodes.has(path);
    const fileRow = tree.fileRow.get(path) ?? -1;
    const paths = this.nodePaths();
    const all: number[] = [];
    if (found) for (let r = 0; r < paths.length; r += 1) if (paths[r] === path && r !== fileRow) all.push(r);
    const rows = all.slice(0, MAX_VISIBLE);
    const index = new Map(rows.map((r, i) => [r, i]));
    const inFile = (r: number) => r >= 0 && paths[r] === path;
    const edges: number[] = [];
    let edgesTotal = 0;
    for (const r of all) {
      for (const e of edgesAt(adj, r, 'out')) {
        const d = adj.dst[e];
        if (!inFile(d)) {
          outsideOut[adj.type[e]] += 1;
          continue;
        }
        const s = index.get(r);
        const t = index.get(d);
        if (s === undefined || t === undefined) continue;
        edgesTotal += 1;
        if (edges.length / 4 < NEIGHBORHOOD_EDGE_LIMIT) edges.push(e, s, t, adj.type[e]);
      }
      for (const e of edgesAt(adj, r, 'in')) if (!inFile(adj.src[e])) outsideIn[adj.type[e]] += 1;
    }
    return { found, path, types: adj.types, fileRow, rows, total: all.length, edges, edgesTotal, outsideOut, outsideIn };
  }

  private typeIndexes(types: string[] | null): number[] | undefined {
    if (types === null) return undefined;
    const adj = this.adjacency();
    const wanted = new Set(types);
    return adj.types.map((t, i) => (wanted.has(t) ? i : -1)).filter((i) => i >= 0);
  }

  neighborhoodView(row: number, hops: number, types: string[] | null): NeighborhoodResult {
    const adj = this.adjacency();
    const found = row >= 0 && row < adj.nodeCount;
    const typeIdx = this.typeIndexes(types);
    const reach = found ? neighborhood(adj, row, hops, { types: typeIdx }) : new Map<number, number>();
    const rows: number[] = [];
    const distance: number[] = [];
    const index = new Map<number, number>();
    for (const [r, d] of reach) {
      if (rows.length >= NEIGHBORHOOD_LIMIT) break;
      index.set(r, rows.length);
      rows.push(r);
      distance.push(d);
    }
    const edges: number[] = [];
    let edgesTotal = 0;
    for (const r of rows) {
      for (const e of edgesAt(adj, r, 'out', typeIdx)) {
        const t = index.get(adj.dst[e]);
        if (t === undefined) continue;
        edgesTotal += 1;
        if (edges.length / 4 < NEIGHBORHOOD_EDGE_LIMIT) edges.push(e, index.get(r) as number, t, adj.type[e]);
      }
    }
    return { found, row, hops, types: adj.types, rows, distance, total: reach.size, edges, edgesTotal };
  }

  private unresolvedAt(): { out: Map<number, number[]>; in: Map<number, number[]> } {
    if (this.unresolved === null) {
      const adj = this.adjacency();
      const out = new Map<number, number[]>();
      const inn = new Map<number, number[]>();
      if (adj.unresolvedEdges > 0) {
        const nodes = this.segments.nodes;
        const edges = this.segments.edges;
        const rowByIdCell = new Map<number, number>();
        if (isTable(nodes)) for (let r = 0; r < nodes.rows; r += 1) if (!rowByIdCell.has(nodes.columns.id[r])) rowByIdCell.set(nodes.columns.id[r], r);
        if (isTable(edges)) {
          for (let e = 0; e < adj.edgeCount; e += 1) {
            if (adj.src[e] >= 0) continue;
            const s = rowByIdCell.get(edges.columns.src[e]);
            const d = rowByIdCell.get(edges.columns.dst[e]);
            if (s !== undefined) (out.get(s) ?? out.set(s, []).get(s) as number[]).push(e);
            if (d !== undefined) (inn.get(d) ?? inn.set(d, []).get(d) as number[]).push(e);
          }
        }
      }
      this.unresolved = { out, in: inn };
    }
    return this.unresolved;
  }

  nodeEdges(row: number): NodeEdgesResult {
    const adj = this.adjacency();
    const found = row >= 0 && row < adj.nodeCount;
    const groups = (direction: 'out' | 'in'): EdgeGroup[] => {
      if (!found) return [];
      const result: EdgeGroup[] = [];
      for (let t = 0; t < adj.types.length; t += 1) {
        const list = edgesAt(adj, row, direction, [t]);
        if (list.length === 0) continue;
        const edges: number[] = [];
        for (const e of list.subarray(0, DETAIL_EDGES_PER_TYPE)) edges.push(e, direction === 'out' ? adj.dst[e] : adj.src[e]);
        result.push({ type: adj.types[t], total: list.length, edges });
      }
      return result;
    };
    const unresolved = found ? this.unresolvedAt() : null;
    return {
      found,
      row,
      out: groups('out'),
      in: groups('in'),
      unresolvedOut: unresolved?.out.get(row) ?? [],
      unresolvedIn: unresolved?.in.get(row) ?? [],
    };
  }
}
