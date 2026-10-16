// Where the edges of a graph level's scope went (artifact-view task 7A.1):
// the per-type buckets the GraphEngine fills, their sums, the conservation
// check against the total it counts independently, and the self-report the
// smoke check reads. Pure and DOM-free.

/**
 * Per edge type (indexed like the result's `types`), every edge in a level's
 * scope lands in exactly one of the first six buckets; `total` is counted in
 * a separate pass, so a lost edge shows up as an unbalanced ledger.
 */
export interface EdgeBuckets {
  /** Drawn as (part of) a link between two drawn items, neither of them "more". */
  drawn: number[];
  /** Between two drawn items, past the link limit. */
  cut: number[];
  /** An endpoint folded into the "more" item (drawn as an aggregated link to it, or inside it). */
  collapsed: number[];
  /** Both ends inside one drawn item (a directory or a file), counted on the item. */
  inside: number[];
  /** File level: the other end is the file's own node. */
  fileNode: number[];
  /** The other end is outside the scope (another directory or file, or beyond the hops). */
  outside: number[];
  /** Edges in the scope, counted independently of the buckets. */
  total: number[];
}

export function emptyBuckets(typeCount: number): EdgeBuckets {
  const zeros = () => new Array<number>(typeCount).fill(0);
  return { drawn: zeros(), cut: zeros(), collapsed: zeros(), inside: zeros(), fileNode: zeros(), outside: zeros(), total: zeros() };
}

export interface LedgerSums {
  drawn: number;
  cut: number;
  collapsed: number;
  inside: number;
  fileNode: number;
  outside: number;
  total: number;
  /** drawn + cut + collapsed + inside + fileNode + outside === total. */
  balanced: boolean;
}

const sum = (values: number[]): number => values.reduce((n, c) => n + c, 0);

export function ledgerSums(b: EdgeBuckets): LedgerSums {
  const s = { drawn: sum(b.drawn), cut: sum(b.cut), collapsed: sum(b.collapsed), inside: sum(b.inside), fileNode: sum(b.fileNode), outside: sum(b.outside), total: sum(b.total) };
  return { ...s, balanced: s.drawn + s.cut + s.collapsed + s.inside + s.fileNode + s.outside === s.total };
}

/** The ledger on #root (`data-graph-edges-*`); every attribute null when there is none. */
export function ledgerReport(sums: LedgerSums | null): Record<string, string | number | null> {
  return {
    'data-graph-edges-total': sums ? sums.total : null,
    'data-graph-edges-drawn': sums ? sums.drawn : null,
    'data-graph-edges-cut': sums ? sums.cut : null,
    'data-graph-edges-collapsed': sums ? sums.collapsed : null,
    'data-graph-edges-inside': sums ? sums.inside : null,
    'data-graph-edges-file-node': sums ? sums.fileNode : null,
    'data-graph-edges-outside': sums ? sums.outside : null,
    'data-graph-edges-balanced': sums ? String(sums.balanced) : null,
  };
}

/** Edge type name -> edges of that type in the scope (types with none left out). */
export function bucketTotalsByType(types: string[], b: EdgeBuckets): Map<string, number> {
  const totals = new Map<string, number>();
  types.forEach((type, i) => {
    if (b.total[i] > 0) totals.set(type, b.total[i]);
  });
  return totals;
}

/** Per-hop drawn / total of a neighborhood (`data-neighborhood-hop<d>`), and how many nodes "more" holds. */
export function neighborhoodReport(result: { hopTotals: number[]; hopDrawn: number[]; folded: number } | null): Record<string, string | number | null> {
  return {
    'data-neighborhood-hop1': result && result.hopTotals.length > 1 ? `${result.hopDrawn[1]}/${result.hopTotals[1]}` : null,
    'data-neighborhood-hop2': result && result.hopTotals.length > 2 ? `${result.hopDrawn[2]}/${result.hopTotals[2]}` : null,
    'data-neighborhood-folded': result ? result.folded : null,
  };
}
