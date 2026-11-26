import type { KnowledgeGraph } from "../core/types";
import { groupHoldingFlow, groupsOf, laneRows, locateInDomain, type FeatureGroups } from "./domainLevels";

/**
 * One rule for every canvas node: a single click selects it (and a second click deselects it), a double click enters the
 * next level when the node has one and otherwise only selects, and a click that is the second click of a double click
 * changes nothing. Pure, so a test can walk every node type without a DOM.
 */

export type CanvasNodeType =
  | "domain"
  | "group"
  | "flow"
  | "step"
  | "layer"
  | "folder"
  | "container"
  | "file"
  | "function"
  | "file-list"
  | "portal"
  | "stand-in";

/** Types a double click or the panel's Open button enters. */
const ENTERABLE: ReadonlySet<CanvasNodeType> = new Set(["domain", "group", "layer", "folder", "container", "file-list", "portal", "stand-in"]);
/** Types that are links to another place, not selectable nodes: a single click does nothing. */
const LINKS: ReadonlySet<CanvasNodeType> = new Set(["portal", "stand-in"]);

export const hasNextLevel = (type: CanvasNodeType): boolean => ENTERABLE.has(type);
export const isSelectable = (type: CanvasNodeType): boolean => !LINKS.has(type);

export type CanvasAction = { kind: "none" } | { kind: "select" } | { kind: "deselect" } | { kind: "enter" };

export interface CanvasClick {
  type: CanvasNodeType;
  event: "click" | "dblclick";
  /** `MouseEvent.detail` of a click: 2 or more is the second click of a double click. */
  detail: number;
  /** Whether this node is the selected one. */
  selected: boolean;
}

export function onCanvasClick({ type, event, detail, selected }: CanvasClick): CanvasAction {
  if (event === "click") {
    if (detail >= 2 || !isSelectable(type)) return { kind: "none" };
    return selected ? { kind: "deselect" } : { kind: "select" };
  }
  if (hasNextLevel(type)) return { kind: "enter" };
  return selected ? { kind: "none" } : { kind: "select" };
}

export type DomainLevel = "overview" | "groups" | "lanes";

export interface HolderContext {
  level: DomainLevel;
  domainGraph: KnowledgeGraph;
  featureGroups: FeatureGroups;
  activeDomainId: string | null;
  activeGroupId: string | null;
}

/**
 * The canvas node of the current level that stands for `nodeId`: the domain card on the overview, the group card at
 * the group level, the flow or step itself in the lanes. Null when no card of this level holds it.
 */
export function canvasHolder(ctx: HolderContext, nodeId: string): string | null {
  const { level, domainGraph, featureGroups, activeDomainId, activeGroupId } = ctx;
  if (level === "overview") return locateInDomain(featureGroups, domainGraph, nodeId)?.domainId ?? null;
  if (activeDomainId === null) return null;
  const groups = groupsOf(featureGroups, domainGraph, activeDomainId);
  if (level === "groups") {
    const place = locateInDomain(featureGroups, domainGraph, nodeId);
    if (place === null || place.domainId !== activeDomainId || place.groupId === null) return null;
    return `group:${place.groupId}`;
  }
  const group = groups.find((item) => item.id === activeGroupId);
  if (!group) return null;
  const rows = laneRows(domainGraph, group.flows.map((flow) => flow.id));
  if (rows.some((row) => row.flowId === nodeId || row.steps.includes(nodeId))) return nodeId;
  return groupHoldingFlow([group], nodeId) ? nodeId : null;
}

export interface GoToTarget {
  activeDomainId: string | null;
  activeGroupId: string | null;
}

/**
 * The level that holds a node of the domain graph, for the one "go to" that search and every panel list share:
 * a domain lives on the overview (it is selected there, not opened); a flow in the lanes of the group that holds it;
 * a step in the lanes of its flow's group. Null for a node the domain graph does not have or no domain holds.
 */
export function goToTarget(ctx: { domainGraph: KnowledgeGraph; featureGroups: FeatureGroups }, nodeId: string): GoToTarget | null {
  const node = ctx.domainGraph.nodes.find((item) => item.id === nodeId);
  if (!node) return null;
  if (node.type === "domain") return { activeDomainId: null, activeGroupId: null };
  const place = locateInDomain(ctx.featureGroups, ctx.domainGraph, nodeId);
  if (place === null || place.groupId === null) return null;
  return { activeDomainId: place.domainId, activeGroupId: place.groupId };
}
