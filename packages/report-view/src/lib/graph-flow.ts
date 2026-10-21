/**
 * From a level to what React Flow draws (openspec: changes/viewer-app, design
 * D4): which nodes an expanded file shows, the edges between what is drawn,
 * their layout, and the node and edge objects. Selection is applied last and
 * never moves anything, so a click does not lay the level out again.
 */

import { MarkerType, type Edge, type Node } from '@xyflow/react';

import type { GraphEdge, GraphNode } from '../data/graph';
import type { GraphIndex } from '../data/indexes';
import type { ChildData, FileData, GroupData } from '../components/graph/GraphNodes';
import { aggregateEdges, edgeLabel, levelEnds, type AggregatedEdge } from './graph-edges';
import { childBox, entrySize, layoutNodes, type LevelLayout } from './graph-layout';
import { fileChildren, type Level, type LevelEntry, type Structure } from './graph-structure';

export interface LevelPlan {
  /** For each open file of the level: the nodes it shows and how many more it owns. */
  open: ReadonlyMap<string, { shown: readonly GraphNode[]; more: number }>;
  /** The file that owns each shown node. */
  fileOf: ReadonlyMap<string, string>;
  edges: readonly AggregatedEdge[];
}

/** Which nodes the open files show and the edges between everything the level draws. */
export function planLevel(structure: Structure, index: GraphIndex, graphEdges: readonly GraphEdge[], level: Level, expanded: ReadonlySet<string>): LevelPlan {
  const open = new Map<string, { shown: readonly GraphNode[]; more: number }>();
  const fileOf = new Map<string, string>();
  const shown = new Map<string, ReadonlySet<string>>();
  for (const entry of level.entries) {
    if (entry.kind !== 'file' || !expanded.has(entry.id)) continue;
    const children = fileChildren(structure, entry.id);
    if (children.shown.length === 0) continue;
    open.set(entry.id, children);
    shown.set(entry.id, new Set(children.shown.map((node) => node.id)));
    for (const node of children.shown) fileOf.set(node.id, entry.id);
  }
  return { open, fileOf, edges: aggregateEdges(graphEdges, levelEnds(level, index.owningFile, shown)) };
}

/** The rows an open file adds to its box: its shown nodes, and one for the note that there are more. */
const rowsOf = (plan: LevelPlan, fileId: string) => {
  const children = plan.open.get(fileId);
  return children ? children.shown.length + (children.more > 0 ? 1 : 0) : 0;
};

/** Place the entries of the level; an edge to a shown node is laid out as an edge to its file. */
export function layoutPlan(level: Level, plan: LevelPlan): Promise<LevelLayout> {
  const outer = (id: string) => plan.fileOf.get(id) ?? id;
  return layoutNodes(
    level.entries.map((entry) => ({ id: entry.id, size: entrySize(entry, rowsOf(plan, entry.id)) })),
    plan.edges.map((edge) => [outer(edge.source), outer(edge.target)] as const),
  );
}

export interface FlowView {
  selected: string | null;
  onOpen: (entry: LevelEntry) => void;
  onSelect: (nodeId: string) => void;
  onToggle: (fileId: string) => void;
}

const EDGE_STYLE = { stroke: 'var(--color-ink-soft)', strokeOpacity: 0.4 } as const;

/** The React Flow nodes (a file before the nodes it shows, as React Flow needs) and edges of a laid-out level. */
export function flowOf(level: Level, plan: LevelPlan, layout: LevelLayout, view: FlowView): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  for (const entry of level.entries) {
    const box = layout.boxes.get(entry.id);
    if (!box) continue;
    const place = { position: { x: box.x, y: box.y }, width: box.width, height: box.height, draggable: false };
    if (entry.kind !== 'file') {
      const data: GroupData = { entry, onOpen: view.onOpen };
      nodes.push({ id: entry.id, type: 'container', data, ...place });
      continue;
    }
    const children = plan.open.get(entry.id);
    const data: FileData = {
      entry,
      selected: view.selected === entry.id,
      expanded: entry.nodes > 1 ? children !== undefined : null,
      onSelect: view.onSelect,
      onToggle: view.onToggle,
    };
    nodes.push({ id: entry.id, type: 'file', data, ...place });
    children?.shown.forEach((node, i) => {
      const row = childBox(i);
      const childData: ChildData = { name: node.name, type: node.type, selected: view.selected === node.id, more: null, onSelect: view.onSelect };
      nodes.push({ id: node.id, type: 'child', parentId: entry.id, extent: 'parent', data: childData, position: { x: row.x, y: row.y }, width: row.width, height: row.height, draggable: false });
    });
    if (children && children.more > 0) {
      const row = childBox(children.shown.length);
      const moreData: ChildData = { name: '', type: '', selected: false, more: children.more, onSelect: view.onSelect };
      nodes.push({ id: `more:${entry.id}`, type: 'child', parentId: entry.id, extent: 'parent', data: moreData, position: { x: row.x, y: row.y }, width: row.width, height: row.height, draggable: false, selectable: false });
    }
  }
  const edges: Edge[] = plan.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edgeLabel(edge),
    focusable: false,
    selectable: false,
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: 'var(--color-ink-soft)' },
    ...(edge.backward ? { markerStart: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: 'var(--color-ink-soft)' } } : {}),
    style: { ...EDGE_STYLE, strokeWidth: Math.min(1 + Math.log2(edge.count + 1) / 2, 4) },
    labelStyle: { fontSize: 11, fontFamily: 'var(--font-mono)', fill: 'var(--color-ink-soft)' },
    labelBgStyle: { fill: 'var(--color-surface)', fillOpacity: 0.9 },
    labelBgPadding: [4, 2],
    labelBgBorderRadius: 6,
  }));
  return { nodes, edges };
}
