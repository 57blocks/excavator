import { useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
} from "@xyflow/react";
import type { Edge, Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import BandHeadingNode from "./BandHeadingNode";
import type { BandHeadingFlowNode } from "./BandHeadingNode";
import DomainClusterNode, { DOMAIN_CARD_HEIGHT, DOMAIN_CARD_WIDTH } from "./DomainClusterNode";
import type { DomainClusterFlowNode } from "./DomainClusterNode";
import FlowNode from "./FlowNode";
import type { FlowFlowNode } from "./FlowNode";
import StepNode from "./StepNode";
import type { StepFlowNode } from "./StepNode";
import { useDashboardStore, activeTranslations } from "../store";
import { domainTitle, translatorOf, type Translate } from "../excavator/nameTranslations";
import { useI18n } from "../contexts/I18nContext";
import { BAND_HEADINGS, domainBands, gridPositions } from "../excavator/domainLayout";
import { mergeElkPositions, nodesToElkInput } from "../utils/layout";
import { applyElkLayout } from "../utils/elk-layout";
import type { KnowledgeGraph, GraphNode } from "@understand-anything/core/types";

const nodeTypes = {
  "band-heading": BandHeadingNode,
  "domain-cluster": DomainClusterNode,
  "flow-node": FlowNode,
  "step-node": StepNode,
};

function getDomainMeta(node: GraphNode) {
  return node.domainMeta;
}

interface BuiltGraph {
  nodes: Node[];
  edges: Edge[];
  dims: Map<string, { width: number; height: number }>;
}

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
  const gridWidth = GRID_COLUMNS * DOMAIN_CARD_WIDTH + (GRID_COLUMNS - 1) * GRID_GAP_X;
  let top = 0;
  for (const band of domainBands(graph)) {
    const heading: BandHeadingFlowNode = {
      id: `band:${band.kind}`,
      type: "band-heading",
      position: { x: 0, y: top },
      data: { label: BAND_HEADINGS[band.kind] },
      style: { width: gridWidth, height: HEADING_HEIGHT },
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
        draggable: false,
      };
      rfNodes.push(card);
    });
    const rows = Math.ceil(band.domainIds.length / GRID_COLUMNS);
    top = cardsTop + rows * DOMAIN_CARD_HEIGHT + (rows - 1) * GRID_GAP_Y + BAND_GAP;
  }
  return rfNodes;
}

/** The cross-domain edges touching any of `focusIds`, with their description as the label; none for no focus. */
function crossDomainEdges(graph: KnowledgeGraph, focusIds: ReadonlySet<string>): Edge[] {
  if (focusIds.size === 0) return [];
  return graph.edges
    .filter((e) => e.type === "cross_domain" && (focusIds.has(e.source) || focusIds.has(e.target)))
    .map((e, i) => ({
      id: `cd-${i}-${e.source}-${e.target}`,
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

function buildDomainDetail(
  graph: KnowledgeGraph,
  domainId: string,
  translate?: Translate,
): BuiltGraph {
  // Find flows for this domain
  const flowIds = new Set(
    graph.edges
      .filter((e) => e.type === "contains_flow" && e.source === domainId)
      .map((e) => e.target),
  );

  const flowNodes = graph.nodes.filter((n) => flowIds.has(n.id));
  const stepEdges = graph.edges.filter(
    (e) => e.type === "flow_step" && flowIds.has(e.source),
  );
  const stepIds = new Set(stepEdges.map((e) => e.target));
  const stepNodes = graph.nodes.filter((n) => stepIds.has(n.id));

  // Build step order map
  const stepOrderMap = new Map<string, number>();
  for (const edge of stepEdges) {
    stepOrderMap.set(edge.target, edge.weight);
  }

  // Count steps per flow
  const stepCountMap = new Map<string, number>();
  for (const edge of stepEdges) {
    stepCountMap.set(edge.source, (stepCountMap.get(edge.source) ?? 0) + 1);
  }

  const dims = new Map<string, { width: number; height: number }>();

  const flowRfNodes: FlowFlowNode[] = flowNodes.map((node) => {
    const meta = getDomainMeta(node);
    const title = domainTitle(node.name, translate);
    dims.set(node.id, { width: 260, height: 120 });
    return {
      id: node.id,
      type: "flow-node" as const,
      position: { x: 0, y: 0 },
      data: {
        label: title.label,
        original: title.original,
        summary: node.summary,
        entryPoint: meta?.entryPoint as string | undefined,
        entryType: meta?.entryType as string | undefined,
        stepCount: stepCountMap.get(node.id) ?? 0,
        flowId: node.id,
      },
    };
  });
  const stepRfNodes: StepFlowNode[] = stepNodes.map((node) => {
    const title = domainTitle(node.name, translate);
    dims.set(node.id, { width: 200, height: 90 });
    return {
      id: node.id,
      type: "step-node" as const,
      position: { x: 0, y: 0 },
      data: {
        label: title.label,
        original: title.original,
        summary: node.summary,
        filePath: node.filePath,
        stepId: node.id,
        order: Math.round((stepOrderMap.get(node.id) ?? 0) * 10),
      },
    };
  });
  const rfNodes: Node[] = [...flowRfNodes, ...stepRfNodes];

  const rfEdges: Edge[] = stepEdges.map((e, i) => ({
    id: `fs-${i}-${e.source}-${e.target}`,
    source: e.source,
    target: e.target,
    style: { stroke: "var(--color-border-medium)", strokeWidth: 1.5 },
    animated: false,
  }));

  return { nodes: rfNodes, edges: rfEdges, dims };
}

function DomainGraphViewInner() {
  const domainGraph = useDashboardStore((s) => s.domainGraph);
  const activeDomainId = useDashboardStore((s) => s.activeDomainId);
  const clearActiveDomain = useDashboardStore((s) => s.clearActiveDomain);
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);
  const nameTranslations = useDashboardStore(activeTranslations);
  const { t } = useI18n();
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // The overview is placed deterministically; only the open domain still goes through ELK.
  const overviewNodes = useMemo<Node[]>(() => {
    if (!domainGraph || activeDomainId) return [];
    return buildDomainOverview(domainGraph, translatorOf(nameTranslations));
  }, [domainGraph, activeDomainId, nameTranslations]);

  const overviewEdges = useMemo<Edge[]>(() => {
    if (!domainGraph || activeDomainId) return [];
    const focus = new Set<string>();
    if (hoveredId) focus.add(hoveredId);
    if (selectedNodeId) focus.add(selectedNodeId);
    return crossDomainEdges(domainGraph, focus);
  }, [domainGraph, activeDomainId, hoveredId, selectedNodeId]);

  const built = useMemo<BuiltGraph | null>(() => {
    if (!domainGraph || !activeDomainId) return null;
    return buildDomainDetail(domainGraph, activeDomainId, translatorOf(nameTranslations));
  }, [domainGraph, activeDomainId, nameTranslations]);

  const [layout, setLayout] = useState<{ nodes: Node[]; edges: Edge[] }>({
    nodes: [],
    edges: [],
  });

  useEffect(() => {
    if (!built) {
      setLayout({ nodes: [], edges: [] });
      return;
    }
    let cancelled = false;
    const { nodes: nodesArray, edges: edgesArray, dims } = built;
    const elkInput = nodesToElkInput(nodesArray, edgesArray, dims, {
      "elk.direction": "RIGHT",
    });
    applyElkLayout(elkInput, { strict: import.meta.env.DEV })
      .then(({ positioned, issues }) => {
        if (cancelled) return;
        if (issues.length > 0) {
          // Funnel into store so the status line shows them.
          useDashboardStore.getState().appendLayoutIssues(issues);
        }
        setLayout({
          nodes: mergeElkPositions(nodesArray, positioned),
          edges: edgesArray,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[domain ELK] layout failed:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [built]);

  const nodes = activeDomainId ? layout.nodes : overviewNodes;
  const edges = activeDomainId ? layout.edges : overviewEdges;

  // Double-click is handled by individual node components (e.g. DomainClusterNode)

  if (!domainGraph) {
    return (
      <div className="h-full flex items-center justify-center text-text-muted text-sm">
        No domain graph available. Run /excavator-domain to generate one.
      </div>
    );
  }

  return (
    <div className="h-full w-full relative">
      {activeDomainId && (
        <div className="absolute top-3 left-3 z-10">
          <button
            type="button"
            onClick={() => clearActiveDomain()}
            className="px-3 py-1.5 text-xs rounded-lg bg-elevated border border-border-subtle text-text-secondary hover:text-text-primary transition-colors"
          >
            {t.domainView.backToDomains}
          </button>
        </div>
      )}
      <ReactFlow
        key={activeDomainId ?? "overview"}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeMouseEnter={(_, node) => !activeDomainId && node.type === "domain-cluster" && setHoveredId(node.id)}
        onNodeMouseLeave={() => setHoveredId(null)}
        fitView
        fitViewOptions={{ padding: 0.2 }}
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
        <Controls />
        <MiniMap
          nodeColor="var(--color-accent)"
          maskColor="var(--glass-bg)"
          className="!bg-surface !border !border-border-subtle"
        />
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
