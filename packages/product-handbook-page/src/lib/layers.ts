/** An edge of a diagram, by the ids of its two nodes. */
export interface LayerEdge { from: string; to: string }

/** A node's column (`layer`, from 0) and its place in that column (`order`, from 0). */
export interface LayerNode { id: string; layer: number; order: number }

/**
 * The layered layout of the overview diagrams (openspec change handbook-domain-page, design D3). A depth-first walk, in
 * the input order of the nodes and of the edges, marks as a back edge each edge that closes a cycle; `back` holds their
 * indexes, and they take no part in the layering. Each node's layer is the length of the longest path of the other
 * edges that ends at it. The first layer keeps the input order; every later layer is sorted by the mean order of the
 * nodes its edges come from, ties by the input order. Edges to unknown nodes are ignored. The same input gives the same
 * output.
 */
export function layered(ids: string[], edges: LayerEdge[]): { nodes: LayerNode[]; back: number[] } {
  const known = new Set(ids);
  const input = new Map(ids.map((id, at) => [id, at]));
  const usable = edges.map((edge, at) => ({ ...edge, at })).filter((edge) => known.has(edge.from) && known.has(edge.to));
  const back = new Set<number>();
  const state = new Map<string, 'open' | 'done'>();
  const walk = (id: string): void => {
    state.set(id, 'open');
    for (const edge of usable) {
      if (edge.from !== id) continue;
      const next = state.get(edge.to);
      if (next === 'open') back.add(edge.at);
      else if (next === undefined) walk(edge.to);
    }
    state.set(id, 'done');
  };
  for (const id of ids) if (!state.has(id)) walk(id);
  const forward = usable.filter((edge) => !back.has(edge.at));

  const layer = new Map<string, number>();
  const layerOf = (id: string): number => {
    const known = layer.get(id);
    if (known !== undefined) return known;
    const value = Math.max(0, ...forward.filter((edge) => edge.to === id).map((edge) => layerOf(edge.from) + 1));
    layer.set(id, value);
    return value;
  };
  for (const id of ids) layerOf(id);

  const order = new Map<string, number>();
  const depth = Math.max(0, ...layer.values());
  for (let at = 0; at <= depth; at += 1) {
    const here = ids.filter((id) => layer.get(id) === at);
    const mean = (id: string): number => {
      const from = forward.filter((edge) => edge.to === id).map((edge) => order.get(edge.from) ?? 0);
      return from.length === 0 ? -1 : from.reduce((sum, value) => sum + value, 0) / from.length;
    };
    const sorted = at === 0 ? here : [...here].sort((a, b) => mean(a) - mean(b) || (input.get(a) ?? 0) - (input.get(b) ?? 0));
    sorted.forEach((id, place) => order.set(id, place));
  }
  return { nodes: ids.map((id) => ({ id, layer: layer.get(id) ?? 0, order: order.get(id) ?? 0 })), back: [...back].sort((a, b) => a - b) };
}
