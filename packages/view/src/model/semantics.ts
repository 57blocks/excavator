// The three semantic products as the page shows them (artifact-view tasks
// 8.1-8.3): cached node summaries, architecture layers and relations, and
// domain flows. Freshness is never computed here: the bake (or the drop
// parser) already judged each item with the owners' own rules, and the page
// only reads that verdict. Anything a product names that the graph does not
// hold is counted and labelled, never guessed into place. Pure and DOM-free.
import { isTable, type Meta, type Segments } from '../data';
import { nodeRowIndex } from './node-detail';

export interface SemanticEntry {
  nodeId: string;
  summary: string | null;
  tags: string[];
  model: string | null;
  generatedAt: string | null;
  verification: unknown;
  /** The semantic cache's own verdict: fresh / stale / missing / noncanonical-language. */
  freshness: string;
  inGraph: boolean;
}

export interface SemanticLayer {
  id: string;
  name: string;
  description?: string;
  nodeIds: string[];
}

export interface SemanticRelation {
  id: string;
  type: string;
  source: string;
  target: string;
  description?: string;
  provenance?: string;
}

export interface LayersSegment {
  factDigest: string | null;
  headerFactsDigest: string | null;
  freshness: string;
  contentLanguage?: string | null;
  layers: SemanticLayer[];
  relations: SemanticRelation[];
  gaps?: unknown;
}

export interface DomainNode {
  id: string;
  type: string;
  name?: string;
  summary?: string;
  tags?: string[];
  filePath?: string;
  lineRange?: [number, number];
  nodeIds?: unknown[];
  unresolvedNodeIds?: unknown[];
  provenance?: string;
  domainMeta?: Record<string, unknown>;
}

export interface DomainEdge {
  source: string;
  target: string;
  type: string;
  weight?: number;
  description?: string;
}

export interface DomainSegment {
  freshness: string;
  reason?: string;
  graph: { nodes?: DomainNode[]; edges?: DomainEdge[]; sourceRevision?: string; factDigest?: string } | null;
}

/** How a product's presence reads on the page, from the inventory. */
export type ProductState =
  | { state: 'present' }
  | { state: 'not-generated'; command: string }
  | { state: 'invalid'; reason: string };

const COMMAND = {
  'semantic-cache.json': 'run /excavator --mode=full, or generate on demand in /excavator-chat',
  'semantic-graph.json': 'run /excavator --mode=full',
  'domain-graph.json': 'run /excavator-domain',
} as const;

export function productState(meta: Meta, artifact: keyof typeof COMMAND): ProductState {
  const item = (meta.inventory ?? []).find((i) => i.name === artifact);
  if (!item || item.status === 'missing') return { state: 'not-generated', command: item?.missing ?? `not generated: ${COMMAND[artifact]}` };
  if (item.status !== 'present') return { state: 'invalid', reason: item.reason ?? String(item.status) };
  return { state: 'present' };
}

/** A verdict as a badge: fresh, stale, or the verdict itself (never dropped). */
export function freshnessBadge(freshness: string | null | undefined): { state: 'fresh' | 'stale' | 'invalid'; label: string } {
  if (freshness === 'fresh') return { state: 'fresh', label: 'Fresh' };
  if (freshness === 'stale') return { state: 'stale', label: 'Stale' };
  return { state: 'invalid', label: freshness ? `Not trusted (${freshness})` : 'Freshness not recorded' };
}

// --- summaries (8.1) ---------------------------------------------------------

const entryCache = new WeakMap<object, Map<string, SemanticEntry>>();

/** node id -> cache entry. */
export function semanticEntries(segments: Segments): Map<string, SemanticEntry> {
  const cached = entryCache.get(segments);
  if (cached) return cached;
  const map = new Map<string, SemanticEntry>();
  const semantic = segments.semantic as { entries?: unknown } | undefined;
  if (semantic && Array.isArray(semantic.entries)) {
    for (const raw of semantic.entries as SemanticEntry[]) if (raw && typeof raw.nodeId === 'string') map.set(raw.nodeId, raw);
  }
  entryCache.set(segments, map);
  return map;
}

export type NodeSummary =
  | { state: 'not-generated'; command: string }
  | { state: 'invalid'; reason: string }
  | { state: 'none' }
  | { state: 'entry'; entry: SemanticEntry; badge: ReturnType<typeof freshnessBadge> };

export function nodeSummary(meta: Meta, segments: Segments, nodeId: string): NodeSummary {
  const product = productState(meta, 'semantic-cache.json');
  if (product.state !== 'present') return product;
  const entry = semanticEntries(segments).get(nodeId);
  return entry ? { state: 'entry', entry, badge: freshnessBadge(entry.freshness) } : { state: 'none' };
}

export interface SummaryCoverage {
  /** Cache entries whose node is in this graph. */
  withSummary: number;
  /** Every node in the graph. */
  total: number;
  fresh: number;
  stale: number;
  /** In-graph entries the cache does not trust (missing hash, noncanonical language). */
  untrusted: number;
  /** Entries for node ids this graph does not hold. */
  notInGraph: number;
}

export function summaryCoverage(segments: Segments, totalNodes: number): SummaryCoverage {
  const out: SummaryCoverage = { withSummary: 0, total: totalNodes, fresh: 0, stale: 0, untrusted: 0, notInGraph: 0 };
  for (const entry of semanticEntries(segments).values()) {
    if (!entry.inGraph) {
      out.notInGraph += 1;
      continue;
    }
    out.withSummary += 1;
    if (entry.freshness === 'fresh') out.fresh += 1;
    else if (entry.freshness === 'stale') out.stale += 1;
    else out.untrusted += 1;
  }
  return out;
}

/** A short line for a tooltip, or null when the node has no entry. */
export function summaryTooltip(segments: Segments, nodeId: string): string | null {
  const entry = semanticEntries(segments).get(nodeId);
  if (!entry || typeof entry.summary !== 'string') return null;
  const text = entry.summary.length > 120 ? `${entry.summary.slice(0, 119)}…` : entry.summary;
  return `Summary (${freshnessBadge(entry.freshness).label.toLowerCase()}): ${text}`;
}

// --- layers and relations (8.2) ----------------------------------------------

export const LAYER_SLOTS = 8;
export const UNLAYERED_COLOR_VAR = '--graph-unlayered';

export function layerColorVar(index: number): string {
  return index < LAYER_SLOTS ? `--series-${index + 1}` : '--series-other';
}

export interface LayerRow {
  index: number;
  id: string;
  name: string;
  description: string;
  /** nodeIds the product lists. */
  nodeCount: number;
  /** Of those, ids this graph holds. */
  inGraph: number;
  colorVar: string;
}

export interface LayerModel {
  freshness: ReturnType<typeof freshnessBadge>;
  stale: boolean;
  factDigest: string | null;
  headerFactsDigest: string | null;
  layers: LayerRow[];
  relations: Array<SemanticRelation & { sourceFound: boolean; targetFound: boolean }>;
  /** node id -> indexes of the layers that list it (in layer order). */
  membership: Map<string, number[]>;
  /** Graph nodes no layer lists. */
  unlayered: number;
  /** Graph nodes more than one layer lists. */
  multiLayer: number;
}

const layerCache = new WeakMap<object, LayerModel | null>();

export function layerModel(segments: Segments, strings: string[]): LayerModel | null {
  if (layerCache.has(segments)) return layerCache.get(segments) ?? null;
  const seg = segments.layers as LayersSegment | undefined;
  if (!seg || typeof seg !== 'object' || !Array.isArray(seg.layers)) {
    layerCache.set(segments, null);
    return null;
  }
  const rows = nodeRowIndex(segments, strings);
  const membership = new Map<string, number[]>();
  const layers: LayerRow[] = seg.layers.map((layer, index) => {
    const ids = Array.isArray(layer?.nodeIds) ? layer.nodeIds.filter((id): id is string => typeof id === 'string') : [];
    let inGraph = 0;
    for (const id of ids) {
      if (!rows.has(id)) continue;
      inGraph += 1;
      const list = membership.get(id);
      if (list) {
        if (!list.includes(index)) list.push(index);
      } else membership.set(id, [index]);
    }
    return {
      index,
      id: String(layer?.id ?? `layer ${index + 1}`),
      name: typeof layer?.name === 'string' ? layer.name : String(layer?.id ?? `Layer ${index + 1}`),
      description: typeof layer?.description === 'string' ? layer.description : '',
      nodeCount: ids.length,
      inGraph,
      colorVar: layerColorVar(index),
    };
  });
  const totalNodes = isTable(segments.nodes) ? rows.size : 0;
  let multiLayer = 0;
  for (const list of membership.values()) if (list.length > 1) multiLayer += 1;
  const relations = (Array.isArray(seg.relations) ? seg.relations : []).map((r) => ({
    ...r,
    sourceFound: typeof r?.source === 'string' && rows.has(r.source),
    targetFound: typeof r?.target === 'string' && rows.has(r.target),
  }));
  const model: LayerModel = {
    freshness: freshnessBadge(seg.freshness),
    stale: seg.freshness !== 'fresh',
    factDigest: seg.factDigest ?? null,
    headerFactsDigest: seg.headerFactsDigest ?? null,
    layers,
    relations,
    membership,
    unlayered: totalNodes - membership.size,
    multiLayer,
  };
  layerCache.set(segments, model);
  return model;
}

/** The color a single graph node gets when the graph is colored by layer. */
export function nodeLayerColor(model: LayerModel, nodeId: string): string {
  const list = model.membership.get(nodeId);
  return list && list.length > 0 ? layerColorVar(list[0]) : UNLAYERED_COLOR_VAR;
}

export function nodeLayerNames(model: LayerModel, nodeId: string): string[] {
  return (model.membership.get(nodeId) ?? []).map((i) => model.layers[i].name);
}

// --- domain flows (8.3) ------------------------------------------------------

export interface StepAnchor {
  id: string;
  /** In this graph's JSONL; false: "unanchored", never a guessed substitute. */
  found: boolean;
  /** The domain writer moved this id aside because it did not resolve. */
  writerUnresolved: boolean;
}

export interface FlowStep {
  id: string;
  name: string;
  summary: string;
  /** 1-based position in the flow. */
  order: number;
  weight: number | null;
  filePath: string | null;
  lineRange: [number, number] | null;
  provenance: string | null;
  anchors: StepAnchor[];
}

export interface DomainFlow {
  id: string;
  name: string;
  summary: string;
  entryPoint: string | null;
  steps: FlowStep[];
}

export interface DomainGroup {
  id: string;
  name: string;
  summary: string;
  flows: DomainFlow[];
}

export interface DomainModel {
  freshness: ReturnType<typeof freshnessBadge>;
  stale: boolean;
  reason: string;
  domains: DomainGroup[];
  /** Flows no domain contains. */
  orphanFlows: DomainFlow[];
  /** Steps no flow lists. */
  orphanSteps: FlowStep[];
  counts: { domains: number; flows: number; steps: number; anchors: number; unanchored: number };
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function domainModel(segments: Segments, strings: string[]): DomainModel | null {
  const seg = segments.domain as DomainSegment | undefined;
  if (!seg || typeof seg !== 'object' || !seg.graph || typeof seg.graph !== 'object') return null;
  const rows = nodeRowIndex(segments, strings);
  const nodes = (Array.isArray(seg.graph.nodes) ? seg.graph.nodes : []).filter((n): n is DomainNode => !!n && typeof n.id === 'string');
  const edges = (Array.isArray(seg.graph.edges) ? seg.graph.edges : []).filter((e): e is DomainEdge => !!e && typeof e.source === 'string' && typeof e.target === 'string');
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const counts = { domains: 0, flows: 0, steps: 0, anchors: 0, unanchored: 0 };

  const toStep = (node: DomainNode, order: number, weight: number | null): FlowStep => {
    const anchors: StepAnchor[] = [];
    for (const id of Array.isArray(node.nodeIds) ? node.nodeIds : []) {
      if (typeof id === 'string' && !anchors.some((a) => a.id === id)) anchors.push({ id, found: rows.has(id), writerUnresolved: false });
    }
    for (const id of Array.isArray(node.unresolvedNodeIds) ? node.unresolvedNodeIds : []) {
      if (typeof id === 'string' && !anchors.some((a) => a.id === id)) anchors.push({ id, found: rows.has(id), writerUnresolved: true });
    }
    const range = Array.isArray(node.lineRange) && node.lineRange.length === 2 ? (node.lineRange as [number, number]) : null;
    return {
      id: node.id,
      name: text(node.name) || node.id,
      summary: text(node.summary),
      order,
      weight,
      filePath: typeof node.filePath === 'string' ? node.filePath : null,
      lineRange: range,
      provenance: typeof node.provenance === 'string' ? node.provenance : null,
      anchors,
    };
  };

  const stepsOfFlow = new Map<string, Array<{ step: DomainNode; weight: number | null; at: number }>>();
  const flowsOfDomain = new Map<string, DomainNode[]>();
  const placedSteps = new Set<string>();
  const placedFlows = new Set<string>();
  edges.forEach((edge, at) => {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) return;
    if (edge.type === 'flow_step' && source.type === 'flow' && target.type === 'step') {
      const list = stepsOfFlow.get(source.id) ?? [];
      if (!list.some((s) => s.step.id === target.id)) list.push({ step: target, weight: typeof edge.weight === 'number' ? edge.weight : null, at });
      stepsOfFlow.set(source.id, list);
      placedSteps.add(target.id);
    } else if (edge.type === 'contains_flow' && source.type === 'domain' && target.type === 'flow') {
      const list = flowsOfDomain.get(source.id) ?? [];
      if (!list.some((f) => f.id === target.id)) list.push(target);
      flowsOfDomain.set(source.id, list);
      placedFlows.add(target.id);
    }
  });

  const toFlow = (flow: DomainNode): DomainFlow => {
    // The flow_step weight orders the steps (the domain analyzer's rule);
    // equal or missing weights keep the edge order.
    const listed = [...(stepsOfFlow.get(flow.id) ?? [])].sort((a, b) => {
      const wa = a.weight ?? Number.POSITIVE_INFINITY;
      const wb = b.weight ?? Number.POSITIVE_INFINITY;
      return wa !== wb ? wa - wb : a.at - b.at;
    });
    const meta = flow.domainMeta ?? {};
    return {
      id: flow.id,
      name: text(flow.name) || flow.id,
      summary: text(flow.summary),
      entryPoint: typeof meta.entryPoint === 'string' ? meta.entryPoint : null,
      steps: listed.map((s, i) => toStep(s.step, i + 1, s.weight)),
    };
  };

  const domains: DomainGroup[] = nodes.filter((n) => n.type === 'domain').map((d) => ({
    id: d.id,
    name: text(d.name) || d.id,
    summary: text(d.summary),
    flows: (flowsOfDomain.get(d.id) ?? []).map(toFlow),
  }));
  const orphanFlows = nodes.filter((n) => n.type === 'flow' && !placedFlows.has(n.id)).map(toFlow);
  const orphanSteps = nodes.filter((n) => n.type === 'step' && !placedSteps.has(n.id)).map((n, i) => toStep(n, i + 1, null));

  counts.domains = domains.length;
  const allFlows = [...domains.flatMap((d) => d.flows), ...orphanFlows];
  counts.flows = allFlows.length;
  const allSteps = [...allFlows.flatMap((f) => f.steps), ...orphanSteps];
  counts.steps = allSteps.length;
  for (const step of allSteps) {
    for (const anchor of step.anchors) {
      if (anchor.found) counts.anchors += 1;
      else counts.unanchored += 1;
    }
  }
  return {
    freshness: freshnessBadge(seg.freshness),
    stale: seg.freshness !== 'fresh',
    reason: text(seg.reason),
    domains,
    orphanFlows,
    orphanSteps,
    counts,
  };
}

/** Every flow of the model, domains first, then flows no domain contains. */
export function allFlows(model: DomainModel): DomainFlow[] {
  return [...model.domains.flatMap((d) => d.flows), ...model.orphanFlows];
}

export interface LayerColoring {
  colors: Array<string | null>;
  /** Drawn nodes per layer index (a node counts for its first layer). */
  perLayer: Map<number, number>;
  unlayered: number;
  /** Items that are not one graph node (null ids), never colored. */
  aggregates: number;
}

/** Colors for drawn items: `ids[i]` is the item's graph node id, or null for an aggregate. */
export function layerColoring(model: LayerModel, ids: Array<string | null>): LayerColoring {
  const perLayer = new Map<number, number>();
  let unlayered = 0;
  let aggregates = 0;
  const colors = ids.map((id) => {
    if (id === null) {
      aggregates += 1;
      return null;
    }
    const list = model.membership.get(id);
    if (!list || list.length === 0) {
      unlayered += 1;
      return UNLAYERED_COLOR_VAR;
    }
    perLayer.set(list[0], (perLayer.get(list[0]) ?? 0) + 1);
    return layerColorVar(list[0]);
  });
  return { colors, perLayer, unlayered, aggregates };
}
