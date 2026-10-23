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
import { aggregateEdges, DEFAULT_EDGE_TYPES, edgeLabel, levelEnds, type AggregatedEdge } from './graph-edges';
import { childBox, entrySize, layoutNodes, prefersGrid, type Box, type LevelLayout } from './graph-layout';
import { fileChildren, type Level, type LevelEntry, type Structure } from './graph-structure';
import { anyOverlay, entryMarks, hotspotsRules, nodeMarks, type HotspotsScales, type NodeMarks, type OverlayFacts } from './overlays';

export interface LevelPlan {
  /** For each open file of the level: the nodes it shows and how many more it owns. */
  open: ReadonlyMap<string, { shown: readonly GraphNode[]; more: number }>;
  /** The files of the level that have a node to show when opened (a file whose nodes the mode all hides has none). */
  openable: ReadonlySet<string>;
  /** The file that owns each shown node. */
  fileOf: ReadonlyMap<string, string>;
  edges: readonly AggregatedEdge[];
  /** The drawn thing a node stands in at this level; null when the level does not draw it. */
  endOf: (nodeId: string) => string | null;
}

export interface PlanOptions {
  /** The edge types to draw. */
  edgeTypes?: ReadonlySet<string>;
  /** A node that is not visible takes no part in an edge. */
  nodeVisible?: (nodeId: string) => boolean;
  /**
   * The nodes an open file may draw as its own rows (the mode's choice, design D1). A node it may not draw still takes
   * part in edges, as its file: the counts and the edges of the level are the same either way.
   */
  childDrawn?: (node: GraphNode) => boolean;
}

/** Which nodes the open files show and the edges between everything the level draws. */
export function planLevel(structure: Structure, index: GraphIndex, graphEdges: readonly GraphEdge[], level: Level, expanded: ReadonlySet<string>, options: PlanOptions = {}): LevelPlan {
  const open = new Map<string, { shown: readonly GraphNode[]; more: number }>();
  const openable = new Set<string>();
  const fileOf = new Map<string, string>();
  const shown = new Map<string, ReadonlySet<string>>();
  const { childDrawn } = options;
  for (const entry of level.entries) {
    if (entry.kind !== 'file') continue;
    const owned = structure.owned.get(entry.id) ?? [];
    if (childDrawn ? owned.some(childDrawn) : owned.length > 0) openable.add(entry.id);
    if (!expanded.has(entry.id)) continue;
    const children = fileChildren(structure, entry.id, undefined, childDrawn);
    if (children.shown.length === 0) continue;
    open.set(entry.id, children);
    shown.set(entry.id, new Set(children.shown.map((node) => node.id)));
    for (const node of children.shown) fileOf.set(node.id, entry.id);
  }
  const ends = levelEnds(level, index.owningFile, shown);
  const { nodeVisible, edgeTypes = DEFAULT_EDGE_TYPES } = options;
  const endOf = nodeVisible ? (nodeId: string) => (nodeVisible(nodeId) ? ends(nodeId) : null) : ends;
  return { open, openable, fileOf, edges: aggregateEdges(graphEdges, endOf, edgeTypes), endOf };
}

/** The rows an open file adds to its box: its shown nodes, and one for the note that there are more. */
const rowsOf = (plan: LevelPlan, fileId: string) => {
  const children = plan.open.get(fileId);
  return children ? children.shown.length + (children.more > 0 ? 1 : 0) : 0;
};

/** Place the entries of the level (as a grid when the level is dense, see prefersGrid); an edge to a shown node is laid out as an edge to its file. */
export function layoutPlan(level: Level, plan: LevelPlan): Promise<LevelLayout> {
  const outer = (id: string) => plan.fileOf.get(id) ?? id;
  return layoutNodes(
    level.entries.map((entry) => ({ id: entry.id, size: entrySize(entry, rowsOf(plan, entry.id)) })),
    plan.edges.map((edge) => [outer(edge.source), outer(edge.target)] as const),
    { grid: prefersGrid(level.entries.length, plan.edges.length) },
  );
}

/** The box (in the level's coordinates) of node `nodeId` as the level draws it: a file's own box, or the row an open file gives a node it shows; null when the level does not draw it. */
export function nodeRect(plan: LevelPlan, layout: LevelLayout, nodeId: string): Box | null {
  const own = layout.boxes.get(nodeId);
  if (own) return own;
  const fileId = plan.fileOf.get(nodeId);
  const fileBox = fileId === undefined ? undefined : layout.boxes.get(fileId);
  const row = fileId === undefined ? -1 : (plan.open.get(fileId)?.shown.findIndex((node) => node.id === nodeId) ?? -1);
  if (!fileBox || row === -1) return null;
  const inside = childBox(row);
  return { x: fileBox.x + inside.x, y: fileBox.y + inside.y, width: inside.width, height: inside.height };
}

/** What a path lights up at a level: the drawn things it passes through and the drawn edges between consecutive ones. */
export interface PathHighlight {
  entries: ReadonlySet<string>;
  edges: ReadonlySet<string>;
}

/** The entries and aggregated edges of `plan` that the path through `nodeIds` runs along; a step the level does not draw is skipped. */
export function pathHighlight(plan: LevelPlan, nodeIds: readonly string[]): PathHighlight {
  const entries = new Set<string>();
  const edges = new Set<string>();
  // Length-prefixed, so ids that contain any separator cannot make two pairs one.
  const pair = (a: string, b: string) => `${a.length}:${a}${b}`;
  const byPair = new Map<string, string>();
  for (const edge of plan.edges) {
    byPair.set(pair(edge.source, edge.target), edge.id);
    byPair.set(pair(edge.target, edge.source), edge.id);
  }
  let previous: string | null = null;
  for (const id of nodeIds) {
    const end = plan.endOf(id);
    if (end !== null) entries.add(plan.fileOf.get(end) ?? end);
    if (end !== null && previous !== null && end !== previous) {
      const edgeId = byPair.get(pair(previous, end));
      if (edgeId !== undefined) edges.add(edgeId);
    }
    if (end !== null) previous = end;
  }
  return { entries, edges };
}

/** How the overlays that are on draw the entries of a level: each entry's marks, and the facts the rows of open files are read from. */
export interface OverlayView {
  entries: ReadonlyMap<string, NodeMarks>;
  facts: OverlayFacts;
  /** The bands the hotspots overlay uses at this level, one scale for each rule an entry takes; null with the overlay off. */
  scales: HotspotsScales | null;
}

/**
 * The marks of every entry of `level`. Hotspots bands each entry by its own rule (a file by its score, a directory the
 * product lists by the product's score for it, a layer, fold or other directory by the sum of its files' scores among
 * its siblings); a directory, layer or fold takes what its files have for the other overlays. Null when no overlay is on.
 */
export function levelMarks(level: Level, facts: OverlayFacts): OverlayView | null {
  if (!anyOverlay(facts)) return null;
  const rules = facts.hotspots ? hotspotsRules(level.entries, facts.hotspots) : null;
  const entries = new Map<string, NodeMarks>();
  for (const entry of level.entries) {
    const marks = entryMarks(entry.members, facts, entry.kind !== 'file', rules?.byEntry.get(entry.id));
    if (marks) entries.set(entry.id, marks);
  }
  return { entries, facts, scales: rules?.scales ?? null };
}

export interface FlowView {
  /** The selected node (a file, or a node an open file shows). */
  selected: string | null;
  /** The selected cluster, directory or fold. */
  selectedEntry: string | null;
  /** The node the pointer is over. */
  hovered: string | null;
  /** The edge the pointer is over. */
  hoveredEdge: string | null;
  path: PathHighlight | null;
  onOpen: (entry: LevelEntry) => void;
  onDetails: (entry: LevelEntry) => void;
  onSelect: (nodeId: string) => void;
  onToggle: (fileId: string) => void;
}

/** The stroke width of an edge that stands for `count` edges: it grows with the logarithm of the count. */
export function edgeWidth(count: number): number {
  return Math.min(1 + Math.log2(Math.max(1, count) + 1) * 0.7, 7);
}

/** The React Flow nodes (a file before the nodes it shows, as React Flow needs) of a laid-out level. */
export function flowNodes(level: Level, plan: LevelPlan, layout: LevelLayout, view: Pick<FlowView, 'selected' | 'selectedEntry' | 'path' | 'onOpen' | 'onDetails' | 'onSelect' | 'onToggle'> & { overlay?: OverlayView | null }): Node[] {
  const nodes: Node[] = [];
  const onPath = (id: string) => view.path?.entries.has(id) ?? false;
  for (const entry of level.entries) {
    const box = layout.boxes.get(entry.id);
    if (!box) continue;
    const place = { position: { x: box.x, y: box.y }, width: box.width, height: box.height, draggable: false };
    if (entry.kind !== 'file') {
      const data: GroupData = { entry, selected: view.selectedEntry === entry.id, onPath: onPath(entry.id), onOpen: view.onOpen, onDetails: view.onDetails, marks: view.overlay?.entries.get(entry.id) ?? null };
      nodes.push({ id: entry.id, type: 'container', data, ...place });
      continue;
    }
    const children = plan.open.get(entry.id);
    const data: FileData = {
      entry,
      selected: view.selected === entry.id,
      onPath: onPath(entry.id),
      expanded: plan.openable.has(entry.id) ? children !== undefined : null,
      onSelect: view.onSelect,
      onToggle: view.onToggle,
      marks: view.overlay?.entries.get(entry.id) ?? null,
    };
    nodes.push({ id: entry.id, type: 'file', data, ...place });
    children?.shown.forEach((node, i) => {
      const row = childBox(i);
      const mark = view.overlay ? nodeMarks(node.id, view.overlay.facts) : null;
      const unused = mark !== null && mark.confidence !== null ? { confidence: mark.confidence, title: mark.title } : null;
      const childData: ChildData = { name: node.name, type: node.type, selected: view.selected === node.id, onPath: onPath(node.id), more: null, unused, onSelect: view.onSelect };
      nodes.push({ id: node.id, type: 'child', parentId: entry.id, extent: 'parent', data: childData, position: { x: row.x, y: row.y }, width: row.width, height: row.height, draggable: false });
    });
    if (children && children.more > 0) {
      const row = childBox(children.shown.length);
      const moreData: ChildData = { name: '', type: '', selected: false, onPath: false, more: children.more, unused: null, onSelect: view.onSelect };
      nodes.push({ id: `more:${entry.id}`, type: 'child', parentId: entry.id, extent: 'parent', data: moreData, position: { x: row.x, y: row.y }, width: row.width, height: row.height, draggable: false, selectable: false });
    }
  }
  return nodes;
}

const INK = 'var(--color-ink-soft)';
const ACCENT = 'var(--color-accent)';
const BASE_OPACITY = 0.32;
const DIM_OPACITY = 0.07;

/**
 * The React Flow edges of a plan. Only the edge under the pointer carries its
 * count label: the edges of a selected or hovered node are lit but not labelled,
 * because the labels of one node's edges, drawn together, sit on each other and
 * on the cards (the sidebar lists the same edges with their counts). The label is
 * drawn above the cards on an opaque box. While a node or cluster is active the
 * edges that do not touch it are dimmed. Edges on a highlighted path are drawn in
 * the accent colour. Nothing is left out: a dimmed edge is still there, and still
 * has its label on hover.
 */
export function flowEdges(plan: LevelPlan, view: Pick<FlowView, 'selected' | 'selectedEntry' | 'hovered' | 'hoveredEdge' | 'path'> & { floating?: boolean }): Edge[] {
  const active = new Set<string>();
  for (const id of [view.hovered, view.selected !== null ? (plan.endOf(view.selected) ?? view.selected) : null, view.selectedEntry]) {
    if (id !== null) active.add(id);
  }
  // A file that is active also lights the edges of the nodes it shows.
  const outer = (id: string) => plan.fileOf.get(id) ?? id;
  const isActive = (end: string) => active.has(end) || active.has(outer(end));
  return plan.edges.map((edge) => {
    const touches = isActive(edge.source) || isActive(edge.target);
    const onPath = view.path?.edges.has(edge.id) ?? false;
    const hovered = view.hoveredEdge === edge.id;
    const lit = touches || onPath || hovered;
    const dimmed = (active.size > 0 || view.path !== null) && !lit;
    const colour = onPath || touches || hovered ? ACCENT : INK;
    const width = edgeWidth(edge.count) + (onPath ? 1.5 : 0);
    // The arrowhead keeps its size however wide the line is.
    const marker = { type: MarkerType.ArrowClosed, width: 26, height: 26, color: colour, markerUnits: 'userSpaceOnUse' };
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      ...(view.floating ? { type: 'floating' } : {}),
      ...(hovered ? { label: edgeLabel(edge) } : {}),
      focusable: false,
      selectable: false,
      zIndex: hovered ? 20 : lit ? 10 : 0,
      markerEnd: marker,
      ...(edge.backward ? { markerStart: marker } : {}),
      style: { stroke: colour, strokeOpacity: dimmed ? DIM_OPACITY : lit ? 0.95 : BASE_OPACITY, strokeWidth: width },
      labelStyle: { fontSize: 12, fontFamily: 'var(--font-mono)', fill: 'var(--color-ink)', fontWeight: 600 },
      labelBgStyle: { fill: 'var(--color-surface)', fillOpacity: 1 },
      labelBgPadding: [6, 3] as [number, number],
      labelBgBorderRadius: 6,
    };
  });
}

/** The React Flow nodes and edges of a laid-out level. */
export function flowOf(level: Level, plan: LevelPlan, layout: LevelLayout, view: FlowView): { nodes: Node[]; edges: Edge[] } {
  return { nodes: flowNodes(level, plan, layout, view), edges: flowEdges(plan, view) };
}
