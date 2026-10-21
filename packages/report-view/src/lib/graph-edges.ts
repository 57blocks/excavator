/**
 * The edges of one level (openspec: changes/viewer-app, design D4; spec
 * "Structure graph"): the graph's edges between two things the level draws,
 * summed by direction and type into one edge with a count. An edge whose end
 * the level does not draw (another cluster, a node with no file) is not drawn
 * and not made up. `contains` is nesting, never a line.
 */

import type { GraphEdge } from '../data/graph';
import type { Level } from './graph-structure';

/** The edge types a level draws by default. */
export const DEFAULT_EDGE_TYPES: ReadonlySet<string> = new Set(['imports', 'calls', 'exports']);

export interface Tally {
  count: number;
  byType: Record<string, number>;
}

/** The edges between two things, as one edge: those that run from `source` to `target`, and those that run back. */
export interface AggregatedEdge {
  id: string;
  source: string;
  target: string;
  forward: Tally;
  /** The edges against the arrow; null when every edge runs from source to target. */
  backward: Tally | null;
  count: number;
}

const tally = (): Tally => ({ count: 0, byType: {} });

function add(into: Tally, type: string) {
  into.count += 1;
  into.byType[type] = (into.byType[type] ?? 0) + 1;
}

/**
 * Sum the edges of `types` that run between two different ends into one edge
 * for each pair of ends, with the count and the count by type of each direction.
 * The edge points the way most of them run (the way the first one ran, on a tie).
 * `endOf` says which drawn thing a node stands in; null leaves the edge out.
 */
export function aggregateEdges(edges: readonly GraphEdge[], endOf: (nodeId: string) => string | null, types: ReadonlySet<string> = DEFAULT_EDGE_TYPES): AggregatedEdge[] {
  const byPair = new Map<string, AggregatedEdge>();
  for (const edge of edges) {
    if (edge.type === 'contains' || !types.has(edge.type)) continue;
    const source = endOf(edge.source);
    const target = endOf(edge.target);
    if (source === null || target === null || source === target) continue;
    // Length-prefixed, so ids that contain the separator cannot make two pairs one.
    const [low, high] = source < target ? [source, target] : [target, source];
    const key = `${low.length}:${low}${high}`;
    let pair = byPair.get(key);
    if (!pair) {
      pair = { id: `edge:${byPair.size}`, source, target, forward: tally(), backward: null, count: 0 };
      byPair.set(key, pair);
    }
    pair.count += 1;
    if (pair.source === source) add(pair.forward, edge.type);
    else add((pair.backward ??= tally()), edge.type);
  }
  return [...byPair.values()].map((pair) => {
    if (!pair.backward || pair.backward.count <= pair.forward.count) return pair;
    return { ...pair, source: pair.target, target: pair.source, forward: pair.backward, backward: pair.forward };
  });
}

/**
 * The drawn thing a node stands in at `level`: the node itself when it is one of
 * the `shown` children of an expanded file, else the entry that holds its file.
 */
export function levelEnds(level: Level, owningFile: ReadonlyMap<string, string>, shown: ReadonlyMap<string, ReadonlySet<string>>): (nodeId: string) => string | null {
  const entryOfFile = new Map<string, string>();
  for (const entry of level.entries) for (const file of entry.members) entryOfFile.set(file.id, entry.id);
  return (nodeId) => {
    const file = owningFile.get(nodeId);
    if (file === undefined) return null;
    if (shown.get(file)?.has(nodeId)) return nodeId;
    return entryOfFile.get(file) ?? null;
  };
}

const typesText = (t: Tally) => {
  const types = Object.entries(t.byType).sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1));
  return types.length === 1 ? `${t.count} ${types[0][0]}` : `${t.count}: ${types.map(([type, n]) => `${n} ${type}`).join(', ')}`;
};

/** What an aggregated edge says: the count and types along the arrow, and when edges also run back, those. */
export function edgeLabel(edge: AggregatedEdge): string {
  return edge.backward ? `${typesText(edge.forward)} / back ${typesText(edge.backward)}` : typesText(edge.forward);
}
