/**
 * Which canvas nodes and edges stay at full strength while one node is selected; everything else is dimmed to
 * `DIMMED_OPACITY`. Pure: the views apply it through node and edge `style.opacity`, so no layout is rebuilt.
 */

export const DIMMED_OPACITY = 0.3;

export type EmphasisLevel = "overview" | "groups" | "lanes" | "structural";

export interface EmphasisNode {
  id: string;
}
export interface EmphasisEdge {
  id: string;
  source: string;
  target: string;
}
export interface LaneRowShape {
  flowId: string;
  steps: string[];
}

export interface Emphasis {
  nodes: Set<string>;
  edges: Set<string>;
}

/** The ids the lanes draw for a row: its separator, and one copy of each step (a shared step is drawn once per row). */
export const laneBandId = (flowId: string): string => `lane:${flowId}`;
export const laneStepId = (flowId: string, stepId: string): string => `${flowId}>${stepId}`;

export interface EmphasisInput {
  level: EmphasisLevel;
  /** The node the selection stands for on this level: the holder card, already resolved by the caller. */
  selectedId: string | null;
  nodes: readonly EmphasisNode[];
  edges: readonly EmphasisEdge[];
  /** The lane rows, for the lanes level. */
  rows?: readonly LaneRowShape[];
}

/** The ids at full strength, or null when nothing is selected (nothing is dimmed then). */
export function emphasis({ level, selectedId, edges, rows = [] }: EmphasisInput): Emphasis | null {
  if (selectedId === null) return null;
  if (level === "groups") return { nodes: new Set([selectedId]), edges: new Set() };

  if (level === "lanes") {
    const full: Emphasis = { nodes: new Set(), edges: new Set() };
    for (const row of rows) {
      if (row.flowId !== selectedId && !row.steps.includes(selectedId)) continue;
      full.nodes.add(laneBandId(row.flowId));
      full.nodes.add(row.flowId);
      for (const step of row.steps) full.nodes.add(laneStepId(row.flowId, step));
    }
    for (const edge of edges) if (full.nodes.has(edge.source) && full.nodes.has(edge.target)) full.edges.add(edge.id);
    return full;
  }

  const keep = new Set([selectedId]);
  for (const edge of edges) {
    if (edge.source === selectedId) keep.add(edge.target);
    if (edge.target === selectedId) keep.add(edge.source);
  }
  const kept = new Set<string>();
  for (const edge of edges) {
    // The overview draws only the selected domain's own edges; the structural view also keeps edges among the neighbours.
    const keepEdge = level === "overview" ? edge.source === selectedId || edge.target === selectedId : keep.has(edge.source) && keep.has(edge.target);
    if (keepEdge) kept.add(edge.id);
  }
  return { nodes: keep, edges: kept };
}
