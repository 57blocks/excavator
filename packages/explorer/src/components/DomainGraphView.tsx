import { useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  useReactFlow,
} from "@xyflow/react";
import type { Edge, Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import BandHeadingNode from "./BandHeadingNode";
import type { BandHeadingFlowNode } from "./BandHeadingNode";
import BackButton from "./BackButton";
import DomainBreadcrumb from "./DomainBreadcrumb";
import DomainClusterNode, { DOMAIN_CARD_HEIGHT, DOMAIN_CARD_WIDTH } from "./DomainClusterNode";
import type { DomainClusterFlowNode } from "./DomainClusterNode";
import FlowNode, { FLOW_CARD_HEIGHT, FLOW_CARD_WIDTH } from "./FlowNode";
import type { FlowFlowNode } from "./FlowNode";
import GroupCardNode, { GROUP_CARD_HEIGHT, GROUP_CARD_WIDTH } from "./GroupCardNode";
import type { GroupCardFlowNode } from "./GroupCardNode";
import LaneBandNode from "./LaneBandNode";
import type { LaneBandFlowNode } from "./LaneBandNode";
import StepNode, { STEP_CARD_HEIGHT, STEP_CARD_WIDTH } from "./StepNode";
import type { StepFlowNode } from "./StepNode";
import { useDashboardStore, activeTranslations } from "../store";
import { BAND_HEADINGS, domainBands, gridPositions } from "../excavator/domainLayout";
import { groupsOf, hasGroupsFor, laneRows, splitOrigin, type LaneRow, type FeatureGroup, type FeatureGroups } from "../excavator/domainLevels";
import { canvasHolder, type CanvasNodeType } from "../excavator/canvasSelection";
import { runCanvasClick } from "../excavator/canvasActions";
import { DIMMED_OPACITY, emphasis, laneBandId, laneStepId, type Emphasis } from "../excavator/emphasis";
import { initialViewport } from "../excavator/initialViewport";
import { flowTitle } from "../excavator/displayFlowName";
import { domainTitle, translatorOf, type Translate } from "../excavator/nameTranslations";
import type { KnowledgeGraph } from "@understand-anything/core/types";

const nodeTypes = {
  "band-heading": BandHeadingNode,
  "domain-cluster": DomainClusterNode,
  "group-card": GroupCardNode,
  "lane-band": LaneBandNode,
  "flow-node": FlowNode,
  "step-node": StepNode,
};

const GRID_COLUMNS = 4;
const GRID_GAP_X = 40;
const GRID_GAP_Y = 32;
const HEADING_HEIGHT = 32;
const HEADING_GAP = 16;
const BAND_GAP = 48;

/** The overview's cards on an aligned grid, in bands, laid out without a layout engine. */
function buildDomainOverview(graph: KnowledgeGraph, translate?: Translate): Node[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const rfNodes: Node[] = [];
  // A heading is one card wide, so fitting the view fits the cards and not the headings.
  const gridWidth = DOMAIN_CARD_WIDTH;
  let top = 0;
  for (const band of domainBands(graph)) {
    const heading: BandHeadingFlowNode = {
      id: `band:${band.kind}`,
      type: "band-heading",
      position: { x: 0, y: top },
      data: { label: BAND_HEADINGS[band.kind] },
      width: gridWidth,
      height: HEADING_HEIGHT,
      selectable: false,
      draggable: false,
      connectable: false,
      focusable: false,
    };
    rfNodes.push(heading);
    const cardsTop = top + HEADING_HEIGHT + HEADING_GAP;
    const positions = gridPositions(band.domainIds.length, {
      columns: GRID_COLUMNS,
      cardWidth: DOMAIN_CARD_WIDTH,
      cardHeight: DOMAIN_CARD_HEIGHT,
      gapX: GRID_GAP_X,
      gapY: GRID_GAP_Y,
      top: cardsTop,
    });
    band.domainIds.forEach((id, index) => {
      const node = byId.get(id)!;
      const title = domainTitle(node.name, translate);
      const card: DomainClusterFlowNode = {
        id,
        type: "domain-cluster",
        position: positions[index],
        data: { label: title.label, original: title.original, summary: node.summary, domainId: id },
        width: DOMAIN_CARD_WIDTH,
        height: DOMAIN_CARD_HEIGHT,
        draggable: false,
      };
      rfNodes.push(card);
    });
    const rows = Math.ceil(band.domainIds.length / GRID_COLUMNS);
    top = cardsTop + rows * DOMAIN_CARD_HEIGHT + (rows - 1) * GRID_GAP_Y + BAND_GAP;
  }
  return rfNodes;
}

/** Every cross-domain edge with an id that does not depend on which edges are drawn. */
function crossDomainEdgeList(graph: KnowledgeGraph): { id: string; source: string; target: string; description?: string }[] {
  const list: { id: string; source: string; target: string; description?: string }[] = [];
  graph.edges.forEach((e, i) => {
    if (e.type === "cross_domain") list.push({ id: `cd-${i}-${e.source}-${e.target}`, source: e.source, target: e.target, description: e.description });
  });
  return list;
}

/** The cross-domain edges touching any of `focusIds`, with their description as the label; none for no focus. */
function crossDomainEdges(graph: KnowledgeGraph, focusIds: ReadonlySet<string>): Edge[] {
  if (focusIds.size === 0) return [];
  return crossDomainEdgeList(graph)
    .filter((e) => focusIds.has(e.source) || focusIds.has(e.target))
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.description ?? "",
      style: { stroke: "var(--color-accent)", strokeDasharray: "6 3", strokeWidth: 2 },
      labelStyle: { fill: "var(--color-text-muted)", fontSize: 10 },
      labelBgStyle: { fill: "var(--color-surface)", fillOpacity: 0.9 },
      labelBgPadding: [6, 4] as [number, number],
      labelBgBorderRadius: 4,
      animated: true,
    }));
}

const GROUP_NOTE = "This page has no feature groups; the domain's flows are shown as one group.";

/** The group cards of an open domain on the aligned grid; a muted line above them when the page has no groups. */
function buildGroupCards(graph: KnowledgeGraph, groups: FeatureGroup[], missing: boolean, translate?: Translate): Node[] {
  const flowName = new Map(graph.nodes.map((node) => [node.id, node]));
  const gridWidth = GROUP_CARD_WIDTH;
  const rfNodes: Node[] = [];
  let top = 0;
  if (missing) {
    const note: BandHeadingFlowNode = {
      id: "group-note",
      type: "band-heading",
      position: { x: 0, y: 0 },
      data: { label: GROUP_NOTE, muted: true },
      width: gridWidth,
      height: HEADING_HEIGHT,
      selectable: false,
      draggable: false,
      connectable: false,
      focusable: false,
    };
    rfNodes.push(note);
    top = HEADING_HEIGHT + HEADING_GAP;
  }
  const positions = gridPositions(groups.length, {
    columns: GRID_COLUMNS,
    cardWidth: GROUP_CARD_WIDTH,
    cardHeight: GROUP_CARD_HEIGHT,
    gapX: GRID_GAP_X,
    gapY: GRID_GAP_Y,
    top,
  });
  groups.forEach((group, index) => {
    const title = domainTitle(group.label, translate);
    const examples = group.flows.slice(0, 3).map((flow) => {
      // Names, not routes: the example is the flow's translated name without its trailing route.
      return flowTitle(flowName.get(flow.id)?.name ?? flow.id, translate).label;
    });
    const card: GroupCardFlowNode = {
      id: `group:${group.id}`,
      type: "group-card",
      position: positions[index],
      data: { groupId: group.id, label: title.label, original: title.original, qualifier: group.qualifier, flowCount: group.flows.length, examples },
      width: GROUP_CARD_WIDTH,
      height: GROUP_CARD_HEIGHT,
      draggable: false,
      selectable: false,
    };
    rfNodes.push(card);
  });
  return rfNodes;
}

const ROW_HEIGHT = 150;
const LANE_LEFT = 24;
const STEPS_LEFT = LANE_LEFT + FLOW_CARD_WIDTH + 70;
const STEP_STRIDE = STEP_CARD_WIDTH + 50;
const LANE_RIGHT_PAD = 60;

interface Lanes {
  rows: LaneRow[];
  nodes: Node[];
  edges: Edge[];
  /** Where each flow and step sits, for centring on one. */
  centres: Map<string, { x: number; y: number }>;
}

/** One swimlane row per flow of the group: the flow card, then its steps left to right; edges stay inside a row. */
function buildLanes(graph: KnowledgeGraph, group: FeatureGroup, translate?: Translate): Lanes {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const flowMeta = new Map(group.flows.map((flow) => [flow.id, flow]));
  const rows = laneRows(graph, group.flows.map((flow) => flow.id));
  const widest = rows.reduce((max, row) => Math.max(max, row.steps.length), 0);
  const bandWidth = STEPS_LEFT + widest * STEP_STRIDE + LANE_RIGHT_PAD;
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const centres = new Map<string, { x: number; y: number }>();

  rows.forEach((row, index) => {
    const top = index * ROW_HEIGHT;
    const band: LaneBandFlowNode = {
      id: laneBandId(row.flowId),
      type: "lane-band",
      position: { x: 0, y: top },
      data: {},
      width: bandWidth,
      height: ROW_HEIGHT,
      zIndex: -1,
      selectable: false,
      draggable: false,
      connectable: false,
      focusable: false,
    };
    nodes.push(band);

    const flow = byId.get(row.flowId)!;
    const title = flowTitle(flow.name, translate);
    const member = flowMeta.get(row.flowId);
    const tags: { label: string; qualifier?: string | null }[] = [];
    if (member?.scope) tags.push({ label: domainTitle(member.scope, translate).label });
    if (member?.origin) {
      const former = splitOrigin(member.origin);
      tags.push({ label: domainTitle(former.label, translate).label, qualifier: former.qualifier });
    }
    const flowY = top + (ROW_HEIGHT - FLOW_CARD_HEIGHT) / 2;
    const flowNode: FlowFlowNode = {
      id: flow.id,
      type: "flow-node",
      position: { x: LANE_LEFT, y: flowY },
      data: {
        label: title.label,
        original: title.original,
        summary: flow.summary,
        flowId: flow.id,
        tags,
      },
      width: FLOW_CARD_WIDTH,
      height: FLOW_CARD_HEIGHT,
      draggable: false,
    };
    nodes.push(flowNode);
    centres.set(flow.id, { x: LANE_LEFT + FLOW_CARD_WIDTH / 2, y: flowY + FLOW_CARD_HEIGHT / 2 });

    let previous = flow.id;
    row.steps.forEach((stepId, position) => {
      const step = byId.get(stepId);
      if (!step) return;
      const stepTitle = domainTitle(step.name, translate);
      const x = STEPS_LEFT + position * STEP_STRIDE;
      const y = top + (ROW_HEIGHT - STEP_CARD_HEIGHT) / 2;
      // A step two flows share is one graph node; each row draws its own copy, so the id carries the row.
      const nodeId = laneStepId(row.flowId, stepId);
      const stepNode: StepFlowNode = {
        id: nodeId,
        type: "step-node",
        position: { x, y },
        data: {
          label: stepTitle.label,
          original: stepTitle.original,
          summary: step.summary,
          stepId,
          order: position + 1,
        },
        width: STEP_CARD_WIDTH,
        height: STEP_CARD_HEIGHT,
        draggable: false,
      };
      nodes.push(stepNode);
      if (!centres.has(stepId)) centres.set(stepId, { x: x + STEP_CARD_WIDTH / 2, y: y + STEP_CARD_HEIGHT / 2 });
      edges.push({
        id: `lane-edge:${previous}->${nodeId}`,
        source: previous,
        target: nodeId,
        style: { stroke: "var(--color-border-medium)", strokeWidth: 1.5 },
        animated: false,
      });
      previous = nodeId;
    });
  });
  return { rows, nodes, edges, centres };
}

/** The canvas node type and id a React Flow node stands for; null for the headings and lane separators. */
function canvasTarget(node: Node): { type: CanvasNodeType; id: string } | null {
  const data = node.data as Record<string, string>;
  if (node.type === "domain-cluster") return { type: "domain", id: node.id };
  if (node.type === "group-card") return { type: "group", id: data.groupId };
  if (node.type === "flow-node") return { type: "flow", id: data.flowId };
  if (node.type === "step-node") return { type: "step", id: data.stepId };
  return null;
}

function canvasClickOf(node: Node, event: "click" | "dblclick", detail: number): void {
  const target = canvasTarget(node);
  if (target !== null) runCanvasClick(target.type, target.id, event, detail);
}

/** The domain a node of the domain graph belongs to on the overview: the card to draw cross-domain edges for. */
function holderOverview(graph: KnowledgeGraph, featureGroups: FeatureGroups, nodeId: string): string {
  return canvasHolder({ level: "overview", domainGraph: graph, featureGroups, activeDomainId: null, activeGroupId: null }, nodeId) ?? nodeId;
}

// Nodes carry their own width and height: the minimap reads them from the nodes given here, not from the measured copy.
const minimapColor = (node: Node): string =>
  node.type === "band-heading" || node.type === "lane-band" ? "transparent" : "var(--color-accent)";

function DomainGraphViewInner() {
  const domainGraph = useDashboardStore((s) => s.domainGraph);
  const activeDomainId = useDashboardStore((s) => s.activeDomainId);
  const activeGroupId = useDashboardStore((s) => s.activeGroupId);
  const featureGroups = useDashboardStore((s) => s.featureGroups);
  const navigateToDomain = useDashboardStore((s) => s.navigateToDomain);
  const clearActiveDomain = useDashboardStore((s) => s.clearActiveDomain);
  const setViewportState = useDashboardStore((s) => s.setViewportState);
  const selectNode = useDashboardStore((s) => s.selectNode);
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);
  const selectedGroupId = useDashboardStore((s) => s.selectedGroupId);
  const revealId = useDashboardStore((s) => s.domainRevealNodeId);
  const clearDomainReveal = useDashboardStore((s) => s.clearDomainReveal);
  const nameTranslations = useDashboardStore(activeTranslations);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const { setViewport, getViewport } = useReactFlow();
  const paneRef = useRef<HTMLDivElement>(null);
  // The level whose viewport has been placed; the canvas shows only then, so it does not flash at the origin.
  const [placedKey, setPlacedKey] = useState<string | null>(null);
  const translate = useMemo(() => translatorOf(nameTranslations), [nameTranslations]);

  const domainExists = domainGraph !== null && activeDomainId !== null && domainGraph.nodes.some((n) => n.id === activeDomainId);
  const level: "overview" | "groups" | "lanes" = !domainExists ? "overview" : activeGroupId === null ? "groups" : "lanes";

  const groups = useMemo<FeatureGroup[]>(
    () => (domainGraph && domainExists ? groupsOf(featureGroups as FeatureGroups, domainGraph, activeDomainId!) : []),
    [domainGraph, domainExists, activeDomainId, featureGroups],
  );
  const activeGroup = groups.find((group) => group.id === activeGroupId) ?? null;

  const lanes = useMemo<Lanes | null>(
    () => (domainGraph && level === "lanes" && activeGroup ? buildLanes(domainGraph, activeGroup, translate) : null),
    [domainGraph, level, activeGroup, translate],
  );

  const nodes = useMemo<Node[]>(() => {
    if (!domainGraph) return [];
    if (level === "overview") return buildDomainOverview(domainGraph, translate);
    if (level === "groups") return buildGroupCards(domainGraph, groups, !hasGroupsFor(featureGroups, activeDomainId!), translate);
    return lanes?.nodes ?? [];
  }, [domainGraph, level, groups, featureGroups, activeDomainId, lanes, translate]);

  const edges = useMemo<Edge[]>(() => {
    if (!domainGraph) return [];
    if (level === "lanes") return lanes?.edges ?? [];
    if (level === "groups") return [];
    const focus = new Set<string>();
    if (hoveredId) focus.add(hoveredId);
    if (selectedNodeId) focus.add(holderOverview(domainGraph, featureGroups, selectedNodeId));
    return crossDomainEdges(domainGraph, focus);
  }, [domainGraph, level, lanes, hoveredId, selectedNodeId, featureGroups]);

  // What stays at full strength while a node is selected: the card of this level that holds the selection.
  const holder = useMemo(() => {
    if (!domainGraph) return null;
    return (nodeId: string) => canvasHolder({ level, domainGraph, featureGroups, activeDomainId, activeGroupId }, nodeId);
  }, [domainGraph, level, featureGroups, activeDomainId, activeGroupId]);

  const full = useMemo<Emphasis | null>(() => {
    if (!domainGraph || !holder) return null;
    let selectedId: string | null = null;
    if (level === "groups" && selectedGroupId !== null) selectedId = `group:${selectedGroupId}`;
    else if (selectedNodeId !== null) selectedId = holder(selectedNodeId);
    if (selectedId === null) return null;
    const overviewEdges = level === "overview" ? crossDomainEdgeList(domainGraph) : [];
    return emphasis({
      level,
      selectedId,
      nodes,
      edges: level === "lanes" ? (lanes?.edges ?? []) : overviewEdges,
      rows: lanes?.rows,
    });
  }, [domainGraph, holder, level, selectedNodeId, selectedGroupId, nodes, lanes]);

  // The emphasis is applied through opacity only, so the layout is not rebuilt by a selection.
  const shownNodes = useMemo<Node[]>(
    () => (full === null ? nodes : nodes.map((node) => (node.type === "band-heading" || full.nodes.has(node.id) ? node : { ...node, style: { ...node.style, opacity: DIMMED_OPACITY } }))),
    [nodes, full],
  );
  const shownEdges = useMemo<Edge[]>(
    () => (full === null ? edges : edges.map((edge) => (full.edges.has(edge.id) ? edge : { ...edge, style: { ...edge.style, opacity: DIMMED_OPACITY } }))),
    [edges, full],
  );

  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const lanesRef = useRef(lanes);
  lanesRef.current = lanes;
  const holderRef = useRef(holder);
  holderRef.current = holder;

  /**
   * Where the canvas centres for a node that was gone to (a search result or a panel list item), in flow coordinates:
   * the card of the current level that holds it; in the lanes, the row of the flow (a step centres on its flow's row).
   */
  const revealCentre = (id: string): { x: number; y: number } | null => {
    const target = holderRef.current ? holderRef.current(id) : null;
    if (target === null) return null;
    const rows = lanesRef.current;
    if (rows !== null) {
      const flowId = domainGraph?.edges.find((edge) => edge.type === "flow_step" && edge.target === id && rows.centres.has(edge.source))?.source;
      return (flowId !== undefined ? rows.centres.get(flowId) : rows.centres.get(target)) ?? null;
    }
    const card = nodesRef.current.find((node) => node.id === target);
    return card ? { x: card.position.x + (card.width ?? 0) / 2, y: card.position.y + (card.height ?? 0) / 2 } : null;
  };
  /** The viewport that shows `centre`: the lanes keep their horizontal placement and centre the row vertically; other levels centre both ways. */
  const withReveal = (view: { x: number; y: number; zoom: number }, centre: { x: number; y: number }, pane: { width: number; height: number }) =>
    level === "lanes"
      ? { ...view, y: pane.height / 2 - centre.y * view.zoom }
      : { x: pane.width / 2 - centre.x * view.zoom, y: pane.height / 2 - centre.y * view.zoom, zoom: view.zoom };

  // Once per level change, after the nodes are in place: centre the content in the pane when it fits, else top-align it.
  // The pane is the canvas container's own size, read when the placement runs; the bounds are the cards' (headings and
  // lane separators only repeat their edges). The panel may still change width just after a level opens, so the placement
  // is repeated when the pane size changes during the first second, and never after the user has panned or zoomed.
  // A node gone to while the level opens is panned to inside this same placement, so the level's own placement never overrides it.
  const levelKey = `${level}|${activeDomainId ?? ""}|${activeGroupId ?? ""}`;
  const userMoved = useRef(false);
  useEffect(() => {
    userMoved.current = false;
    let placedAt = 0;
    let lastSize = "";
    const place = (): void => {
      const pane = paneRef.current?.getBoundingClientRect();
      const cards = nodesRef.current.filter((node) => node.type !== "band-heading" && node.type !== "lane-band");
      if (!pane || cards.length === 0) return;
      lastSize = `${pane.width}x${pane.height}`;
      const left = Math.min(...cards.map((node) => node.position.x));
      const top = Math.min(...cards.map((node) => node.position.y));
      const right = Math.max(...cards.map((node) => node.position.x + (node.width ?? 0)));
      const bottom = Math.max(...cards.map((node) => node.position.y + (node.height ?? 0)));
      let view = initialViewport({
        bounds: { x: left, y: top, width: right - left, height: bottom - top },
        pane: { width: pane.width, height: pane.height },
        padding: level === "overview" ? 32 : 56,
        minZoom: level === "lanes" ? 1 : 0.75,
        maxZoom: 1,
      });
      const pending = useDashboardStore.getState().domainRevealNodeId;
      const centre = pending === null ? null : revealCentre(pending);
      if (centre !== null) view = withReveal(view, centre, { width: pane.width, height: pane.height });
      if (pending !== null) useDashboardStore.getState().clearDomainReveal();
      // Back restores the viewport the level had; it wins over the placement and over a pan to a node.
      const restored = useDashboardStore.getState().pendingViewport;
      if (restored !== null) {
        view = restored;
        useDashboardStore.getState().clearPendingViewport();
        userMoved.current = true;
      }
      void setViewport(view);
    };
    const timer = setTimeout(() => {
      place();
      placedAt = Date.now();
      setPlacedKey(levelKey);
    }, 60);
    const element = paneRef.current;
    const observer =
      element && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            const pane = element.getBoundingClientRect();
            if (placedAt === 0 || userMoved.current || Date.now() - placedAt > 1000 || `${pane.width}x${pane.height}` === lastSize) return;
            place();
          })
        : null;
    observer?.observe(element!);
    return () => {
      clearTimeout(timer);
      observer?.disconnect();
    };
    // The nodes of a level are fixed by its key (and the translations); selection and hover must not move the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levelKey, setViewport]);

  // A node gone to on a level that is already placed (a panel item or a search result on this level): pan to it,
  // zoom unchanged.
  useEffect(() => {
    if (revealId === null || placedKey !== levelKey) return;
    const centre = revealCentre(revealId);
    clearDomainReveal();
    const pane = paneRef.current?.getBoundingClientRect();
    if (centre === null || !pane) return;
    const view = getViewport();
    void setViewport(withReveal(view, centre, { width: pane.width, height: pane.height }), { duration: 250 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealId, placedKey, levelKey]);

  if (!domainGraph) {
    return (
      <div className="h-full flex items-center justify-center text-text-muted text-sm">
        No domain graph available. Run /excavator-domain to generate one.
      </div>
    );
  }

  const domainLabel = domainExists ? domainTitle(domainGraph.nodes.find((n) => n.id === activeDomainId)!.name, translate).label : "";
  const crumbs = [
    { label: "All domains", onClick: () => clearActiveDomain() },
    level === "lanes"
      ? { label: domainLabel, onClick: () => { navigateToDomain(activeDomainId!); selectNode(null); } }
      : { label: domainLabel },
    ...(level === "lanes" && activeGroup ? [{ label: domainTitle(activeGroup.label, translate).label, qualifier: activeGroup.qualifier }] : []),
  ];
  const inLanes = level === "lanes";

  return (
    <div ref={paneRef} className="h-full w-full relative" style={{ opacity: placedKey === levelKey ? 1 : 0 }}>
      {level !== "overview" ? (
        <DomainBreadcrumb crumbs={crumbs} />
      ) : (
        <div className="absolute top-3 left-3 z-10">
          <BackButton />
        </div>
      )}
      <ReactFlow
        key={`${activeDomainId ?? "overview"}|${activeGroupId ?? ""}`}
        nodes={shownNodes}
        edges={shownEdges}
        nodeTypes={nodeTypes}
        onNodeClick={(event, node) => canvasClickOf(node, "click", event.detail)}
        onNodeDoubleClick={(event, node) => canvasClickOf(node, "dblclick", event.detail)}
        onPaneClick={() => selectNode(null)}
        // A move with an event is the user's; the placement above leaves the view alone after it.
        onMoveStart={(event) => {
          if (event) userMoved.current = true;
        }}
        // The live viewport is kept in the store so a navigation can record it for Back.
        onMoveEnd={(_, viewport) => setViewportState(viewport)}
        onNodeMouseEnter={(_, node) => level === "overview" && node.type === "domain-cluster" && setHoveredId(node.id)}
        onNodeMouseLeave={() => setHoveredId(null)}
        // The selection lives in the store (the cards draw it); React Flow's own selected class must not outlive it.
        elementsSelectable={false}
        panOnScroll={inLanes}
        zoomOnScroll={!inLanes}
        // The zoom pane would swallow a double click on a card, which opens the domain.
        zoomOnDoubleClick={false}
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="var(--color-border-subtle)"
        />
        {/* The lanes are scrolled, not fitted: the controls sit at the right, where no flow card is, and the minimap is left out. */}
        <Controls position={inLanes ? "bottom-right" : "bottom-left"} />
        {!inLanes && (
          <MiniMap
            nodeColor={minimapColor}
            maskColor="var(--glass-bg)"
            className="!bg-surface !border !border-border-subtle"
          />
        )}
      </ReactFlow>
    </div>
  );
}

export default function DomainGraphView() {
  return (
    <ReactFlowProvider>
      <DomainGraphViewInner />
    </ReactFlowProvider>
  );
}
