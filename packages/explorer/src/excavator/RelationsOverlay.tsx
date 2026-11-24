import { memo, useCallback, useMemo } from "react";
import { Handle, Panel, Position } from "@xyflow/react";
import type { Edge, Node, NodeProps } from "@xyflow/react";
import { useDashboardStore, activeTranslations } from "../store";
import {
  drawnHome, edgeLabel, isStandInId, kindStyle, layerPlacer, overviewPlacer, projectRelations, relationsNotDrawnSentence, relationsOfNode, STAND_IN_PREFIX, standInNote, unplacedRelations,
  type Projection, type RelationsMode, type StandIn,
} from "./graphRelations";
import { domainTitle, translatorOf } from "./nameTranslations";
import { externalLabel } from "./products/relations";
import { useGraphRelations, type GraphRelationsData } from "./useGraphRelations";

/**
 * The relations product on the structural graph: dashed edges per kind between the drawn nodes that hold a linked
 * relation's two ends, one node per external system and per other layer an end sits in, and the panel that picks what
 * is drawn and counts what is not. The overview draws every relation between layers (one edge per layer pair and kind,
 * so at most layers x (layers + externals) x kinds edges); a layer draws the selected node's relations by default, or
 * all of the layer's. Nothing is drawn while the product is not included, and the panel says why.
 */

const STAND_IN_WIDTH = 220;
const STAND_IN_GAP_X = 160;
const STAND_IN_STEP_Y = 90;
const FALLBACK_WIDTH = 280;

interface StandInData extends Record<string, unknown> {
  standIn: StandIn;
  label: string;
  original: string | null;
  note: string;
}

type StandInFlowNode = Node<StandInData, "relation-stand-in">;

function StandInNode({ data }: NodeProps<StandInFlowNode>) {
  return (
    <div
      className="cursor-pointer rounded-lg border-2 border-dashed border-border-medium bg-elevated/70 px-3 py-2 transition-colors hover:bg-elevated"
      style={{ width: STAND_IN_WIDTH }}
      data-excavator-relation-node={data.standIn.id}
      title={data.original === null ? data.label : `${data.label} (${data.original})`}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !bg-text-muted" />
      <div className="truncate text-sm text-text-primary">{data.label}</div>
      {data.original === null ? null : <div className="truncate text-[10px] text-text-muted">{data.original}</div>}
      <div className="mt-0.5 text-[10px] text-text-muted">{data.note}</div>
      <Handle type="source" position={Position.Left} className="!h-2 !w-2 !bg-text-muted" />
    </div>
  );
}

/**
 * The copy's folder box has no handles, and React Flow drops an edge whose end has none. A relation edge that ends at
 * a closed box ends at this point on the box's right side instead, a node inside the box with one handle of each type;
 * the copy's own edges keep their ends.
 */
function BoxAnchorNode() {
  return (
    <div style={{ width: 1, height: 1, pointerEvents: "none" }}>
      <Handle type="target" position={Position.Right} className="!h-1 !w-1 !min-h-0 !min-w-0 !border-0 !bg-transparent" />
      <Handle type="source" position={Position.Right} className="!h-1 !w-1 !min-h-0 !min-w-0 !border-0 !bg-transparent" />
    </div>
  );
}

const ANCHOR_PREFIX = "relation-anchor:";

export const relationNodeTypes = { "relation-stand-in": memo(StandInNode), "relation-anchor": memo(BoxAnchorNode) };

export interface RelationsOverlay {
  nodes: Node[];
  edges: Edge[];
  data: GraphRelationsData;
  mode: RelationsMode;
  projection: Projection | null;
  /** The relations the mode picks before placing: every drawable one, or the selected node's. */
  picked: number;
  /** Drawable relations with an end that no layer holds, which no view draws; null until the product is read. */
  inNoLayer: number | null;
}

/** The base graph with the relations the mode picks added to it. */
export function useRelationsOverlay(baseNodes: Node[], baseEdges: Edge[], level: "overview" | "layer-detail", boxOf: ReadonlyMap<string, string> | undefined): RelationsOverlay {
  const data = useGraphRelations();
  const mode = useDashboardStore((s) => s.relationsMode);
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);
  const activeLayerId = useDashboardStore((s) => s.activeLayerId);
  const nodeIdToLayerId = useDashboardStore((s) => s.nodeIdToLayerId);
  const nodeIdToLayerIds = useDashboardStore((s) => s.nodeIdToLayerIds);
  const graph = useDashboardStore((s) => s.graph);
  const nameTranslations = useDashboardStore(activeTranslations);

  // Counted whatever the mode and view: the overview's placer gives null for an end that no layer holds.
  const inNoLayer = useMemo(() => {
    if (data.status !== "ready") return null;
    const home = (id: string) => drawnHome(id, data.drawn, data.parentOf);
    return unplacedRelations(data.index.drawable, overviewPlacer(home, nodeIdToLayerId)).length;
  }, [data, nodeIdToLayerId]);

  return useMemo(() => {
    const none = { nodes: baseNodes, edges: baseEdges, data, mode, projection: null, picked: 0, inNoLayer };
    if (data.status !== "ready" || mode === "off" || baseNodes.length === 0) return none;
    if (level === "layer-detail" && activeLayerId === null) return none;
    const picked = level === "overview" || mode === "all" ? data.index.drawable : selectedNodeId === null ? [] : relationsOfNode(data.index, selectedNodeId);
    const homes = new Map<string, string | null>();
    const home = (id: string) => {
      if (!homes.has(id)) homes.set(id, drawnHome(id, data.drawn, data.parentOf));
      return homes.get(id) ?? null;
    };
    const place = level === "overview"
      ? overviewPlacer(home, nodeIdToLayerId)
      : layerPlacer({ home, layerOf: nodeIdToLayerId, layersOf: nodeIdToLayerIds, activeLayerId: activeLayerId as string, shown: new Set(baseNodes.map((n) => n.id)), boxOf: boxOf ?? new Map() });
    const projection = projectRelations(picked, place);

    // The stand-ins go in one column to the right of the drawn nodes, so turning relations on moves no node.
    const top = baseNodes.filter((n) => n.parentId === undefined);
    const right = Math.max(...top.map((n) => n.position.x + (n.width ?? n.measured?.width ?? FALLBACK_WIDTH)));
    const minY = Math.min(...top.map((n) => n.position.y));
    const translate = translatorOf(nameTranslations);
    const layerName = new Map((graph?.layers ?? []).map((l) => [l.id, l.name]));
    const standIns: StandInFlowNode[] = projection.standIns.map((standIn, i) => {
      const english = standIn.kind === "external" ? externalLabel(standIn.key) : layerName.get(standIn.key) ?? standIn.key;
      const { label, original } = standIn.kind === "external" ? domainTitle(english, translate) : { label: english, original: null };
      return {
        id: standIn.id,
        type: "relation-stand-in",
        position: { x: right + STAND_IN_GAP_X, y: minY + i * STAND_IN_STEP_Y },
        width: STAND_IN_WIDTH,
        data: { standIn, label, original, note: standInNote(standIn.kind) },
      };
    });
    const boxes = new Map(baseNodes.filter((n) => n.type === "container").map((n) => [n.id, n]));
    const anchors = new Map<string, Node>();
    const end = (id: string): string => {
      const box = boxes.get(id);
      if (box === undefined) return id;
      const anchorId = `${ANCHOR_PREFIX}${id}`;
      const width = box.width ?? (box.style?.width as number | undefined) ?? FALLBACK_WIDTH;
      const height = box.height ?? (box.style?.height as number | undefined) ?? 0;
      if (!anchors.has(anchorId)) {
        anchors.set(anchorId, { id: anchorId, type: "relation-anchor", parentId: id, position: { x: width - 1, y: height / 2 }, data: {}, selectable: false, focusable: false });
      }
      return anchorId;
    };
    const edges: Edge[] = projection.edges.map((edge) => {
      const style = kindStyle(edge.kind);
      return {
        id: edge.id,
        source: end(edge.source),
        target: end(edge.target),
        label: edgeLabel(edge.kind),
        style: { stroke: style.stroke, strokeWidth: 1.75, strokeDasharray: style.dash },
        labelStyle: { fill: style.stroke, fontSize: 10, fontWeight: 600 },
        zIndex: 1,
      };
    });
    return { nodes: [...baseNodes, ...anchors.values(), ...standIns], edges: [...baseEdges, ...edges], data, mode, projection, picked: picked.length, inNoLayer };
  }, [baseNodes, baseEdges, data, mode, level, selectedNodeId, activeLayerId, nodeIdToLayerId, nodeIdToLayerIds, boxOf, graph, nameTranslations, inNoLayer]);
}

/** A click on a stand-in: another layer opens that layer. True when it was a stand-in. */
export function useStandInClick(): (nodeId: string) => boolean {
  const drillIntoLayer = useDashboardStore((s) => s.drillIntoLayer);
  return useCallback((nodeId: string) => {
    if (!isStandInId(nodeId)) return false;
    const rest = nodeId.slice(STAND_IN_PREFIX.length);
    if (rest.startsWith("layer:")) {
      drillIntoLayer(rest.slice("layer:".length));
      return true;
    }
    // An external system has no page of its own: the stand-in is the whole of what the graph shows for it.
    return true;
  }, [drillIntoLayer]);
}

const MODES: readonly RelationsMode[] = ["off", "selected", "all"];
const MODE_LABELS: Record<RelationsMode, string> = { off: "Off", selected: "Selected node", all: "All" };

/** The toggle and legend at the bottom of the graph: what is drawn, and how many relations are not drawn and why. */
export function RelationsPanel({ overlay, level }: { overlay: RelationsOverlay; level: "overview" | "layer-detail" }) {
  const setMode = useDashboardStore((s) => s.setRelationsMode);
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);
  const { data, mode, projection } = overlay;
  const inNoLayer = overlay.inNoLayer ?? 0;
  const available = data.status === "ready";
  const kinds = projection === null ? [] : [...new Set(projection.edges.map((e) => e.kind))].sort();

  let status: string;
  let title: string;
  if (data.status === "loading") {
    status = "Reading the relations product.";
    title = status;
  } else if (data.status === "unavailable") {
    // The state's own lines; the reason stays visible, not only on hover.
    status = [`Not drawn: the relations product is ${data.word}.`, ...data.lines.filter((line) => !line.startsWith("Status:"))].join(" \u00b7 ");
    title = data.lines.join("\n");
  } else {
    const { index } = data;
    status =
      relationsNotDrawnSentence({
        mode,
        level,
        hasSelection: selectedNodeId !== null,
        drawn: projection?.drawn ?? 0,
        inView: projection?.inView ?? 0,
        inNoLayer,
        notInGraph: index.notInGraph.length,
        notLinked: index.notLinked,
      }) ?? "";
    title = [
      "Only linked relations with both ends in the knowledge graph (or a call to an external system) are drawn.",
      "A relation whose end is in no layer, or whose end node is not in the graph, is not drawn.",
      "Relations in other buckets (caller-only, receiver-only, address-unresolved, ambiguous, quote-failed) are never drawn; the node panel lists them.",
      "A relation whose two ends sit on one node or box, or whose end this view hides, is not drawn here.",
      level === "overview" ? "The overview draws one edge per layer pair and kind." : "A layer draws the selected node's relations, or all of the layer's.",
    ].join("\n");
  }

  return (
    <Panel position="bottom-center" className="!m-2">
      <div
        className="flex max-w-[min(92vw,900px)] flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border-subtle bg-surface/90 px-2 py-1 text-[11px] shadow-lg"
        data-excavator-relations-panel={available ? mode : data.status}
      >
        <span className="font-medium text-text-secondary">Relations</span>
        <div className="inline-flex items-center rounded-md bg-elevated p-0.5" role="group" aria-label="Relations drawn">
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              disabled={!available}
              aria-pressed={available && mode === m}
              data-excavator-relations-mode={m}
              onClick={() => setMode(m)}
              className={`rounded px-2 py-0.5 font-medium transition-colors ${
                !available ? "cursor-not-allowed text-text-muted" : mode === m ? "bg-accent/20 text-accent" : "text-text-muted hover:text-text-secondary"
              }`}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
        {kinds.map((kind) => (
          <span key={kind} className="inline-flex items-center gap-1 text-text-secondary" data-excavator-relations-kind={kind}>
            <svg width="22" height="6" aria-hidden="true"><line x1="0" y1="3" x2="22" y2="3" stroke={kindStyle(kind).stroke} strokeWidth="2" strokeDasharray={kindStyle(kind).dash} /></svg>
            {kind}
          </span>
        ))}
        {status !== "" && <span className="text-text-muted" title={title} data-excavator-relations-status="">{status}</span>}
      </div>
    </Panel>
  );
}
