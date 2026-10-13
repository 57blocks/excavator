// The graph's node visual language (artifact-view task 10.0, design D15):
// every visual channel encodes real data. Pure and DOM-free so the mapping
// rules are tested in Node; GraphCanvas only draws what these return.
//
// - Shape by kind: member / directory disc, file rounded square, function
//   circle, class hexagon, any other (non-code) node type diamond, and the
//   "more" / no-path buckets a dashed circle.
// - Fill by content: files and symbols take their language's color (the same
//   mapping as the overview and the treemap); directories and members a
//   neutral fill with a ring of their languages by lines. Layer coloring
//   replaces the fill and keeps the ring.
// - Labels: a level of detail by zoom (the largest ~20 nodes, with collision
//   culling, until the reader zooms in), always the hovered / focused one.
// - Links: one drawn path per ordered node pair, its types as colored
//   segments; width, arrow and opacity by log count.

export type NodeShape = 'disc' | 'rounded-square' | 'circle' | 'hexagon' | 'diamond' | 'dashed-circle';

/** A node's visual kind: an aggregate kind of the explorer, or the graph node type of a symbol. */
export type VisualKind = 'member' | 'dir' | 'file' | 'more' | 'nopath' | string;

const AGGREGATE_SHAPES: Record<string, NodeShape> = {
  member: 'disc',
  dir: 'disc',
  file: 'rounded-square',
  more: 'dashed-circle',
  nopath: 'dashed-circle',
};

/** Graph node types drawn as code symbols; every other type is a non-code node (diamond). */
const SYMBOL_SHAPES: Record<string, NodeShape> = {
  function: 'circle',
  class: 'hexagon',
};

export function shapeForKind(kind: VisualKind): NodeShape {
  return AGGREGATE_SHAPES[kind] ?? SYMBOL_SHAPES[kind] ?? 'diamond';
}

const GLYPHS: Record<string, string> = {
  member: '◎',
  dir: '/',
  file: '▢',
  more: '…',
  nopath: '?',
  function: 'ƒ',
  class: 'C',
  config: '⚙',
  document: '¶',
  module: 'M',
};

/** The type glyph on a node's label plate. */
export function glyphForKind(kind: VisualKind): string {
  return GLYPHS[kind] ?? '◇';
}

/** Shapes in legend order, with what each stands for. */
export const SHAPE_LEGEND: Array<{ shape: NodeShape; label: string }> = [
  { shape: 'disc', label: 'member / directory' },
  { shape: 'rounded-square', label: 'file' },
  { shape: 'circle', label: 'function' },
  { shape: 'hexagon', label: 'class' },
  { shape: 'diamond', label: 'other node type' },
  { shape: 'dashed-circle', label: 'folded ("more") / no path' },
];

/** `var(--series-1)` -> `--series-1`; a bare custom property name is returned as is. */
export function cssVarName(value: string): string {
  const m = /^var\((--[\w-]+)\)$/.exec(value.trim());
  return m ? m[1] : value;
}

export const UNKNOWN_LANGUAGE_FILL = '--graph-unknown';

/**
 * The custom property a node is filled with: the layer color when layer
 * coloring gives one; otherwise neutral tokens for aggregates and the
 * language color for files and symbols (a visible "unknown" fill when the
 * language is not known; never a guess).
 */
export function fillVar(kind: VisualKind, language: string | null, colors: Map<string, string>, layerVar: string | null = null): string {
  if (layerVar) return cssVarName(layerVar);
  if (kind === 'dir') return '--graph-dir';
  if (kind === 'member') return '--graph-member';
  if (kind === 'more' || kind === 'nopath') return '--surface-2';
  const color = language === null ? undefined : colors.get(language);
  return color ? cssVarName(color) : UNKNOWN_LANGUAGE_FILL;
}

export interface RingSegment {
  language: string;
  /** Custom property of the language color. */
  color: string;
  /** Share of the ring, 0..1. */
  share: number;
}

/** A directory's language ring from its per-language weights (lines), largest first; empty when none is known. */
export function languageRing(weights: Array<[string, number]>, colors: Map<string, string>): RingSegment[] {
  const positive = weights.filter(([, w]) => w > 0);
  const total = positive.reduce((n, [, w]) => n + w, 0);
  if (total <= 0) return [];
  return [...positive]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([language, w]) => ({ language, color: cssVarName(colors.get(language) ?? 'var(--series-other)'), share: w / total }));
}

/** In-degree ticks on a node's rim: 0 for none, then one per doubling (log2), at most 12. */
export function inDegreeTicks(inDegree: number): number {
  if (!(inDegree > 0)) return 0;
  return Math.min(12, 1 + Math.floor(Math.log2(inDegree)));
}

/** Compact count for a badge: 7, 312, 1.2k, 45k, 1.3M. */
export function compactCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

// --- links -------------------------------------------------------------------

export interface LinkSegment {
  type: string;
  count: number;
}

export interface MergedLink {
  source: number;
  target: number;
  total: number;
  /** One per edge type, heaviest first (ties by type name). */
  segments: LinkSegment[];
  /** Whether the reverse pair has a path of its own (the two curve apart). */
  reverse: boolean;
}

/** One drawn path per ordered (source, target) pair; its edge types become colored segments. */
export function mergeLinkPairs(links: Array<{ source: number; target: number; type: string; count: number }>): MergedLink[] {
  const byPair = new Map<string, MergedLink>();
  for (const link of links) {
    const key = `${link.source}>${link.target}`;
    let merged = byPair.get(key);
    if (!merged) {
      merged = { source: link.source, target: link.target, total: 0, segments: [], reverse: false };
      byPair.set(key, merged);
    }
    merged.total += link.count;
    const seg = merged.segments.find((s) => s.type === link.type);
    if (seg) seg.count += link.count;
    else merged.segments.push({ type: link.type, count: link.count });
  }
  for (const merged of byPair.values()) {
    merged.segments.sort((a, b) => b.count - a.count || (a.type < b.type ? -1 : a.type > b.type ? 1 : 0));
    merged.reverse = merged.source !== merged.target && byPair.has(`${merged.target}>${merged.source}`);
  }
  return [...byPair.values()];
}

/** Line width by log count (1 .. 5 px). */
export function linkWidth(count: number): number {
  return Math.min(5, 1 + Math.log2(Math.max(1, count)) * 0.6);
}

/** Arrowhead length by log count (5 .. 12 px). */
export function arrowSize(count: number): number {
  return Math.min(12, 5 + Math.log2(Math.max(1, count)) * 1.2);
}

/** Link opacity by log count relative to the level's heaviest link (0.35 .. 0.85). */
export function linkAlpha(count: number, maxCount: number): number {
  const top = Math.log1p(Math.max(1, maxCount));
  return 0.35 + 0.5 * (top > 0 ? Math.log1p(Math.max(0, count)) / top : 1);
}

/** Edge opacity factor and node opacity outside the focus (hovered or selected) node's neighborhood. */
export const FOCUS_DIM = 0.25;

/** Particles drawn at most at once, over every link of a level. */
export const MAX_PARTICLES = 360;

/**
 * Particles per link: min(3, 1 + log10 count) each, heaviest links first,
 * until MAX_PARTICLES is spent (lighter links then get none).
 */
export function particleCounts(totals: number[], cap = MAX_PARTICLES): number[] {
  const want = totals.map((t) => Math.min(3, 1 + Math.floor(Math.log10(Math.max(1, t)))));
  const order = totals.map((_, i) => i).sort((a, b) => totals[b] - totals[a] || a - b);
  const out = new Array<number>(totals.length).fill(0);
  let left = cap;
  for (const i of order) {
    const n = Math.min(want[i], left);
    out[i] = n;
    left -= n;
    if (left <= 0) break;
  }
  return out;
}

// --- entry stagger -------------------------------------------------------------

export const STAGGER_STEP_MS = 20;
/** The stagger of a level's last node at most, so a 400-node level is not 8 s long. */
export const STAGGER_CAP_MS = 600;

/** Delay before the node at `rank` pops out: 20 ms steps, compressed when the level is large. */
export function staggerDelay(rank: number, count: number): number {
  const step = count > 1 ? Math.min(STAGGER_STEP_MS, STAGGER_CAP_MS / (count - 1)) : 0;
  return rank * step;
}

// --- labels ----------------------------------------------------------------------

/** Labels drawn when zoomed out. */
export const LABEL_BUDGET = 20;
/** Zoomed in this far past the level's fit, every label is drawn. */
export const LABEL_ALL_ZOOM = 2.5;

export type LabelMode = 'lod' | 'all';

/** Every label once zoomed in (or when the level has few nodes); otherwise the budgeted, culled set. */
export function labelMode(k: number, fitK: number, nodeCount: number): LabelMode {
  if (nodeCount <= LABEL_BUDGET) return 'all';
  return k >= fitK * LABEL_ALL_ZOOM ? 'all' : 'lod';
}

export interface LabelBox {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Drawn whatever the budget and collisions (hovered, focused, the neighborhood's center). */
  forced: boolean;
}

function overlaps(a: LabelBox, b: LabelBox): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Which labels to draw, given boxes in priority order (largest node first).
 * "all": every one. "lod": forced boxes first, then up to `budget` boxes that
 * do not overlap one already placed.
 */
export function pickLabels(boxes: LabelBox[], mode: LabelMode, budget = LABEL_BUDGET): number[] {
  if (mode === 'all') return boxes.map((_, i) => i);
  const placed: LabelBox[] = [];
  const picked: number[] = [];
  boxes.forEach((box, i) => {
    if (!box.forced) return;
    placed.push(box);
    picked.push(i);
  });
  let free = 0;
  for (let i = 0; i < boxes.length && free < budget; i += 1) {
    const box = boxes[i];
    if (box.forced) continue;
    if (placed.some((p) => overlaps(p, box))) continue;
    placed.push(box);
    picked.push(i);
    free += 1;
  }
  return picked.sort((a, b) => a - b);
}

// --- colors ------------------------------------------------------------------------

/** `#rgb` / `#rrggbb` / `rgb(r, g, b)` -> [r, g, b]; null when unparseable. */
export function parseColor(value: string): [number, number, number] | null {
  const v = value.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(v);
  if (m) return [0, 1, 2].map((i) => parseInt(m![1][i] + m![1][i], 16)) as [number, number, number];
  m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16)) as [number, number, number];
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(v);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}

/** Mix two colors (t = 0: a, 1: b) as `rgb(...)`; `a` unchanged when either does not parse. */
export function mixColor(a: string, b: string, t: number): string {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return a;
  const c = ca.map((x, i) => Math.round(x + (cb[i] - x) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}
