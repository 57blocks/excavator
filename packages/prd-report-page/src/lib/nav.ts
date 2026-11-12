import type { Feature } from './types';

/** A group of the left rail: the features of one kind, in chapter order. */
export interface NavGroup {
  kind: string;
  label: string;
  features: Feature[];
}

/** The kinds the page names, in the order the rail lists them; any other kind follows by name. */
const KNOWN_KINDS: readonly { kind: string; label: string }[] = [
  { kind: 'flow', label: 'Flows' },
  { kind: 'automated', label: 'Automated' },
  { kind: 'reference', label: 'Reference' },
];

/** A copy of `features` in chapter order (the sort is stable, so equal chapters keep their order). */
export function byChapter(features: readonly Feature[]): Feature[] {
  return [...features].sort((a, b) => a.chapter - b.chapter);
}

/**
 * The left rail's groups: flow, automated, reference, then every other kind by
 * its name; inside a group the features are in chapter order. Every feature is
 * in exactly one group and a kind with no feature has no group.
 */
export function groupFeatures(features: readonly Feature[]): NavGroup[] {
  const byKind = new Map<string, Feature[]>();
  for (const feature of byChapter(features)) byKind.set(feature.kind, [...(byKind.get(feature.kind) ?? []), feature]);
  const known = KNOWN_KINDS.filter(({ kind }) => byKind.has(kind)).map(({ kind, label }) => ({ kind, label, features: byKind.get(kind) as Feature[] }));
  const knownKinds = new Set(KNOWN_KINDS.map(({ kind }) => kind));
  const others = [...byKind.keys()].filter((kind) => !knownKinds.has(kind)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((kind) => ({ kind, label: kind, features: byKind.get(kind) as Feature[] }));
  return [...known, ...others];
}

/** The features whose id or name contains `query`, without case; a blank query keeps all. The order is kept. */
export function filterNav(features: readonly Feature[], query: string): Feature[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...features];
  return features.filter((feature) => feature.id.toLowerCase().includes(needle) || feature.name.toLowerCase().includes(needle));
}

/** The features before and after `id` in chapter order; null at an end or for an unknown id. */
export function neighbours(features: readonly Feature[], id: string): { previous: Feature | null; next: Feature | null } {
  const ordered = byChapter(features);
  const at = ordered.findIndex((feature) => feature.id === id);
  if (at === -1) return { previous: null, next: null };
  return { previous: ordered[at - 1] ?? null, next: ordered[at + 1] ?? null };
}
