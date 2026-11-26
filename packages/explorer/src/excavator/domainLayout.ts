import type { KnowledgeGraph } from "../core/types";

/**
 * Deterministic layout of the Domain view's overview: domains grouped in bands (business, support, the rest),
 * ordered inside a band by their cross-domain edges, and placed on a uniform grid. No layout engine runs, so
 * the same graph always gives the same picture whatever its node order.
 */

export type BandKind = "business" | "support" | "none";
export interface DomainBand {
  kind: BandKind;
  domainIds: string[];
}

export const BAND_HEADINGS: Record<BandKind, string> = {
  business: "Business domains",
  support: "Support domains",
  none: "Other domains",
};

const BAND_ORDER: BandKind[] = ["business", "support", "none"];

function kindOf(node: { domainMeta?: { kind?: string } }): BandKind {
  const kind = node.domainMeta?.kind;
  return kind === "business" || kind === "support" ? kind : "none";
}

/** Domain bands in display order; a band with no domain is left out. */
export function domainBands(graph: KnowledgeGraph): DomainBand[] {
  const domains = graph.nodes.filter((node) => node.type === "domain");
  const flowCount = new Map<string, number>();
  for (const edge of graph.edges) {
    if (edge.type === "contains_flow") flowCount.set(edge.source, (flowCount.get(edge.source) ?? 0) + 1);
  }
  const cross = graph.edges.filter((edge) => edge.type === "cross_domain");
  const nameOf = new Map(domains.map((node) => [node.id, node.name]));

  const compare = (a: string, b: string): number =>
    (flowCount.get(b) ?? 0) - (flowCount.get(a) ?? 0) ||
    (nameOf.get(a) ?? "").localeCompare(nameOf.get(b) ?? "") ||
    (a < b ? -1 : a > b ? 1 : 0);

  return BAND_ORDER.flatMap((kind) => {
    const ids = domains.filter((node) => kindOf(node) === kind).map((node) => node.id);
    if (ids.length === 0) return [];
    return [{ kind, domainIds: orderBand(ids, cross, compare) }];
  });
}

/** Kahn's algorithm over the band's cross-domain edges (source first); a cycle yields the domain with the fewest unplaced incoming edges. */
function orderBand(
  ids: string[],
  cross: { source: string; target: string }[],
  compare: (a: string, b: string) => number,
): string[] {
  const inBand = new Set(ids);
  // Distinct edges only, no self-loops: a repeated edge must not count twice.
  const seen = new Set<string>();
  const incoming = new Map<string, Set<string>>(ids.map((id) => [id, new Set()]));
  for (const { source, target } of cross) {
    if (source === target || !inBand.has(source) || !inBand.has(target)) continue;
    const key = `${source}\u0000${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    incoming.get(target)!.add(source);
  }

  const placed: string[] = [];
  const remaining = new Set(ids);
  const unplacedIncoming = (id: string) => [...incoming.get(id)!].filter((source) => remaining.has(source)).length;
  while (remaining.size > 0) {
    const candidates = [...remaining].sort(compare);
    const ready = candidates.filter((id) => unplacedIncoming(id) === 0);
    let next: string;
    if (ready.length > 0) {
      next = ready[0];
    } else {
      const fewest = Math.min(...candidates.map(unplacedIncoming));
      next = candidates.find((id) => unplacedIncoming(id) === fewest)!;
    }
    placed.push(next);
    remaining.delete(next);
  }
  return placed;
}

export interface GridOptions {
  columns: number;
  cardWidth: number;
  cardHeight: number;
  gapX: number;
  gapY: number;
  top: number;
}

/** Top-left corners of `count` equal cards on a grid, filled row by row from the left. */
export function gridPositions(count: number, o: GridOptions): { x: number; y: number }[] {
  return Array.from({ length: count }, (_, i) => ({
    x: (i % o.columns) * (o.cardWidth + o.gapX),
    y: o.top + Math.floor(i / o.columns) * (o.cardHeight + o.gapY),
  }));
}
