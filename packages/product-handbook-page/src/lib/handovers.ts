import type { HandoverData } from './types';

/** A hand-over with its place in the list (the map's line of the same number). */
export interface Indexed { index: number; handover: HandoverData }

const indexed = (handovers: readonly HandoverData[], keep: (handover: HandoverData) => boolean): Indexed[] =>
  handovers.flatMap((handover, index) => (keep(handover) ? [{ index, handover }] : []));

/** The hand-overs a domain hands over (it is the `from` end), in list order. */
export const handedOver = (handovers: readonly HandoverData[], id: string): Indexed[] => indexed(handovers, (handover) => handover.from === id);

/** The hand-overs a domain receives (it is the `to` end), in list order. */
export const received = (handovers: readonly HandoverData[], id: string): Indexed[] => indexed(handovers, (handover) => handover.to === id);

/** How many hand-overs a domain hands over and receives. */
export function countsOf(handovers: readonly HandoverData[], id: string): { out: number; in: number } {
  return { out: handedOver(handovers, id).length, in: received(handovers, id).length };
}

/** The `limit` domains with the most hand-overs (handed over plus received), the earlier first on a tie. */
export function busiest(ids: readonly string[], handovers: readonly HandoverData[], limit: number): string[] {
  const total = (id: string): number => { const counts = countsOf(handovers, id); return counts.out + counts.in; };
  return ids.map((id, at) => ({ id, at, total: total(id) })).sort((a, b) => b.total - a.total || a.at - b.at).slice(0, limit).map((entry) => entry.id);
}

/** The distinct domain ids at the other end of `list`, in order of first appearance; `side` is the end that is not the domain. */
export function otherEnds(list: readonly Indexed[], side: 'from' | 'to'): string[] {
  return Array.from(new Set(list.map((entry) => entry.handover[side])));
}

/** `list` grouped by the domain at the other end, the groups in order of first appearance. */
export function groupByOther(list: readonly Indexed[], side: 'from' | 'to'): { other: string; items: Indexed[] }[] {
  return otherEnds(list, side).map((other) => ({ other, items: list.filter((entry) => entry.handover[side] === other) }));
}

/** The hand-overs whose text names the feature chapter `id`. */
export const mentioning = (handovers: readonly HandoverData[], id: string): HandoverData[] => handovers.filter((handover) => handover.features.includes(id));
