import { Background, BackgroundVariant, Controls, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Breadcrumbs, Legend, SelectedCard } from '../components/graph/GraphChrome';
import { NODE_TYPES } from '../components/graph/GraphNodes';
import { LoadError } from '../components/ProductPage';
import { Card } from '../components/ui/Card';
import { Page } from '../components/ui/Page';
import { unavailableCard } from '../components/ui/ProductCards';
import { loadGraphModel, type GraphModel } from '../data/model';
import { navigate, useRoute } from '../hooks/use-route';
import { useCounts, useReady, useSignal } from '../hooks/use-signals';
import { flowOf, layoutPlan, planLevel, type LevelPlan } from '../lib/graph-flow';
import type { LevelLayout } from '../lib/graph-layout';
import { buildLevel, buildStructure, levelNotes, type Crumb, type Level, type LevelEntry, type Structure } from '../lib/graph-structure';
import { DURATION } from '../lib/motion';
import { nodeColor } from '../lib/node-colors';
import { buildHash } from '../lib/route';
import { useLoaded, useProduct, useViewer } from '../state/viewer';

const NO_FILES: ReadonlySet<string> = new Set();

const levelKeyOf = (level: Level) => `${level.path}#${level.fold ?? ''}`;

/** The hash of the graph page at a level, with `node` selected when given. */
const graphHash = (path: string, fold: string | null, node: string | null = null) => buildHash('graph', { path: path === '' ? null : path, fold, node });

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

function LevelView({ model, structure, level }: { model: GraphModel; structure: Structure; level: Level }) {
  const { route } = useRoute();
  const selected = route.params.node ?? null;
  const reduce = useReducedMotion();
  const { fitView } = useReactFlow();
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

  const [laid, setLaid] = useState<Laid | null>(null);
  const [failure, setFailure] = useState<Error | null>(null);
  const openKey = [...open].sort().join('\n');
  useEffect(() => {
    let current = true;
    const plan = planLevel(structure, model.index, model.graph.edges, level, open);
    layoutPlan(level, plan).then(
      (layout) => current && setLaid({ key: `${key}|${openKey}`, level, plan, layout }),
      (error: unknown) => current && setFailure(error instanceof Error ? error : new Error(String(error))),
    );
    return () => {
      current = false;
    };
    // `open` and `level` are what `key` and `openKey` name.
  }, [structure, model, key, openKey]);

  useReady(failure ? 'error' : laid ? 'ready' : 'loading');
  const shown = laid?.level;
  useCounts(laid && shown ? {
    'graph-level-nodes': shown.entries.length,
    'graph-level-files': shown.files,
    'graph-folded': shown.folded,
    'graph-level-edges': laid.plan.edges.length,
  } : null);
  useSignal('elk-ms', laid ? laid.layout.ms.toFixed(1) : null);
  useSignal('graph-level', shown ? levelKeyOf(shown) : null);

  const go = useCallback((entry: LevelEntry) => {
    if (entry.target) navigate(graphHash(entry.target.path, entry.target.fold));
  }, []);
  const select = useCallback((nodeId: string) => navigate(graphHash(level.path, level.fold, nodeId)), [level.path, level.fold]);
  const clearSelection = useCallback(() => {
    if (selected !== null) navigate(graphHash(level.path, level.fold));
  }, [selected, level.path, level.fold]);
  const goCrumb = useCallback((crumb: Crumb) => navigate(graphHash(crumb.path, crumb.fold)), []);

  const flow = useMemo(
    () => (laid ? flowOf(laid.level, laid.plan, laid.layout, { selected, onOpen: go, onSelect: select, onToggle: toggle }) : null),
    [laid, selected, go, select, toggle],
  );

  // The camera moves when the level changes, not when a file opens.
  const fitted = useRef<string | null>(null);
  useEffect(() => {
    if (!laid || fitted.current === levelKeyOf(laid.level)) return undefined;
    const frame = requestAnimationFrame(() => {
      fitted.current = levelKeyOf(laid.level);
      fitView({ duration: reduce ? 0 : DURATION.camera * 1000, padding: 0.15, maxZoom: 1.2 });
    });
    return () => cancelAnimationFrame(frame);
  }, [laid, reduce, fitView]);

  const types = useMemo(() => new Set([...model.index.nodesById.values()].map((node) => node.type)), [model]);
  const { manifest } = useViewer();
  const product = useProduct('knowledge-graph');
  const notes = useMemo(() => {
    const own = levelNotes(structure, level, model.index.semantics.layerSource);
    if (product.status !== 'different-revision') return own;
    return [`The graph was made at ${product.revision}; the source snapshot is ${manifest.snapshot.revision}.`, ...own];
  }, [structure, level, model, product, manifest]);

  if (failure) return <div className="p-6"><LoadError title="The graph could not be laid out" error={failure} /></div>;
  return (
    <div className="relative size-full" data-xv-graph="">
      <ReactFlow
        nodes={flow?.nodes ?? []}
        edges={flow?.edges ?? []}
        nodeTypes={NODE_TYPES}
        onPaneClick={clearSelection}
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
        <Breadcrumbs crumbs={level.crumbs} notes={notes} onGo={goCrumb} />
        <Legend types={types} />
        {selected !== null ? <SelectedCard index={model.index} nodeId={selected} onClose={clearSelection} /> : null}
      </ReactFlow>
    </div>
  );
}

function NoLevel() {
  useReady('ready');
  return (
    <div className="p-6">
      <Card title="No such level in this graph">
        <p>The address names a directory, layer or fold that the graph does not have.</p>
        <p><a href={graphHash('', null)}>Go to the top level</a></p>
      </Card>
    </div>
  );
}

function GraphCanvas({ model, structure }: { model: GraphModel; structure: Structure }) {
  const { route } = useRoute();
  const path = route.params.path ?? '';
  const fold = route.params.fold ?? null;
  const level = useMemo(() => buildLevel(structure, { path, fold }), [structure, path, fold]);
  return level ? <LevelView model={model} structure={structure} level={level} /> : <NoLevel />;
}

/** The structure graph: the default view, drawn level by level. */
export function GraphPage() {
  const { manifest, payloads } = useViewer();
  const product = useProduct('knowledge-graph');
  const unavailable = unavailableCard(product);
  const loaded = useLoaded(unavailable ? '' : 'graph', async () => {
    const model = unavailable ? null : await loadGraphModel(manifest, payloads);
    return model ? { model, structure: buildStructure(model.index) } : null;
  });
  useReady(unavailable ? 'ready' : loaded.state === 'error' ? 'error' : 'loading');
  if (unavailable || loaded.state !== 'ready' || !loaded.value) {
    return (
      <div className="h-full overflow-auto p-6">
        <Page title="Graph" subtitle={manifest.project.name}>
          {unavailable}
          {!unavailable && loaded.state === 'error' ? <LoadError title="The knowledge graph could not be read" error={loaded.error} /> : null}
        </Page>
      </div>
    );
  }
  return (
    <ReactFlowProvider>
      <GraphCanvas model={loaded.value.model} structure={loaded.value.structure} />
    </ReactFlowProvider>
  );
}
