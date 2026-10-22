/**
 * The numbers of the project overview (openspec: changes/viewer-learn, design
 * D3; spec "Project overview"). Each is a product field or a count over a
 * product's entries; nothing is estimated, and a value a node does not record
 * is counted as not recorded, never guessed. Pure functions.
 *   - tiles: the graph's node and edge records, its layers (semantic, else the
 *     graph's own layer records), and its file nodes;
 *   - the nodes with the most edges: every edge record of every type counts once
 *     at each end that is a node of the graph (a self-loop counts as in and out);
 *     ties go by name, then by id;
 *   - complexity: each node's `complexity` field;
 *   - highlights: the `unused` entries of unused-code.json counted by their
 *     `confidence`, and the hotspots files with the highest `score`.
 */

import type { GraphEdge, GraphNode } from '../data/graph';
import type { GraphIndex } from '../data/indexes';
import type { ManifestProduct } from '../data/manifest';
import type { Structure } from './graph-structure';
import { buildLevel } from './graph-structure';
import { topFiles } from './hotspots-charts';
import { buildHash } from './route';

export interface OverviewTiles {
  nodes: number;
  edges: number;
  layers: number;
  files: number;
}

/** The four tiles: node and edge records, layers, file nodes. */
export function overviewTiles(graph: { nodes: readonly GraphNode[]; edges: readonly GraphEdge[] }, index: Pick<GraphIndex, 'semantics'>, structure: Pick<Structure, 'files'>): OverviewTiles {
  return { nodes: graph.nodes.length, edges: graph.edges.length, layers: index.semantics.layers.length, files: structure.files.length };
}

export interface ConnectedNode {
  id: string;
  name: string;
  type: string;
  incoming: number;
  outgoing: number;
  degree: number;
}

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The `n` nodes with the most incoming plus outgoing edges (see the top of this file for what counts and the tie rule). */
export function topConnected(graph: { nodes: readonly GraphNode[]; edges: readonly GraphEdge[] }, n = 5): ConnectedNode[] {
  const byId = new Map<string, ConnectedNode>();
  for (const node of graph.nodes) {
    if (!byId.has(node.id)) byId.set(node.id, { id: node.id, name: node.name, type: node.type, incoming: 0, outgoing: 0, degree: 0 });
  }
  for (const edge of graph.edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (source) {
      source.outgoing += 1;
      source.degree += 1;
    }
    if (target) {
      target.incoming += 1;
      target.degree += 1;
    }
  }
  return [...byId.values()]
    .filter((node) => node.degree > 0)
    .sort((a, b) => b.degree - a.degree || compareText(a.name, b.name) || compareText(a.id, b.id))
    .slice(0, n);
}

export interface CountRow {
  key: string;
  label: string;
  count: number;
}

/** The complexity classes the graph builder writes, in their order. */
export const COMPLEXITY_CLASSES = ['simple', 'moderate', 'complex'] as const;
export const NOT_RECORDED = 'not recorded';

/**
 * The nodes by their `complexity` field: the three classes always (0 is a count), then any other value as written
 * (sorted), then the nodes that record none, when there are any.
 */
export function complexityCounts(nodes: readonly GraphNode[]): CountRow[] {
  const counts = new Map<string, number>();
  let missing = 0;
  for (const node of nodes) {
    const value = node.complexity;
    if (typeof value === 'string' && value !== '') counts.set(value, (counts.get(value) ?? 0) + 1);
    else missing += 1;
  }
  const known = new Set<string>(COMPLEXITY_CLASSES);
  const rows: CountRow[] = COMPLEXITY_CLASSES.map((key) => ({ key, label: key, count: counts.get(key) ?? 0 }));
  for (const key of [...counts.keys()].filter((key) => !known.has(key)).sort(compareText)) rows.push({ key, label: key, count: counts.get(key) as number });
  if (missing > 0) rows.push({ key: '~none', label: NOT_RECORDED, count: missing });
  return rows;
}

export interface LayerRow {
  key: string;
  label: string;
  files: number;
  /** The level a click opens: where the group's card on the top level goes. */
  path: string;
}

/** The groups of the top level (layers, or top-level directories when the graph has none), with their file counts, in the top level's order. */
export function layerRows(structure: Structure): LayerRow[] {
  const top = buildLevel(structure, { path: '' });
  const targets = new Map<string, string>();
  for (const entry of top?.entries ?? []) if (entry.target && entry.id.startsWith('group:')) targets.set(entry.id.slice('group:'.length), entry.target.path);
  const order = new Map((top?.entries ?? []).map((entry, i) => [entry.id, i]));
  return structure.groups
    .map((group) => ({ key: group.key, label: group.label, files: group.files.length, path: targets.get(group.key) ?? group.key }))
    .sort((a, b) => (order.get(`group:${a.key}`) ?? Infinity) - (order.get(`group:${b.key}`) ?? Infinity));
}

/** A product the overview can read: in the page, at this revision or another. */
export const readable = (product: Pick<ManifestProduct, 'status'> | null | undefined) => product?.status === 'included' || product?.status === 'different-revision';

const listOf = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => row !== null && typeof row === 'object') : []);

const CONFIDENCE_ORDER = ['high', 'medium', 'low'];
export const NO_CONFIDENCE = 'no confidence';

export interface UnusedHighlights {
  /** The entries of `unused`. */
  total: number;
  /** The entries by `confidence`: high, medium and low always, then other values as written, then entries with none. */
  byConfidence: CountRow[];
}

/** The unused-code highlights, counted over the product's `unused` entries. */
export function unusedHighlights(product: { unused?: unknown }): UnusedHighlights {
  const rows = listOf(product.unused);
  const counts = new Map<string, number>();
  let none = 0;
  for (const row of rows) {
    if (typeof row.confidence === 'string' && row.confidence !== '') counts.set(row.confidence, (counts.get(row.confidence) ?? 0) + 1);
    else none += 1;
  }
  const byConfidence: CountRow[] = CONFIDENCE_ORDER.map((key) => ({ key, label: key, count: counts.get(key) ?? 0 }));
  for (const key of [...counts.keys()].filter((key) => !CONFIDENCE_ORDER.includes(key)).sort(compareText)) byConfidence.push({ key, label: key, count: counts.get(key) as number });
  if (none > 0) byConfidence.push({ key: '~none', label: NO_CONFIDENCE, count: none });
  return { total: rows.length, byConfidence };
}

export interface HotFile {
  path: string;
  score: number;
  /** The Hotspots page with this file's row open. */
  href: string;
}

/** The hotspots files with the highest scores (ties by path), each with the link that opens its row. */
export function hotspotHighlights(product: { files?: unknown }, n = 3): HotFile[] {
  return topFiles(product.files, n).map((file) => ({ ...file, href: hotspotsRowHref(file.path) }));
}

/** The Hotspots page's Files view with the row of `path` open. */
export const hotspotsRowHref = (path: string) => buildHash('hotspots', { view: 'files', row: path });

/** The Unused code page. */
export const UNUSED_HREF = buildHash('unused');
