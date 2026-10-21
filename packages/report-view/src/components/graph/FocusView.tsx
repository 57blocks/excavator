import { Background, BackgroundVariant, Controls, MarkerType, MiniMap, Panel, ReactFlow, useReactFlow, type Edge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useCounts, useReady, useSignal } from '../../hooks/use-signals';
import { asPixels, measureFitPadding } from '../../lib/fit-padding';
import { startLayoutTask, LayoutCancelled } from '../../lib/force-layout-client';
import type { ForcePosition } from '../../lib/force-layout';
import { createForceWorker } from '../../lib/force-worker';
import { formatNumber } from '../../lib/format';
import { FOCUS_LIMIT, focusSet, type FocusSet } from '../../lib/graph-focus';
import { shownEdgeTypes, type GraphFilters } from '../../lib/graph-filters';
import { visibilityOf } from '../../lib/graph-visibility';
import { DURATION } from '../../lib/motion';
import { useGraphUi } from '../../state/graph-ui';
import { nodeColor } from '../../lib/node-colors';
import type { GraphScene } from '../../state/graph-scene';
import { LoadError } from '../ProductPage';
import { FLOATING_EDGE_TYPES } from './FloatingEdge';
import { FOCUS_CENTER_SIZE, FOCUS_NODE_SIZE, FOCUS_NODE_TYPES, type FocusData } from './FocusNodes';

const GLASS = 'glass rounded-card';
const LABELS_UP_TO = 12;
const INK = 'var(--color-ink-soft)';
const ACCENT = 'var(--color-accent)';

interface Laid {
  key: string;
  positions: Map<string, ForcePosition>;
  ms: number;
}

let requests = 0;

/** Lay the focus set out in a worker; `key` names the set, and a new key starts a new layout. */
function useForceLayout(key: string, set: FocusSet): { laid: Laid | null; failure: Error | null } {
  const [laid, setLaid] = useState<Laid | null>(null);
  const [failure, setFailure] = useState<Error | null>(null);
  useEffect(() => {
    setFailure(null);
    const requestId = (requests += 1);
    const nodes = [
      { id: set.center, ...FOCUS_CENTER_SIZE, fixed: true },
      ...set.drawn.map((id) => ({ id, ...FOCUS_NODE_SIZE })),
    ];
    const links = set.edges.map((edge) => ({ source: edge.source, target: edge.target }));
    const started = performance.now();
    const task = startLayoutTask({ requestId, nodes, links }, createForceWorker);
    task.promise.then(
      (positions) => setLaid({ key, positions: new Map(positions.map((p) => [p.id, p])), ms: performance.now() - started }),
      (error: unknown) => {
        if (!(error instanceof LayoutCancelled)) setFailure(error instanceof Error ? error : new Error(String(error)));
      },
    );
    return () => task.cancel();
    // `key` names the set.
  }, [key]);
  return { laid: laid !== null && laid.key === key ? laid : null, failure };
}

/** The node's neighbours and the edges among them, drawn by a force layout run in a worker. */
export function FocusView({ scene, centerId, filters, onSelect, onExit }: {
  scene: GraphScene;
  centerId: string;
  filters: GraphFilters;
  onSelect: (nodeId: string) => void;
  onExit: () => void;
}) {
  const { model, structure, choices } = scene;
  const { index } = model;
  const reduce = useReducedMotion();
  const { fitView } = useReactFlow();
  const ui = useGraphUi();
  const drawerOpen = ui.drawer !== 'closed';
  const [hovered, setHovered] = useState<string | null>(null);

  const edgeTypes = useMemo(() => shownEdgeTypes(filters, choices.edgeTypes, true), [filters, choices]);
  const visibility = useMemo(() => visibilityOf(index, structure, filters), [index, structure, filters]);
  const set = useMemo(() => focusSet(index, centerId, { edgeTypes, nodeVisible: visibility?.nodeVisible }), [index, centerId, edgeTypes, visibility]);
  const key = `${centerId}|${[...edgeTypes].sort().join(',')}|${[...filters.nodeTypes].sort().join(',')}|${[...filters.layers].sort().join(',')}`;
  const { laid, failure } = useForceLayout(key, set);

  useReady(failure ? 'error' : laid ? 'ready' : 'loading');
  useCounts(laid ? { 'focus-nodes': set.neighbours.length, 'focus-drawn': set.drawn.length, 'focus-edges': set.edges.length } : null);
  useSignal('focus-ms', laid ? laid.ms.toFixed(1) : null);
  useSignal('focus-center', laid ? centerId : null);

  const flow = useMemo(() => {
    if (!laid) return { nodes: [] as Node[], edges: [] as Edge[] };
    const nodes: Node[] = [centerId, ...set.drawn].flatMap((id) => {
      const node = index.nodesById.get(id);
      const at = laid.positions.get(id);
      if (!node || !at) return [];
      const center = id === centerId;
      const data: FocusData = { name: node.name, type: node.type, center, onSelect };
      return [{ id, type: 'focus', data, position: { x: at.x, y: at.y }, ...(center ? FOCUS_CENTER_SIZE : FOCUS_NODE_SIZE), draggable: false } satisfies Node];
    });
    // One line for each pair of nodes and direction, labelled with the types of the edges it stands for.
    const byPair = new Map<string, { source: string; target: string; types: string[] }>();
    for (const edge of set.edges) {
      const pair = `${edge.source.length}:${edge.source}${edge.target}`;
      const entry = byPair.get(pair);
      if (entry) entry.types.push(edge.type);
      else byPair.set(pair, { source: edge.source, target: edge.target, types: [edge.type] });
    }
    const labelAll = set.drawn.length <= LABELS_UP_TO;
    const edges: Edge[] = [...byPair.values()].map((pair, i) => {
      const touchesCenter = pair.source === centerId || pair.target === centerId;
      const touchesHover = hovered !== null && (pair.source === hovered || pair.target === hovered);
      const lit = touchesHover || (hovered === null && touchesCenter);
      const dimmed = hovered !== null && !touchesHover;
      const colour = lit ? ACCENT : INK;
      const marker = { type: MarkerType.ArrowClosed, width: 26, height: 26, color: colour, markerUnits: 'userSpaceOnUse' };
      return {
        id: `focus-edge:${i}`,
        source: pair.source,
        target: pair.target,
        type: 'floating',
        ...(touchesHover || (hovered === null && labelAll && touchesCenter) ? { label: pair.types.join(', ') } : {}),
        focusable: false,
        selectable: false,
        zIndex: lit ? 10 : 0,
        markerEnd: marker,
        style: { stroke: colour, strokeOpacity: dimmed ? 0.07 : lit ? 0.9 : 0.38, strokeWidth: lit ? 2 : 1.2 },
        labelStyle: { fontSize: 12, fontFamily: 'var(--font-mono)', fill: 'var(--color-ink)', fontWeight: 600 },
        labelBgStyle: { fill: 'var(--color-surface)', fillOpacity: 0.95 },
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 6,
      };
    });
    return { nodes, edges };
  }, [laid, set, index, centerId, hovered, onSelect]);

  // The camera fits the set, above the drawer when that is open.
  const pane = useRef<HTMLDivElement | null>(null);
  const fitted = useRef<string | null>(null);
  useEffect(() => {
    if (!laid || !pane.current) return undefined;
    const mark = `${laid.key}|${drawerOpen}`;
    if (fitted.current === mark) return undefined;
    const frame = requestAnimationFrame(() => {
      if (!pane.current) return;
      fitted.current = mark;
      // The card above the canvas is measured; the drawer, when open, takes the lower part.
      const padding = { ...asPixels(measureFitPadding(pane.current)), ...(drawerOpen ? { bottom: '46%' as const } : {}) };
      fitView({ duration: reduce ? 0 : DURATION.camera * 1000, padding, maxZoom: 1.1 });
    });
    return () => cancelAnimationFrame(frame);
  }, [laid, drawerOpen, reduce, fitView]);

  const center = index.nodesById.get(centerId);
  const edgeTypeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const edge of set.edges) counts.set(edge.type, (counts.get(edge.type) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  }, [set]);

  if (failure) return <div className="p-6"><LoadError title="The focus view could not be laid out" error={failure} /></div>;
  return (
    <div ref={pane} className="relative size-full" data-xv-graph="" data-xv-view="focus">
      <ReactFlow
        nodes={flow.nodes}
        edges={flow.edges}
        nodeTypes={FOCUS_NODE_TYPES}
        edgeTypes={FLOATING_EDGE_TYPES}
        onNodeMouseEnter={(_event, node) => setHovered(node.id)}
        onNodeMouseLeave={() => setHovered(null)}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        edgesFocusable={false}
        minZoom={0.05}
        maxZoom={2}
        colorMode="light"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--color-line-2)" />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable nodeColor={(node) => nodeColor(String((node.data as { type?: string }).type ?? ''))} className="!rounded-card !border !border-line" />
        <Panel position="top-left" data-xv-chrome="top" className={`${GLASS} !m-3 max-w-[min(560px,calc(100%-24px))] px-3 py-2.5`}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="text-[15px] font-semibold text-ink">Focus</span>
            <span className="min-w-0 truncate text-[13px] text-ink-soft" title={center?.name}>{center?.name ?? centerId}</span>
            <button type="button" onClick={onExit} className="cursor-pointer rounded-control border border-line-2 bg-surface px-3 py-1 text-[13px] text-ink hover:border-accent hover:text-accent">
              Exit focus
            </button>
          </div>
          <p className="mt-1.5 text-xs text-muted">
            {set.neighbours.length === 0
              ? 'This node has no neighbours under the current filters.'
              : `${formatNumber(set.neighbours.length)} neighbour${set.neighbours.length === 1 ? '' : 's'}: the nodes at the other end of its edges`}
            {edgeTypeCounts.length > 0 ? `. Edges shown: ${edgeTypeCounts.map(([type, n]) => `${formatNumber(n)} ${type}`).join(', ')}.` : '.'}
          </p>
          {set.neighbours.length > FOCUS_LIMIT ? <p className="mt-1 text-xs text-muted">{`The first ${formatNumber(FOCUS_LIMIT)} neighbours by name are drawn; ${formatNumber(set.neighbours.length - FOCUS_LIMIT)} more are not.`}</p> : null}
        </Panel>
      </ReactFlow>
    </div>
  );
}
