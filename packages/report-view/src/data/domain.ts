/**
 * The domain graph the domain view draws from (openspec: changes/viewer-app,
 * design D12): the payload the packer inlined (`nodes`, `edges`, `gaps` of
 * `domain-graph.json`), indexed. Nothing is made up here: a flow belongs to a
 * domain only through a `contains_flow` edge, a step to a flow through a
 * `flow_step` edge, and the steps of a flow are in the order of the weights of
 * those edges (ascending, ties by id, a step without a weight last). What the
 * index cannot place or use (a flow in no domain, an edge to a node that is not
 * there) is listed, not dropped.
 */

import type { GraphNode } from './graph';
import type { GraphIndex } from './indexes';

export interface DomainEvidence {
  file: string;
  line?: number;
  source?: string;
}

export interface DomainNode {
  id: string;
  type: string;
  name: string;
  summary?: string;
  tags?: string[];
  complexity?: string;
  domainMeta?: Record<string, unknown>;
  filePath?: string;
  lineRange?: [number, number];
  nodeIds?: string[];
  unresolvedNodeIds?: string[];
  evidence?: DomainEvidence[];
  provenance?: string;
  [field: string]: unknown;
}

export interface DomainEdge {
  source: string;
  target: string;
  type: string;
  direction?: string;
  description?: string;
  weight?: number;
  [field: string]: unknown;
}

export interface DomainPayload {
  nodes: DomainNode[];
  edges: DomainEdge[];
  gaps: unknown[];
  /** The domain graph's `project.description`, when it writes a non-empty one. */
  projectDescription?: string;
}

/** One step of a flow: where it stands in the flow's order, and the `flow_step` weight that put it there (null when the edge has none). */
export interface OrderedStep {
  node: DomainNode;
  /** 1-based place in the flow. */
  position: number;
  weight: number | null;
}

export interface DomainIndex {
  nodesById: Map<string, DomainNode>;
  domains: DomainNode[];
  flows: DomainNode[];
  steps: DomainNode[];
  /** The flows of each domain, in the order the `contains_flow` edges are written. */
  flowsOf: Map<string, DomainNode[]>;
  domainsOfFlow: Map<string, string[]>;
  stepsOf: Map<string, OrderedStep[]>;
  flowsOfStep: Map<string, string[]>;
  crossDomain: DomainEdge[];
  gaps: unknown[];
  /** The flows that no domain contains and the steps that no flow lists: in the graph, and drawn nowhere. */
  unplaced: { flows: DomainNode[]; steps: DomainNode[] };
  /** What in the payload the index could not use, as sentences. */
  problems: string[];
}

const KIND_OF_EDGE: Record<string, [string, string]> = {
  contains_flow: ['domain', 'flow'],
  flow_step: ['flow', 'step'],
  cross_domain: ['domain', 'domain'],
};

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function push<T>(map: Map<string, T[]>, key: string, value: T) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function buildDomainIndex(payload: DomainPayload): DomainIndex {
  const nodesById = new Map<string, DomainNode>();
  const byType: Record<'domain' | 'flow' | 'step', DomainNode[]> = { domain: [], flow: [], step: [] };
  let repeated = 0;
  for (const node of payload.nodes) {
    if (nodesById.has(node.id)) {
      repeated += 1;
      continue;
    }
    nodesById.set(node.id, node);
    if (node.type === 'domain' || node.type === 'flow' || node.type === 'step') byType[node.type].push(node);
  }

  const flowsOf = new Map<string, DomainNode[]>();
  const domainsOfFlow = new Map<string, string[]>();
  const rawSteps = new Map<string, { node: DomainNode; weight: number | null }[]>();
  const flowsOfStep = new Map<string, string[]>();
  const crossDomain: DomainEdge[] = [];
  const seen = new Set<string>();
  let unusable = 0;
  let undrawn = 0;
  for (const edge of payload.edges) {
    const kinds = Object.hasOwn(KIND_OF_EDGE, edge.type) ? KIND_OF_EDGE[edge.type] : null;
    if (!kinds) {
      undrawn += 1;
      continue;
    }
    const from = nodesById.get(edge.source);
    const to = nodesById.get(edge.target);
    if (!from || !to || from.type !== kinds[0] || to.type !== kinds[1]) {
      unusable += 1;
      continue;
    }
    // Length-prefixed, so ids that contain any separator cannot make two pairs one; the first edge of a pair stands. Two cross-domain
    // edges between the same domains with different descriptions are two facts, so the description is part of what makes them one.
    const described = edge.type === 'cross_domain' ? `|${typeof edge.description === 'string' ? edge.description : ''}` : '';
    const key = `${edge.type}|${edge.source.length}:${edge.source}${edge.target}${described}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (edge.type === 'contains_flow') {
      push(flowsOf, from.id, to);
      push(domainsOfFlow, to.id, from.id);
    } else if (edge.type === 'flow_step') {
      push(rawSteps, from.id, { node: to, weight: finite(edge.weight) ? edge.weight : null });
      push(flowsOfStep, to.id, from.id);
    } else crossDomain.push(edge);
  }

  const stepsOf = new Map<string, OrderedStep[]>();
  for (const [flowId, list] of rawSteps) {
    const sorted = [...list].sort((a, b) => {
      if (a.weight !== b.weight) {
        if (a.weight === null) return 1;
        if (b.weight === null) return -1;
        return a.weight - b.weight;
      }
      return compare(a.node.id, b.node.id);
    });
    stepsOf.set(flowId, sorted.map((row, i) => ({ ...row, position: i + 1 })));
  }

  const problems: string[] = [];
  if (repeated > 0) problems.push(`${plural(repeated, 'node id occurs', 'node ids occur')} more than once; the first of each is used.`);
  if (unusable > 0) problems.push(`${plural(unusable, 'edge names', 'edges name')} a node the domain graph does not have or ${unusable === 1 ? 'joins' : 'join'} the wrong kinds of node; ${unusable === 1 ? 'it is' : 'they are'} not drawn.`);
  if (undrawn > 0) problems.push(`${plural(undrawn, 'edge has', 'edges have')} a type the viewer does not draw.`);

  return {
    nodesById,
    domains: byType.domain,
    flows: byType.flow,
    steps: byType.step,
    flowsOf,
    domainsOfFlow,
    stepsOf,
    flowsOfStep,
    crossDomain,
    gaps: payload.gaps,
    unplaced: {
      flows: byType.flow.filter((flow) => !domainsOfFlow.has(flow.id)),
      steps: byType.step.filter((step) => !flowsOfStep.has(step.id)),
    },
    problems,
  };
}

/** How many flows a domain holds and how many steps those flows list (a step in two of its flows counts once). */
export function domainCounts(index: Pick<DomainIndex, 'flowsOf' | 'stepsOf'>, domainId: string): { flows: number; steps: number } {
  const flows = index.flowsOf.get(domainId) ?? [];
  const steps = new Set<string>();
  for (const flow of flows) for (const step of index.stepsOf.get(flow.id) ?? []) steps.add(step.node.id);
  return { flows: flows.length, steps: steps.size };
}

export interface StepAnchors {
  /** The graph nodes the step's `nodeIds` name that the graph has, in the order written. */
  found: GraphNode[];
  /** The ids the graph does not have: `nodeIds` entries that are not nodes, then `unresolvedNodeIds` the Domain skill already set aside. */
  missing: string[];
}

/** Resolve a step's `nodeIds` against the knowledge graph; an id the graph lacks is listed, never dropped. */
export function resolveAnchors(step: Pick<DomainNode, 'nodeIds' | 'unresolvedNodeIds'>, graph: Pick<GraphIndex, 'nodesById'>): StepAnchors {
  const ids = (list: unknown): string[] => (Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string') : []);
  const found: GraphNode[] = [];
  const missing: string[] = [];
  const named = new Set<string>();
  for (const id of ids(step.nodeIds)) {
    if (named.has(id)) continue;
    named.add(id);
    const node = graph.nodesById.get(id);
    if (node) found.push(node);
    else missing.push(id);
  }
  for (const id of ids(step.unresolvedNodeIds)) {
    if (named.has(id)) continue;
    named.add(id);
    missing.push(id);
  }
  return { found, missing };
}
