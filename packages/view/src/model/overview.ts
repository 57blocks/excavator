// Pure derivations for the Overview section: header vs decoded counts, the
// fact-layer freshness banner, the semantic-layer badges and the inventory.
// Every status the bake can record maps to a visible state; an unrecognised
// status is shown verbatim, never dropped.
import type { DecodedCounts, InventoryItem, Meta, Segments } from '../data';
import { summaryCoverage } from './semantics';

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
  /** Summaries only: "<nodes with a summary>/<all nodes>", when the cache is present. */
  summaries?: string;
}

const SEMANTIC = [
  { artifact: 'semantic-cache.json', label: 'Summaries', refresh: '/excavator --mode=full' },
  { artifact: 'semantic-graph.json', label: 'Architecture layers', refresh: '/excavator --mode=full' },
  { artifact: 'domain-graph.json', label: 'Domain flows', refresh: '/excavator-domain' },
] as const;

/**
 * One badge per semantic product. With the decoded segments, the summaries
 * badge counts the graph's nodes that have a cached summary against all of
 * its nodes (task 8.1); without them it falls back to the bake's summary.
 */
export function semanticBadges(meta: Meta, segments?: Segments, totalNodes?: number): SemanticBadge[] {
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
      if (segments && typeof totalNodes === 'number') {
        const c = summaryCoverage(segments, totalNodes);
        const extra = [c.untrusted > 0 ? `${c.untrusted} not trusted` : '', c.notInGraph > 0 ? `${c.notInGraph} for nodes not in this graph` : ''].filter(Boolean);
        const detail = `${c.withSummary} of ${c.total} nodes have a summary; ${c.fresh} fresh, ${c.stale} stale${extra.length > 0 ? `; ${extra.join(', ')}` : ''}`;
        const summaries = `${c.withSummary}/${c.total}`;
        return c.stale > 0 || c.untrusted > 0
          ? { artifact, label, state: 'stale', stateLabel: 'Partly stale', detail, command: `run ${refresh}`, summaries }
          : { artifact, label, state: 'present', stateLabel: 'Present', detail, command: null, summaries };
      }
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

/** Ring center label: the ring sums the coverage record's per-language files, the candidate set. */
export const LANGUAGE_RING_CENTER = 'candidate files';

export const MEMBER_FILES_LABEL = 'files in manifest';
export const MEMBER_SELECTED_LABEL = 'selected';

export interface MemberCard {
  name: string;
  /** Manifest entries under this member. */
  manifestFiles: number | null;
  /** The selection funnel's selected entries under this member; null when not recorded. */
  selectedFiles: number | null;
}

/** Member cards with both counts as the bake recorded them; the two may differ and are never reconciled. */
export function memberCards(meta: Meta): MemberCard[] {
  const num = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);
  return (meta.members ?? []).map((m) => ({ name: m.name, manifestFiles: num(m.files), selectedFiles: num(m.selected) }));
}

export interface LiteralsStatus {
  state: 'embedded' | 'trimmed' | 'omitted' | 'unavailable' | string;
  label: string;
}

/**
 * Whether the source index's comment and string-literal text is in this
 * bundle: embedded, trimmed by the source budget, omitted by --no-source, or
 * unavailable (no source index). The node term view shows this label instead
 * of an empty list.
 */
export function indexLiteralsStatus(meta: Meta): LiteralsStatus {
  const index = meta.index ?? null;
  if (!index) return { state: 'unavailable', label: 'no source index' };
  const state = typeof index.literals === 'string' ? index.literals : 'not-recorded';
  if (state === 'embedded') return { state, label: 'literals embedded' };
  if (state === 'trimmed') return { state, label: 'literals trimmed' };
  if (state === 'omitted') return { state, label: 'literals not embedded (baked with --no-source)' };
  return { state, label: `literals: ${state}` };
}
