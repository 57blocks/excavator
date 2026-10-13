// Pure derivations for the Overview section: header vs decoded counts, the
// fact-layer freshness banner, the semantic-layer badges and the inventory.
// Every status the bake can record maps to a visible state; an unrecognised
// status is shown verbatim, never dropped.
import type { DecodedCounts, InventoryItem, Meta } from '../data';

export interface CountRow {
  key: string;
  header: number | null;
  decoded: number | null;
  match: boolean;
}

export function countRows(meta: Meta, decoded: DecodedCounts): CountRow[] {
  const header = meta.graph?.counts ?? {};
  const streamed = meta.counts ?? {};
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const rows: CountRow[] = [
    { key: 'nodes', header: num(header.nodes), decoded: decoded.nodes, match: false },
    { key: 'edges', header: num(header.edges), decoded: decoded.edges, match: false },
    { key: 'gaps', header: num(header.gaps), decoded: decoded.gaps, match: false },
    // The header does not count evidence rows; the bake's streamed count stands in.
    { key: 'evidence', header: num(streamed.evidence), decoded: decoded.evidence, match: false },
  ];
  for (const row of rows) row.match = row.header === row.decoded;
  return rows;
}

export interface Banner {
  state: 'fresh' | 'stale' | 'missing' | 'unknown';
  title: string;
  detail: string;
  command: string | null;
  manifestRevision: string | null;
  currentRevision: string | null;
}

export function freshnessBanner(meta: Meta): Banner {
  const f = meta.freshness?.factLayer ?? null;
  const manifestRevision = f?.manifestSourceRevision ?? meta.source?.sourceRevision ?? null;
  const currentRevision = f?.currentSourceRevision ?? null;
  const detail = f?.reason ?? '';
  if (!f) {
    return { state: 'unknown', title: 'Fact-layer freshness was not recorded', detail: 'This bake carries no freshness verdict.', command: null, manifestRevision, currentRevision };
  }
  if (f.status === 'fresh') {
    return { state: 'fresh', title: 'Facts match the source at bake time', detail, command: null, manifestRevision, currentRevision };
  }
  if (f.status === 'stale') {
    return { state: 'stale', title: 'The source changed after this analysis', detail, command: 'run /excavator to refresh', manifestRevision, currentRevision };
  }
  if (f.status === 'missing') {
    return { state: 'missing', title: 'Fact-layer freshness could not be determined', detail, command: 'run /excavator', manifestRevision, currentRevision };
  }
  return { state: 'unknown', title: `Fact-layer status: ${String(f.status)}`, detail, command: null, manifestRevision, currentRevision };
}

export type BadgeState = 'present' | 'stale' | 'not-generated' | 'invalid';

export interface SemanticBadge {
  artifact: string;
  label: string;
  state: BadgeState;
  stateLabel: string;
  detail: string;
  command: string | null;
}

const SEMANTIC = [
  { artifact: 'semantic-cache.json', label: 'Summaries', refresh: '/excavator --mode=full' },
  { artifact: 'semantic-graph.json', label: 'Architecture layers', refresh: '/excavator --mode=full' },
  { artifact: 'domain-graph.json', label: 'Domain flows', refresh: '/excavator-domain' },
] as const;

export function semanticBadges(meta: Meta): SemanticBadge[] {
  const inventory = meta.inventory ?? [];
  return SEMANTIC.map(({ artifact, label, refresh }): SemanticBadge => {
    const item = inventory.find((i) => i.name === artifact);
    if (!item || item.status === 'missing') {
      return {
        artifact, label, state: 'not-generated', stateLabel: 'Not generated',
        detail: item ? '' : 'not listed in the inventory',
        command: item?.missing ?? `run ${refresh}`,
      };
    }
    if (item.status !== 'present') {
      return { artifact, label, state: 'invalid', stateLabel: 'Invalid', detail: item.reason ?? String(item.status), command: `run ${refresh}` };
    }
    const f = meta.freshness ?? {};
    if (artifact === 'semantic-cache.json') {
      const s = f.semanticCache;
      if (!s) return { artifact, label, state: 'present', stateLabel: 'Present', detail: 'no freshness summary recorded', command: null };
      const covered = `${s.entries} summaries for ${s.nodesInGraph} nodes; ${s.fresh} fresh, ${s.stale} stale`;
      return s.stale > 0
        ? { artifact, label, state: 'stale', stateLabel: 'Partly stale', detail: covered, command: `run ${refresh}` }
        : { artifact, label, state: 'present', stateLabel: 'Present', detail: covered, command: null };
    }
    const verdict = artifact === 'semantic-graph.json' ? f.semanticGraph : f.domainGraph;
    if (verdict?.freshness === 'fresh') {
      return { artifact, label, state: 'present', stateLabel: 'Present', detail: 'matches the current facts', command: null };
    }
    const reason = artifact === 'domain-graph.json' ? (f.domainGraph?.reason ?? '') : 'factDigest differs from the graph header';
    return { artifact, label, state: 'stale', stateLabel: verdict ? `Stale (${verdict.freshness})` : 'Stale', detail: reason, command: `run ${refresh}` };
  });
}

export interface InventoryRow {
  name: string;
  required: boolean;
  state: 'present' | 'missing' | 'missing-required' | 'invalid' | string;
  bytes: number | null;
  note: string;
}

export function inventoryRows(meta: Meta): InventoryRow[] {
  return (meta.inventory ?? []).map((item: InventoryItem) => {
    const state = item.status === 'missing' && item.required ? 'missing-required' : item.status;
    const note = item.status === 'missing' ? (item.missing ?? '') : item.status === 'invalid' ? (item.reason ?? '') : '';
    return { name: item.name, required: item.required, state, bytes: typeof item.bytes === 'number' ? item.bytes : null, note };
  });
}
