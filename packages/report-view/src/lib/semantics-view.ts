/**
 * The Overview's numbers about the semantic payload (openspec: changes/
 * viewer-app, design D11; spec "Each product has a visible state"). Verdicts
 * are counted over the entries the page holds, the stale count is the
 * packer's (the page cannot judge freshness), and the layers and summaries are
 * counted over the merged index, so each figure is what the page really shows.
 */

import type { GraphIndex } from '../data/indexes';
import type { SemanticPayload } from '../data/semantics';
import type { ManifestProduct } from '../data/manifest';
import { formatNumber } from './format';

export interface ContradictedNode {
  id: string;
  name: string;
  type: string;
  filePath: string | null;
}

export interface SemanticsStats {
  /** Entries in the payload. */
  entries: number;
  /** Entries the packer left out as not fresh; null when the manifest gives no count. */
  stale: number | null;
  /** The entries by verdict: verified, unverified, contradicted, unchecked, then any other verdict as written. */
  byVerdict: Record<string, number>;
  /** Nodes whose merged summary is shown, from any source. */
  summariesShown: number;
  layers: number;
  layerSource: 'semantic' | 'graph' | 'none';
  /** Nodes whose summary was contradicted, in graph order. */
  contradicted: ContradictedNode[];
}

const FIXED = ['verified', 'unverified', 'contradicted', 'unchecked'];

/** Count a semantic payload and its merge into `index`. */
export function semanticsStats(index: GraphIndex, payload: SemanticPayload, product: ManifestProduct | undefined): SemanticsStats {
  const counts = new Map<string, number>(FIXED.map((key) => [key, 0]));
  for (const entry of payload.entries ?? []) {
    const verdict = typeof entry.verification === 'string' && entry.verification !== '' ? entry.verification : 'unchecked';
    counts.set(verdict, (counts.get(verdict) ?? 0) + 1);
  }
  const extra = [...counts].slice(FIXED.length).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const byVerdict = Object.fromEntries([...[...counts].slice(0, FIXED.length), ...extra]);

  let summariesShown = 0;
  const contradicted: ContradictedNode[] = [];
  for (const [id, merged] of index.semantics.byNode) {
    if (merged.summary !== '') summariesShown += 1;
    if (merged.verification !== 'contradicted') continue;
    const node = index.nodesById.get(id);
    if (node) contradicted.push({ id, name: node.name, type: node.type, filePath: typeof node.filePath === 'string' ? node.filePath : null });
  }
  return {
    entries: (payload.entries ?? []).length,
    stale: typeof product?.counts?.stale === 'number' ? product.counts.stale : null,
    byVerdict,
    summariesShown,
    layers: index.semantics.layers.length,
    layerSource: index.semantics.layerSource,
    contradicted,
  };
}

/** The one line the Products table says about the semantics product. */
export function semanticsDetail(stats: SemanticsStats): string {
  const stale = stats.stale === null ? '' : `; ${formatNumber(stats.stale)} not fresh and left out`;
  return `${formatNumber(stats.entries)} summaries inlined${stale}; ${formatNumber(stats.layers)} layers.`;
}

/** The counts the Overview publishes as `data-xv-count-semantic-*`. */
export function semanticsCounts(stats: SemanticsStats): Record<string, number> {
  const counts: Record<string, number> = {
    'semantic-entries': stats.entries,
    'semantic-layers': stats.layers,
    'summaries-shown': stats.summariesShown,
  };
  if (stats.stale !== null) counts['semantic-stale'] = stats.stale;
  // Only the named verdicts: another verdict's text is not a safe attribute name.
  for (const verdict of FIXED) counts[`semantic-${verdict}`] = stats.byVerdict[verdict] ?? 0;
  return counts;
}
