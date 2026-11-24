import type { GraphNode, KnowledgeGraph } from "../core/types";

/**
 * The levels inside one domain of the Domain view: the feature groups the packer wrote (`feature-groups.json`), the
 * flows of a group as swimlane rows, and where a flow or step sits in them. Pure; no layout and no React.
 */

const FORMAT_PREFIX = "excavator-view-feature-groups/";

export interface GroupFlow {
  id: string;
  rule: string;
  scope: string | null;
  origin: string | null;
}

export interface FeatureGroup {
  id: string;
  kind: string;
  label: string;
  /** The caller file suffix that tells a client group from others with the same label; null for the rest. */
  qualifier: string | null;
  file: string | null;
  flows: GroupFlow[];
}

export type FeatureGroups = { state: "ready"; domains: Record<string, FeatureGroup[]> } | { state: "missing"; reason: string };

export const ALL_FLOWS_GROUP_ID = "all";
export const ALL_FLOWS_LABEL = "All flows";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const stringOrNull = (value: unknown): value is string | null => value === null || typeof value === "string";

function isGroupFlow(value: unknown): value is GroupFlow {
  return isRecord(value) && typeof value.id === "string" && typeof value.rule === "string" && stringOrNull(value.scope) && stringOrNull(value.origin);
}

/** A group as the packer wrote it; a missing qualifier is null. */
function isGroup(value: unknown): value is Omit<FeatureGroup, "qualifier"> & { qualifier?: string | null } {
  return (
    isRecord(value) &&
    (value.qualifier === undefined || stringOrNull(value.qualifier)) &&
    typeof value.id === "string" &&
    typeof value.kind === "string" &&
    typeof value.label === "string" &&
    stringOrNull(value.file) &&
    Array.isArray(value.flows) &&
    value.flows.every(isGroupFlow)
  );
}

/** The packed groups, or the reason they cannot be used (the page then shows each domain's flows as one group). */
export function readFeatureGroups(value: unknown): FeatureGroups {
  if (value === undefined || value === null) return { state: "missing", reason: "the page holds no feature-groups.json" };
  if (!isRecord(value)) return { state: "missing", reason: "feature-groups.json is not an object" };
  if (typeof value.format !== "string" || !value.format.startsWith(FORMAT_PREFIX)) {
    return { state: "missing", reason: "feature-groups.json is not a feature groups file" };
  }
  if (!isRecord(value.domains)) return { state: "missing", reason: "feature-groups.json has no domains table" };
  for (const groups of Object.values(value.domains)) {
    if (!Array.isArray(groups) || !groups.every(isGroup)) return { state: "missing", reason: "feature-groups.json has a group that is not in the expected shape" };
  }
  const domains: Record<string, FeatureGroup[]> = {};
  for (const [id, groups] of Object.entries(value.domains)) {
    domains[id] = (groups as (Omit<FeatureGroup, "qualifier"> & { qualifier?: string | null })[]).map((group) => ({ ...group, qualifier: group.qualifier ?? null }));
  }
  return { state: "ready", domains };
}

/** The flows a domain contains, in graph order. */
export function flowIdsOf(domainGraph: KnowledgeGraph, domainId: string): string[] {
  return domainGraph.edges.filter((edge) => edge.type === "contains_flow" && edge.source === domainId).map((edge) => edge.target);
}

/** The domain's groups; one group with all its flows when the groups are missing or do not list the domain. */
export function groupsOf(groups: FeatureGroups, domainGraph: KnowledgeGraph, domainId: string): FeatureGroup[] {
  if (groups.state === "ready" && Object.prototype.hasOwnProperty.call(groups.domains, domainId)) return groups.domains[domainId];
  return [
    {
      id: ALL_FLOWS_GROUP_ID,
      kind: "other",
      label: ALL_FLOWS_LABEL,
      qualifier: null,
      file: null,
      flows: flowIdsOf(domainGraph, domainId).map((id) => ({ id, rule: "none", scope: null, origin: null })),
    },
  ];
}

/** Whether `groupsOf` gives the domain's own groups (false: the one all-flows group stands in). */
export function hasGroupsFor(groups: FeatureGroups, domainId: string): boolean {
  return groups.state === "ready" && Object.prototype.hasOwnProperty.call(groups.domains, domainId);
}

export const groupHoldingFlow = (groups: FeatureGroup[], flowId: string): FeatureGroup | null =>
  groups.find((group) => group.flows.some((flow) => flow.id === flowId)) ?? null;

export interface LaneRow {
  flowId: string;
  steps: string[];
}

const ROUTE = /^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\/\S*|^\/\S*/i;
const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** A flow's sort key: its route when its entry point names one, else its entry type and entry point text. */
function entryKey(node: GraphNode): string {
  const point = (node.domainMeta?.entryPoint ?? "").trim();
  if (ROUTE.test(point)) return `0|${point}`;
  return `1|${node.domainMeta?.entryType ?? ""}|${point}`;
}

/** One row per flow, sorted by entry, then name, then id; steps by `flow_step` weight, ties in graph order. */
export function laneRows(domainGraph: KnowledgeGraph, flowIds: string[]): LaneRow[] {
  const nodes = new Map(domainGraph.nodes.map((node) => [node.id, node]));
  const stepsOf = new Map<string, { id: string; weight: number; index: number }[]>();
  domainGraph.edges.forEach((edge, index) => {
    if (edge.type !== "flow_step") return;
    const list = stepsOf.get(edge.source) ?? [];
    list.push({ id: edge.target, weight: edge.weight, index });
    stepsOf.set(edge.source, list);
  });
  const flows = [...new Set(flowIds)].map((id) => nodes.get(id)).filter((node): node is GraphNode => node !== undefined && node.type === "flow");
  flows.sort((a, b) => compareText(entryKey(a), entryKey(b)) || compareText(a.name, b.name) || compareText(a.id, b.id));
  return flows.map((flow) => ({
    flowId: flow.id,
    steps: (stepsOf.get(flow.id) ?? []).sort((a, b) => a.weight - b.weight || a.index - b.index).map((step) => step.id),
  }));
}

export interface DomainLocation {
  domainId: string;
  groupId: string | null;
}

/**
 * Where a search result opens in the Domain view: a domain itself, a flow's first containing domain and its group, or a
 * step through the first flow whose `flow_step` edge holds it. Null for any other node.
 */
export function locateInDomain(groups: FeatureGroups, domainGraph: KnowledgeGraph, nodeId: string): DomainLocation | null {
  const node = domainGraph.nodes.find((item) => item.id === nodeId);
  if (node === undefined) return null;
  if (node.type === "domain") return { domainId: node.id, groupId: null };
  let flowId: string | null = null;
  if (node.type === "flow") flowId = node.id;
  else if (node.type === "step") flowId = domainGraph.edges.find((edge) => edge.type === "flow_step" && edge.target === node.id)?.source ?? null;
  if (flowId === null) return null;
  const domainId = domainGraph.edges.find((edge) => edge.type === "contains_flow" && edge.target === flowId)?.source;
  if (domainId === undefined) return null;
  return { domainId, groupId: groupHoldingFlow(groupsOf(groups, domainGraph, domainId), flowId)?.id ?? null };
}

/** The separator the packer puts between a group's label and its qualifier in a moved flow's former label. */
export const QUALIFIER_SEPARATOR = " \u00b7 ";

/** A former label (`origin`) as its label part, which is translated, and its qualifier, which is not. */
export function splitOrigin(origin: string): { label: string; qualifier: string | null } {
  const at = origin.indexOf(QUALIFIER_SEPARATOR);
  return at < 0 ? { label: origin, qualifier: null } : { label: origin.slice(0, at), qualifier: origin.slice(at + QUALIFIER_SEPARATOR.length) };
}

/**
 * The flows the right panel lists for a domain: the open group's flows in group order when a group of this domain is open,
 * else all the domain's flows in graph order.
 */
export function panelFlows(groups: FeatureGroups, domainGraph: KnowledgeGraph, domainId: string, activeDomainId: string | null, activeGroupId: string | null): { group: FeatureGroup | null; flowIds: string[] } {
  if (activeGroupId !== null && activeDomainId === domainId) {
    const group = groupsOf(groups, domainGraph, domainId).find((item) => item.id === activeGroupId);
    if (group !== undefined) return { group, flowIds: group.flows.map((flow) => flow.id) };
  }
  return { group: null, flowIds: flowIdsOf(domainGraph, domainId) };
}
