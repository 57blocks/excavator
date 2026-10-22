import { Background, BackgroundVariant, Controls, MiniMap, ReactFlow, useReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useReveal } from '../../hooks/use-reveal';
import { useCounts, useReady, useSignal } from '../../hooks/use-signals';
import { buildDomainLevel, domainEdges, domainNodes, layoutDomainLevel, type DomainEntry, type DomainLevel } from '../../lib/domain-flow';
import type { DomainPlace } from '../../lib/domain-state';
import { boundsOf } from '../../lib/camera';
import { columnCamera } from '../../lib/column-camera';
import { asPixels, measureCards, measureFitPadding } from '../../lib/fit-padding';
import type { Crumb } from '../../lib/graph-structure';
import type { LevelLayout } from '../../lib/graph-layout';
import { DURATION } from '../../lib/motion';
import type { DomainScene } from '../../state/domain-scene';
import { useGraphUi } from '../../state/graph-ui';
import { LoadError } from '../ProductPage';
import { Breadcrumbs, TopLeft } from './GraphChrome';
import { DOMAIN_EDGE_TYPES, DOMAIN_NODE_TYPES } from './DomainNodes';

const MIN_ZOOM = 0.1;
const MAX_FIT_ZOOM = 1.1;
/** The steps of a flow are drawn at about full size: a column that does not fit is scrolled, and is not drawn below this zoom. */
const COLUMN_MAX_ZOOM = 1;
const COLUMN_MIN_ZOOM = 0.9;

interface Laid {
  key: string;
  level: DomainLevel;
  layout: LevelLayout;
}

/**
 * One level of the domain graph: the domains, the flows of a domain, or the steps of a flow, laid out with the structure
 * graph's layout. A click goes into a domain or flow or selects a step; the camera fits each level once.
 */
export function DomainView({ scene, place, selected, onOpen, onSelect, onClearSelection, onGo }: {
  scene: DomainScene;
  place: DomainPlace;
  /** The domain, flow or step shown in the sidebar. */
  selected: string | null;
  onOpen: (entry: DomainEntry) => void;
  onSelect: (id: string) => void;
  onClearSelection: () => void;
  onGo: (hash: string) => void;
}) {
  const reduce = useReducedMotion();
  const { fitView, setViewport } = useReactFlow();
  const ui = useGraphUi();
  const pane = useRef<HTMLDivElement | null>(null);
  const level = useMemo(() => buildDomainLevel(scene.index, place), [scene, place]);
  const [laid, setLaid] = useState<Laid | null>(null);
  const [failure, setFailure] = useState<Error | null>(null);
  useEffect(() => {
    let current = true;
    layoutDomainLevel(level).then(
      (layout) => current && setLaid({ key: level.key, level, layout }),
      (error: unknown) => current && setFailure(error instanceof Error ? error : new Error(String(error))),
    );
    return () => {
      current = false;
    };
  }, [level]);
  // A level laid out for another place is not shown for this one.
  const shown = laid !== null && laid.key === level.key ? laid : null;

  useReady(failure ? 'error' : shown ? 'ready' : 'loading');
  useCounts(shown ? {
    'domain-level-nodes': shown.level.entries.length,
    'domain-level-links': shown.level.links.length,
    'domain-flows': shown.level.flows,
    'domain-steps': shown.level.steps,
    ...(shown.level.place.kind === 'top' ? { 'domain-domains': shown.level.entries.length } : {}),
  } : null);
  useSignal('domain-level', shown ? shown.level.key : null);

  const [hovered, setHovered] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  const nodes = useMemo(() => (shown ? domainNodes(shown.level, shown.layout, { selected, onOpen, onSelect }) : []), [shown, selected, onOpen, onSelect]);
  const edges = useMemo(() => (shown ? domainEdges(shown.level, { selected, hovered, hoveredEdge }) : []), [shown, selected, hovered, hoveredEdge]);

  // The camera fits a level once, into what the cards over the canvas leave free; the steps of a flow are a column, fitted
  // only around the cards it is under and kept at a readable zoom.
  const fitted = useRef<string | null>(null);
  useEffect(() => {
    if (!shown || fitted.current === shown.key || !pane.current) return undefined;
    const frame = requestAnimationFrame(() => {
      if (!pane.current) return;
      fitted.current = shown.key;
      const duration = reduce ? 0 : DURATION.camera * 1000;
      const bounds = shown.level.place.kind === 'flow' ? boundsOf(shown.layout.boxes.values()) : null;
      if (bounds === null) {
        fitView({ duration, padding: asPixels(measureFitPadding(pane.current)), maxZoom: MAX_FIT_ZOOM });
        return;
      }
      const box = pane.current.getBoundingClientRect();
      setViewport(columnCamera({ bounds, pane: { width: box.width, height: box.height }, ...measureCards(pane.current), maxZoom: COLUMN_MAX_ZOOM, floor: COLUMN_MIN_ZOOM }), { duration });
    });
    return () => cancelAnimationFrame(frame);
  }, [shown, reduce, fitView, setViewport]);
  useReveal({ pane, layoutKey: shown ? shown.key : null, selected, drawerOpen: ui.drawer !== 'closed', reduce });

  const crumbs: Crumb[] = level.crumbs.map((crumb) => ({ label: crumb.label, path: crumb.hash ?? '', fold: null }));
  if (failure) return <div className="p-6"><LoadError title="The domain graph could not be laid out" error={failure} /></div>;
  return (
    <div ref={pane} className="relative size-full" data-xv-graph="" data-xv-view="domain" data-xv-domain-place={level.key}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={DOMAIN_NODE_TYPES}
        edgeTypes={DOMAIN_EDGE_TYPES}
        onPaneClick={onClearSelection}
        onNodeMouseEnter={(_event, node) => setHovered(node.id)}
        onNodeMouseLeave={() => setHovered(null)}
        onEdgeMouseEnter={(_event, edge) => setHoveredEdge(edge.id)}
        onEdgeMouseLeave={() => setHoveredEdge(null)}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        edgesFocusable={false}
        minZoom={MIN_ZOOM}
        maxZoom={2}
        colorMode="light"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--color-line-2)" />
        <Controls showInteractive={false} />
        {/* The steps of a flow are one column that fits the canvas: a minimap there only covers their right edge. */}
        {level.place.kind === 'flow' ? null : <MiniMap pannable zoomable nodeColor="var(--color-node-domain)" className="!rounded-card !border !border-line" />}
        <TopLeft>
          <Breadcrumbs crumbs={crumbs} notes={level.notes} onGo={(crumb) => crumb.path !== '' && onGo(crumb.path)} />
        </TopLeft>
      </ReactFlow>
    </div>
  );
}
