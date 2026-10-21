import { Background, BackgroundVariant, Controls, MiniMap, ReactFlow, useReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useCounts, useReady, useSignal } from '../../hooks/use-signals';
import { flowEdges, flowNodes, layoutPlan, pathHighlight, planLevel, type LevelPlan } from '../../lib/graph-flow';
import { shownEdgeTypes, type GraphFilters } from '../../lib/graph-filters';
import type { LevelLayout } from '../../lib/graph-layout';
import type { GraphState } from '../../lib/graph-state';
import { levelNotes, type Crumb, type Level, type LevelEntry } from '../../lib/graph-structure';
import { visibilityOf, visibleLevel } from '../../lib/graph-visibility';
import { DURATION } from '../../lib/motion';
import { nodeColor } from '../../lib/node-colors';
import { shortestPath } from '../../lib/path-finding';
import { useGraphUi } from '../../state/graph-ui';
import type { GraphScene } from '../../state/graph-scene';
import { useProduct, useViewer } from '../../state/viewer';
import { LoadError } from '../ProductPage';
import { Panel } from '../shell/Panel';
import { EntryDetails } from '../sidebar/EntryDetails';
import { Breadcrumbs, Legend, TopLeft } from './GraphChrome';
import { FLOATING_EDGE_TYPES } from './FloatingEdge';
import { NODE_TYPES } from './GraphNodes';
import { PathCard } from './PathCard';
import type { GraphModel } from '../../data/model';

const NO_FILES: ReadonlySet<string> = new Set();

/** The room the camera leaves around a level: the breadcrumbs above it and the legend below it sit over the canvas. */
const FIT_PADDING = { top: '120px', right: '24px', bottom: '84px', left: '24px' } as const;
/** The top of the part of the canvas that is free of the breadcrumbs. */
const SAFE_TOP = 110;

export const levelKeyOf = (level: Level) => `${level.path}#${level.fold ?? ''}`;

/** The file that owns `nodeId`, when this level draws it as a file; what an open selection needs to show. */
function fileToOpen(model: GraphModel, level: Level, nodeId: string | null): string | null {
  if (nodeId === null) return null;
  const file = model.index.owningFile.get(nodeId);
  if (file === undefined || file === nodeId) return null;
  return level.entries.some((entry) => entry.kind === 'file' && entry.id === file) ? file : null;
}

interface Laid {
  key: string;
  level: Level;
  plan: LevelPlan;
  layout: LevelLayout;
}

export interface LevelActions {
  open: (entry: LevelEntry) => void;
  details: (entry: LevelEntry) => void;
  select: (nodeId: string) => void;
  clearSelection: () => void;
  goCrumb: (crumb: Crumb) => void;
  clearPath: () => void;
}

/** One level of the structure graph: its entries, the edges between them, the selection and the path. */
export function LevelView({ scene, level, state, filters, actions }: { scene: GraphScene; level: Level; state: GraphState; filters: GraphFilters; actions: LevelActions }) {
  const { model, structure, choices } = scene;
  const selected = state.node;
  const reduce = useReducedMotion();
  const { fitView, getInternalNode, getViewport, setViewport } = useReactFlow();
  const ui = useGraphUi();
  const pane = useRef<HTMLDivElement | null>(null);
  const key = levelKeyOf(level);

  // The open files belong to one level: another level starts with none, apart from the file that holds the selection.
  const [openFiles, setOpenFiles] = useState<{ key: string; files: ReadonlySet<string> }>(() => {
    const file = fileToOpen(model, level, selected);
    return { key, files: file ? new Set([file]) : NO_FILES };
  });
  const open = openFiles.key === key ? openFiles.files : NO_FILES;
  const toOpen = fileToOpen(model, level, selected);
  useEffect(() => {
    if (toOpen !== null && !open.has(toOpen)) setOpenFiles({ key, files: new Set([...open, toOpen]) });
    // `open` is read, not watched: only a new selection or level opens a file.
  }, [key, toOpen]);

  const toggle = useCallback((fileId: string) => {
    const next = new Set(open);
    if (!next.delete(fileId)) next.add(fileId);
    setOpenFiles({ key, files: next });
  }, [key, open]);

  const edgeTypes = useMemo(() => shownEdgeTypes(filters, choices.edgeTypes, false), [filters, choices]);
  const visibility = useMemo(() => visibilityOf(model.index, structure, filters), [model, structure, filters]);
  const filterKey = `${[...edgeTypes].sort().join(',')}|${[...filters.nodeTypes].sort().join(',')}|${[...filters.layers].sort().join(',')}`;

  const [laid, setLaid] = useState<Laid | null>(null);
  const [failure, setFailure] = useState<Error | null>(null);
  const openKey = [...open].sort().join('\n');
  useEffect(() => {
    let current = true;
    const drawn = visibleLevel(level, visibility);
    const plan = planLevel(structure, model.index, model.graph.edges, drawn, open, { edgeTypes, nodeVisible: visibility?.nodeVisible });
    layoutPlan(drawn, plan).then(
      (layout) => current && setLaid({ key: `${key}|${openKey}|${filterKey}`, level: drawn, plan, layout }),
      (error: unknown) => current && setFailure(error instanceof Error ? error : new Error(String(error))),
    );
    return () => {
      current = false;
    };
    // `open`, `level`, `edgeTypes` and `visibility` are what `key`, `openKey` and `filterKey` name.
  }, [structure, model, key, openKey, filterKey]);

  useReady(failure ? 'error' : laid ? 'ready' : 'loading');
  const shown = laid?.level;
  useCounts(laid && shown ? {
    'graph-level-nodes': shown.entries.length,
    'graph-level-files': shown.files,
    'graph-folded': shown.folded,
    'graph-level-edges': laid.plan.edges.length,
  } : null);
  useSignal('elk-ms', laid ? laid.layout.ms.toFixed(1) : null);
  useSignal('graph-layout', laid ? laid.layout.kind : null);
  useSignal('graph-level', shown ? levelKeyOf(shown) : null);

  const path = useMemo(
    () => (state.from !== null && state.to !== null ? shortestPath(model.index, state.from, state.to, { directed: state.directed }) : null),
    [model, state.from, state.to, state.directed],
  );
  const highlight = useMemo(() => (laid && path ? pathHighlight(laid.plan, path.nodes) : null), [laid, path]);
  useSignal('path', state.from === null ? null : path ? `found:${path.edges.length}` : 'none');

  const [hovered, setHovered] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);

  const nodes = useMemo(
    () => (laid ? flowNodes(laid.level, laid.plan, laid.layout, { selected, selectedEntry: state.entry, path: highlight, onOpen: actions.open, onDetails: actions.details, onSelect: actions.select, onToggle: toggle }) : []),
    [laid, selected, state.entry, highlight, actions, toggle],
  );
  const edges = useMemo(
    () => (laid ? flowEdges(laid.plan, { selected, selectedEntry: state.entry, hovered, hoveredEdge, path: highlight, floating: laid.layout.kind === 'grid' }) : []),
    [laid, selected, state.entry, hovered, hoveredEdge, highlight],
  );

  // The camera moves when the level changes, not when a file opens.
  const fitted = useRef<string | null>(null);
  useEffect(() => {
    if (!laid || fitted.current === levelKeyOf(laid.level)) return undefined;
    const frame = requestAnimationFrame(() => {
      fitted.current = levelKeyOf(laid.level);
      fitView({ duration: reduce ? 0 : DURATION.camera * 1000, padding: FIT_PADDING, maxZoom: 1.2 });
    });
    return () => cancelAnimationFrame(frame);
  }, [laid, reduce, fitView]);

  // The selected node stays in view: when a layout or the drawer leaves it outside or under the drawer, the camera moves to it, keeping the zoom unless that is too small to read.
  const drawerOpen = ui.drawer !== 'closed';
  const revealed = useRef<string | null>(null);
  useEffect(() => {
    if (!laid || selected === null) return undefined;
    const mark = `${laid.key}|${selected}|${drawerOpen}`;
    if (revealed.current === mark) return undefined;
    const timer = window.setTimeout(() => {
      const node = getInternalNode(selected);
      const element = pane.current;
      if (!node || !element) return;
      revealed.current = mark;
      const { x, y, zoom } = getViewport();
      const box = element.getBoundingClientRect();
      const width = node.measured.width ?? node.width ?? 0;
      const height = node.measured.height ?? node.height ?? 0;
      const at = node.internals.positionAbsolute;
      const [left, top] = [at.x * zoom + x, at.y * zoom + y];
      const safe = { top: SAFE_TOP, bottom: drawerOpen ? box.height * 0.6 - 16 : box.height - 16, left: 16, right: box.width - 16 };
      if (left >= safe.left && top >= safe.top && left + width * zoom <= safe.right && top + height * zoom <= safe.bottom) return;
      const next = Math.min(Math.max(zoom, 0.8), 1.2);
      setViewport({ x: box.width / 2 - (at.x + width / 2) * next, y: (safe.top + safe.bottom) / 2 - (at.y + height / 2) * next, zoom: next }, { duration: reduce ? 0 : DURATION.camera * 1000 });
    }, reduce ? 0 : DURATION.camera * 1000 + 80);
    return () => window.clearTimeout(timer);
  }, [laid, selected, drawerOpen, reduce, getInternalNode, getViewport, setViewport]);

  // The drawer shows the source of the selected node; with none selected it closes.
  useEffect(() => {
    if (selected === null && ui.drawer !== 'closed') ui.setDrawer('closed');
  }, [selected, ui]);

  const types = useMemo(() => new Set([...model.index.nodesById.values()].map((node) => node.type)), [model]);
  const { manifest } = useViewer();
  const product = useProduct('knowledge-graph');
  const notes = useMemo(() => {
    const own = levelNotes(structure, level, model.index.semantics.layerSource);
    if (product.status !== 'different-revision') return own;
    return [`The graph was made at ${product.revision}; the source snapshot is ${manifest.snapshot.revision}.`, ...own];
  }, [structure, level, model, product, manifest]);

  const entry = laid && state.entry !== null ? (laid.level.entries.find((e) => e.id === state.entry) ?? null) : null;

  if (failure) return <div className="p-6"><LoadError title="The graph could not be laid out" error={failure} /></div>;
  return (
    <div ref={pane} className="relative size-full" data-xv-graph="" data-xv-view="level">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={FLOATING_EDGE_TYPES}
        onPaneClick={actions.clearSelection}
        onNodeMouseEnter={(_event, node) => setHovered(node.id)}
        onNodeMouseLeave={() => setHovered(null)}
        onEdgeMouseEnter={(_event, edge) => setHoveredEdge(edge.id)}
        onEdgeMouseLeave={() => setHoveredEdge(null)}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        edgesFocusable={false}
        minZoom={0.02}
        maxZoom={2}
        colorMode="light"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--color-line-2)" />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable nodeColor={(node) => (node.type === 'container' ? 'var(--color-line-2)' : nodeColor(node.type === 'file' ? 'file' : String((node.data as { type?: string }).type ?? '')))} className="!rounded-card !border !border-line" />
        <TopLeft>
          <Breadcrumbs crumbs={level.crumbs} notes={notes} onGo={actions.goCrumb} />
          {state.from !== null && state.to !== null ? <PathCard index={model.index} from={state.from} to={state.to} directed={state.directed} path={path} onSelect={actions.select} onClear={actions.clearPath} /> : null}
        </TopLeft>
        <Legend types={types} />
      </ReactFlow>
      <Panel slot="sidebar" open={entry !== null} title={entry?.label ?? ''} onClose={actions.clearSelection} closeOnEscape={false}>
        {entry && laid ? <EntryDetails entry={entry} level={laid.level} plan={laid.plan} onOpen={() => actions.open(entry)} /> : null}
      </Panel>
    </div>
  );
}
