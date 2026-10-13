// The graph explorer's Canvas 2D surface (artifact-view tasks 6.2, 10.0,
// 10.3): one viewport transform (k, x, y) for pan and zoom, drawn at
// devicePixelRatio, with text at a fixed screen size so labels stay readable
// at any zoom.
//
// Layout: d3-force, computed to rest synchronously when a level opens (so the
// zoom-to-fit target is known at once). Nodes then pop out of the clicked
// node's position one after another (20 ms steps, nearest first) while the
// previous level fades out. Returning to a level restores its saved node
// positions, pins and viewport unchanged. Dragging a node pins it (fx/fy)
// where it is dropped; the simulation is reheated only while dragging.
//
// Visual language (design D15, mappings in model/node-visual.ts): shape by
// kind, language-colored radial gradients, a language ring and a file-count
// badge on directories, in-degree ticks, one curved path per node pair with
// its edge types as colored segments, width / arrow / opacity by log count,
// particles in the edge's direction (capped per level), a focus mode on hover
// (everything outside the hovered node's neighborhood drops to 25%), labels
// on plates with a type glyph and a zoom level of detail with collision
// culling, a hover glow, a pulsing ring on the selected node, a shadow under a
// dragged node, and a faint world-space grid.
//
// Frames: requested only while the canvas is on screen and the page is
// visible; a frame loop runs only while something moves (particles, pulse,
// transitions, a drag), otherwise the canvas is redrawn on change. Under the
// page's reduced-motion switch shapes and colors stay and nothing animates.
// The canvas reports itself on #root: data-graph-labels (`lod|all:drawn/n`),
// data-graph-focus, data-graph-paths, data-graph-particles,
// data-graph-frame-ms (mean draw time of recent frames) and data-graph-raf.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationNodeDatum } from 'd3-force';
import { edgeColorVar } from '../model/edge-types';
import { clearBusy, markBusy, report } from '../instrument';
import { useReducedMotion } from '../motion';
import {
  FOCUS_DIM, arrowSize, compactCount, glyphForKind, inDegreeTicks, labelMode, linkAlpha, linkWidth, mergeLinkPairs, particleCounts, pickLabels,
  shapeForKind, staggerDelay, type LabelBox, type MergedLink, type NodeShape, type RingSegment, type VisualKind,
} from '../model/node-visual';
import { GradientCache, drawGrid, drawRing, drawTicks, fillShape, shapePath, subCurve } from './canvas-draw';
import { lastActivation, levelMemory, saveLevel, setLastActivation, type Transform } from './graph-state';
import { clearOfBand, placeTooltip, type TooltipAnchor, type TooltipPlacement } from './tooltip-place';

export type NodeTone = 'dir' | 'member' | 'file' | 'more' | 'nopath' | 'symbol' | 'center' | 'hop1' | 'hop2';

export interface CanvasNode {
  key: string;
  label: string;
  /** Weight for the radius (aggregated node count; 1 for a symbol). */
  size: number;
  tone: NodeTone;
  tooltip: string[];
  /** Whether a click opens it. */
  activatable: boolean;
  /** Visual kind (shape and glyph); defaults from the tone. */
  kind?: VisualKind;
  /** Custom property of the fill before layer coloring; defaults from the tone. */
  fill?: string;
  /** Directory / member language ring. */
  ring?: RingSegment[];
  /** Directory / member count badge (files under it). */
  badge?: number | null;
}

export interface CanvasLink {
  source: number;
  target: number;
  type: string;
  count: number;
}

interface SimNode extends SimulationNodeDatum {
  index: number;
  r: number;
}

interface Drawn {
  sx: number;
  sy: number;
  rs: number;
  fill: string;
}

type Line = [number, number, number, number, string];

const HEIGHT = 560;
const ENTER_MS = 420;
const FADE_MS = 360;
const FIT_MS = 320;
const HOVER_MS = 140;
const CLICK_SLOP = 4;
const MIN_K = 0.05;
const MAX_K = 8;
const LABEL_FONT = '11px system-ui, -apple-system, "Segoe UI", sans-serif';
const LABEL_FONT_BOLD = `600 ${LABEL_FONT}`;
const LABEL_H = 16;

const SYMBOL_TONES = new Set<NodeTone>(['symbol', 'center', 'hop1', 'hop2']);

function defaultKind(tone: NodeTone): VisualKind {
  if (tone === 'member' || tone === 'dir' || tone === 'file' || tone === 'more' || tone === 'nopath') return tone;
  return 'function';
}

function defaultFill(tone: NodeTone): string {
  if (tone === 'center') return '--accent';
  if (tone === 'more' || tone === 'nopath') return '--surface-2';
  return `--graph-${tone}`;
}

/** Aggregated nodes: area proportional to node count, relative to the heaviest in the level. */
function radius(node: CanvasNode, maxSize: number, symbolLevel: boolean): number {
  if (node.tone === 'center') return 10;
  // Distance shows in size: direct neighbors a little larger than the second hop.
  if (node.tone === 'hop1') return 7;
  if (node.tone === 'hop2') return 5.5;
  if (SYMBOL_TONES.has(node.tone)) return 6;
  // A folded bucket among symbols stays symbol-sized, so it never buries the center's label.
  if (symbolLevel && (node.tone === 'more' || node.tone === 'nopath')) return 9;
  return 6 + 24 * Math.sqrt(Math.max(0, node.size) / Math.max(1, maxSize));
}

function ease(t: number): number {
  return 1 - (1 - t) ** 3;
}

/** Ease-out with a little overshoot (the pop). */
function backOut(t: number): number {
  const c = 1.70158;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
}

function clampK(k: number): number {
  return Math.min(MAX_K, Math.max(MIN_K, k));
}

function fitTransform(nodes: SimNode[], width: number, height: number): Transform {
  if (nodes.length === 0 || width <= 0) return { k: 1, x: width / 2, y: height / 2 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const n of nodes) {
    x0 = Math.min(x0, (n.x ?? 0) - n.r);
    y0 = Math.min(y0, (n.y ?? 0) - n.r);
    x1 = Math.max(x1, (n.x ?? 0) + n.r);
    y1 = Math.max(y1, (n.y ?? 0) + n.r);
  }
  const k = clampK(Math.min(width / (x1 - x0 + 120), height / (y1 - y0 + 80), 2.5));
  return { k, x: width / 2 - ((x0 + x1) / 2) * k, y: height / 2 - ((y0 + y1) / 2) * k };
}

interface HoverTip {
  key: string;
  lines: string[];
  anchor: TooltipAnchor;
}

/**
 * The hovered node's tooltip, anchored to the node's band on screen: its top
 * edge at full hover scale down to the bottom of the label drawn under it.
 */
function hoverTip(node: CanvasNode, d: Drawn | undefined, ringed: boolean): HoverTip {
  const r = (d?.rs ?? 0) * 1.1;
  const x = d?.sx ?? 0;
  const y = d?.sy ?? 0;
  return { key: node.key, lines: node.tooltip, anchor: { x, top: y - r, bottom: y + r + (ringed ? 7 : 4) + LABEL_H } };
}

/**
 * Measured, then placed before paint (above the node, or below its label);
 * `data-tooltip-clear` reports whether the laid-out box stays clear of that band.
 */
function NodeTooltip({ tip, width }: { tip: HoverTip; width: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<TooltipPlacement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) setPlace(placeTooltip(tip.anchor, { w: el.offsetWidth, h: el.offsetHeight }, { w: width, h: HEIGHT }));
  }, [tip, width]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && place) el.dataset.tooltipClear = String(clearOfBand({ top: el.offsetTop, height: el.offsetHeight }, tip.anchor));
  }, [place, tip]);
  return (
    <div
      ref={ref}
      className="graph-tooltip"
      role="tooltip"
      style={place ? { left: place.left, top: place.top } : { left: 0, top: 0, visibility: 'hidden' }}
      data-tooltip-node={tip.key}
      data-tooltip-side={place?.side}
    >
      {tip.lines.map((line, i) => (
        <div key={i} className={i === 0 ? 'mono' : 'muted'}>
          {line}
        </div>
      ))}
    </div>
  );
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Test probe: the screen position (CSS px, viewport coordinates) of a drawn node. */
interface Probe {
  level: string;
  position(key: string): { x: number; y: number } | null;
}

/** Per-level precomputation that does not change from frame to frame. */
interface LevelLook {
  shapes: NodeShape[];
  glyphs: string[];
  fills: string[];
  rings: Array<Array<RingSegment & { resolved: string }>>;
  ticks: number[];
  /** Neighbors (either direction) per node, for the focus mode. */
  neighbors: Array<Set<number>>;
  merged: MergedLink[];
  particles: number[];
  maxCount: number;
  /** Draw order: largest first, so small nodes stay on top. */
  drawOrder: number[];
  /** Label priority: the center, then by radius, folded buckets last. */
  labelOrder: number[];
  labelWidth: Array<number | null>;
}

const REPORTS = ['data-graph-labels', 'data-graph-focus', 'data-graph-paths', 'data-graph-particles', 'data-graph-frame-ms', 'data-graph-raf'];

export function GraphCanvas({
  level, nodes, links, selectedKey, onActivate, ariaLabel, nodeColors = null,
}: {
  level: string;
  nodes: CanvasNode[];
  links: CanvasLink[];
  selectedKey: string | null;
  onActivate: (index: number) => void;
  ariaLabel: string;
  /**
   * Optional fill per node (a CSS custom property name, or null for the
   * node's own fill), indexed like `nodes`: the layer coloring (task 8.2).
   * Kept out of `nodes` so switching it recolors without a new layout; the
   * language ring stays.
   */
  nodeColors?: Array<string | null> | null;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const reduced = useReducedMotion();
  const [tooltip, setTooltip] = useState<HoverTip | null>(null);

  // Everything the frame loop reads lives in one mutable ref.
  const st = useRef({
    level: '',
    nodes: [] as CanvasNode[],
    links: [] as CanvasLink[],
    look: null as LevelLook | null,
    sim: null as Simulation<SimNode, undefined> | null,
    simNodes: [] as SimNode[],
    transform: { k: 1, x: 0, y: 0 } as Transform,
    fitK: 1,
    fitAnim: null as null | { from: Transform; to: Transform; start: number },
    enter: null as null | { start: number; ox: number; oy: number; delays: Float64Array; end: number },
    fading: null as null | { start: number; nodes: Drawn[]; links: Line[] },
    lastDrawn: [] as Drawn[],
    lastLinks: [] as Line[],
    hovered: -1,
    hoverStart: 0,
    dragging: -1,
    selected: null as string | null,
    colors: new Map<string, string>(),
    width: 0,
    reduced: false,
    dirty: true,
    reported: new Map<string, string>(),
    onActivate,
    nodeFills: null as Array<string | null> | null,
    frame: 0,
    visible: true,
    frameTimes: [] as number[],
    frameReportedAt: 0,
    kick: () => {},
    enterTimer: 0,
  });
  st.current.onActivate = onActivate;
  st.current.selected = selectedKey;
  st.current.reduced = reduced;

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const save = () => {
    const s = st.current;
    if (!s.level) return;
    const saved = new Map<string, { x: number; y: number; pinned: boolean }>();
    s.simNodes.forEach((n, i) => saved.set(s.nodes[i].key, { x: n.fx ?? n.x ?? 0, y: n.fy ?? n.y ?? 0, pinned: n.fx !== undefined && n.fx !== null }));
    saveLevel(s.level, { nodes: saved, transform: { ...s.transform } });
  };

  // A new level (or new data for it): lay out, place, start the transition.
  useEffect(() => {
    const s = st.current;
    if (width <= 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const style = getComputedStyle(canvas);
    const cache = new Map<string, string>();
    const resolve = (name: string, fallback: string) => {
      let v = cache.get(name);
      if (v === undefined) {
        v = style.getPropertyValue(name).trim() || fallback;
        cache.set(name, v);
      }
      return v;
    };
    s.colors = new Map([
      ['text', resolve('--text-primary', '#fff')],
      ['secondary', resolve('--text-secondary', '#ccc')],
      ['muted', resolve('--text-muted', '#888')],
      ['accent', resolve('--accent', '#3987e5')],
      ['outline', resolve('--graph-outline', 'rgba(255,255,255,0.35)')],
      ['grid', resolve('--graph-grid-line', 'rgba(255,255,255,0.04)')],
      ['plate', resolve('--graph-label-plate', 'rgba(13,13,13,0.72)')],
      ['badge', resolve('--graph-badge-text', '#fff')],
      ['tick', resolve('--graph-tick', '#898781')],
      ['hop2', resolve('--graph-hop2-ring', '#9fb4d0')],
      ['glow', resolve('--graph-glow', 'rgba(134,182,239,0.9)')],
      ['shadow', resolve('--graph-shadow', 'rgba(0,0,0,0.6)')],
    ]);
    for (const link of links) if (!s.colors.has(link.type)) s.colors.set(link.type, resolve(edgeColorVar(link.type), '#888'));

    const previousLevel = s.level;
    if (previousLevel && previousLevel !== level) save();
    const reduce = s.reduced;
    s.fading = !reduce && previousLevel && previousLevel !== level && s.lastDrawn.length > 0
      ? { start: performance.now(), nodes: s.lastDrawn, links: s.lastLinks }
      : null;
    s.sim?.stop();

    const memory = levelMemory(level);
    const maxSize = nodes.reduce((m, n) => Math.max(m, n.size), 1);
    const symbolLevel = nodes.some((n) => SYMBOL_TONES.has(n.tone));
    const simNodes: SimNode[] = nodes.map((node, index) => {
      const saved = memory?.nodes.get(node.key);
      const n: SimNode = { index, r: radius(node, maxSize, symbolLevel) };
      if (saved) {
        n.x = saved.x;
        n.y = saved.y;
        if (saved.pinned) {
          n.fx = saved.x;
          n.fy = saved.y;
        }
      }
      return n;
    });
    // Decided before d3 initializes positions (forceSimulation places every node).
    const hasSaved = simNodes.map((n) => n.x !== undefined);
    const allSaved = memory !== undefined && hasSaved.every(Boolean);
    // Spring links: one per connected pair, whatever the types.
    const pairs = new Map<string, { source: number; target: number }>();
    for (const link of links) {
      const a = Math.min(link.source, link.target);
      const b = Math.max(link.source, link.target);
      if (a !== b) pairs.set(`${a}-${b}`, { source: a, target: b });
    }
    const sim = forceSimulation<SimNode>(simNodes)
      .force('link', forceLink<SimNode, { source: number; target: number }>([...pairs.values()]).id((d) => d.index).distance((l) => 36 + (l.source as unknown as SimNode).r + (l.target as unknown as SimNode).r).strength(0.35))
      .force('charge', forceManyBody<SimNode>().strength((d) => -50 - d.r * 6))
      .force('collide', forceCollide<SimNode>((d) => d.r + 4))
      .force('x', forceX<SimNode>(0).strength(0.06))
      .force('y', forceY<SimNode>(0).strength(0.06))
      .stop();
    if (!allSaved) {
      // Saved nodes stay where they were while the new ones settle around them.
      const keep = simNodes.filter((n, i) => hasSaved[i] && n.fx === undefined);
      for (const n of keep) {
        n.fx = n.x;
        n.fy = n.y;
      }
      sim.tick(Math.min(300, Math.ceil(Math.log(sim.alphaMin()) / Math.log(1 - sim.alphaDecay()))));
      for (const n of keep) {
        n.fx = undefined;
        n.fy = undefined;
      }
    }
    sim.alpha(0);
    sim.on('tick', () => {
      s.dirty = true;
      s.kick();
    });
    s.sim = sim;
    s.simNodes = simNodes;
    s.nodes = nodes;
    s.links = links;
    s.hovered = -1;
    s.dragging = -1;
    s.level = level;
    s.width = width;

    // Per-level look.
    const merged = mergeLinkPairs(links);
    const inDegree = new Array<number>(nodes.length).fill(0);
    const neighbors = nodes.map(() => new Set<number>());
    for (const m of merged) {
      inDegree[m.target] += m.total;
      neighbors[m.source].add(m.target);
      neighbors[m.target].add(m.source);
    }
    const byRadius = nodes.map((_, i) => i).sort((a, b) => simNodes[b].r - simNodes[a].r || a - b);
    // The neighborhood's center is drawn last, above its neighbors.
    const drawOrder = [...byRadius.filter((i) => nodes[i].tone !== 'center'), ...byRadius.filter((i) => nodes[i].tone === 'center')];
    const folded = (i: number) => nodes[i].tone === 'more' || nodes[i].tone === 'nopath';
    s.look = {
      shapes: nodes.map((n) => shapeForKind(n.kind ?? defaultKind(n.tone))),
      glyphs: nodes.map((n) => glyphForKind(n.kind ?? defaultKind(n.tone))),
      fills: nodes.map((n) => resolve(n.fill ?? defaultFill(n.tone), '#55534d')),
      rings: nodes.map((n) => (n.ring ?? []).map((seg) => ({ ...seg, resolved: resolve(seg.color, '#5f5e5a') }))),
      ticks: inDegree.map(inDegreeTicks),
      neighbors,
      merged,
      particles: particleCounts(merged.map((m) => m.total)),
      maxCount: merged.reduce((m, l) => Math.max(m, l.total), 1),
      drawOrder,
      labelOrder: [...byRadius.filter((i) => nodes[i].tone === 'center'), ...byRadius.filter((i) => nodes[i].tone !== 'center' && !folded(i)), ...byRadius.filter(folded)],
      labelWidth: nodes.map(() => null),
    };

    const fit = fitTransform(simNodes, width, HEIGHT);
    s.fitK = fit.k;
    const target = memory?.transform ?? fit;
    s.transform = { ...target };
    s.fitAnim = null;
    const activation = lastActivation;
    const origin = activation !== null
      ? { ox: (activation.x - target.x) / target.k, oy: (activation.y - target.y) / target.k }
      : { ox: (width / 2 - target.x) / target.k, oy: (HEIGHT / 2 - target.y) / target.k };
    if (!reduce && !allSaved) {
      // Nearest the origin pops first.
      const rank = simNodes.map((n, i) => [Math.hypot((n.x ?? 0) - origin.ox, (n.y ?? 0) - origin.oy), i]).sort((a, b) => a[0] - b[0]);
      const delays = new Float64Array(simNodes.length);
      rank.forEach(([, i], r) => {
        delays[i] = staggerDelay(r, simNodes.length);
      });
      const end = (delays.length > 0 ? Math.max(...delays) : 0) + ENTER_MS;
      s.enter = { start: performance.now(), ...origin, delays, end };
      // The smoke check waits for the entry to finish (by the clock, so an off-screen canvas cannot hold it).
      markBusy('graph-enter');
      clearTimeout(s.enterTimer);
      s.enterTimer = window.setTimeout(() => clearBusy('graph-enter'), end + 50);
    } else {
      s.enter = null;
      clearTimeout(s.enterTimer);
      clearBusy('graph-enter');
    }
    setLastActivation(null);
    s.dirty = true;
    setTooltip(null);
    report('data-graph-canvas-level', level);
    report('data-graph-paths', merged.length);
    report('data-graph-particles', reduce ? 0 : s.look.particles.reduce((n, c) => n + c, 0));
    s.kick();
  }, [level, nodes, links, width]);

  // Layer colors: resolved against the page's tokens, redrawn without a new layout.
  const colorsKey = nodeColors ? nodeColors.join('|') : '';
  useEffect(() => {
    const s = st.current;
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!nodeColors) {
      s.nodeFills = null;
    } else {
      const style = getComputedStyle(canvas);
      s.nodeFills = nodeColors.map((name) => (name ? style.getPropertyValue(name).trim() || null : null));
    }
    s.dirty = true;
    s.kick();
  }, [colorsKey, width]);

  // Save the level and drop the canvas's reports when the explorer goes away.
  useEffect(
    () => () => {
      save();
      clearTimeout(st.current.enterTimer);
      clearBusy('graph-enter');
      for (const name of REPORTS) report(name, null);
    },
    [],
  );

  // Frame loop.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let alive = true;
    const s = st.current;
    const gradients = new GradientCache(ctx);
    const probe: Probe = {
      level,
      position(key) {
        const i = s.nodes.findIndex((n) => n.key === key);
        const d = s.lastDrawn[i];
        if (i < 0 || !d) return null;
        const rect = canvas.getBoundingClientRect();
        return { x: rect.left + d.sx, y: rect.top + d.sy };
      },
    };
    (window as unknown as { __excavatorViewGraph?: Probe }).__excavatorViewGraph = probe;

    const put = (name: string, value: string) => {
      if (s.reported.get(name) === value) return;
      s.reported.set(name, value);
      report(name, value);
    };

    /** Whether the next frame needs drawing even when nothing changed. */
    const moving = () => {
      if (s.fitAnim || s.enter || s.fading || s.dragging >= 0) return true;
      if (s.reduced) return false;
      const look = s.look;
      const hasParticles = look !== null && look.particles.some((n) => n > 0);
      const pulsing = s.selected !== null;
      const hoverTween = s.hovered >= 0 && performance.now() - s.hoverStart < HOVER_MS;
      return hasParticles || pulsing || hoverTween;
    };

    const draw = (now: number) => {
      const started = performance.now();
      const look = s.look;
      const dpr = window.devicePixelRatio || 1;
      const w = width;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(HEIGHT * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(HEIGHT * dpr);
      }
      if (s.fitAnim) {
        const p = Math.min(1, (now - s.fitAnim.start) / FIT_MS);
        const e = ease(p);
        const { from, to } = s.fitAnim;
        s.transform = { k: from.k + (to.k - from.k) * e, x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
        if (p >= 1) s.fitAnim = null;
      }
      const t = s.transform;
      const elapsed = s.enter ? now - s.enter.start : Infinity;
      if (s.enter && elapsed >= s.enter.end) s.enter = null;
      const fadeP = s.fading ? Math.min(1, (now - s.fading.start) / FADE_MS) : 1;
      if (s.fading && fadeP >= 1) s.fading = null;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, HEIGHT);
      const colors = s.colors;
      drawGrid(ctx, w, HEIGHT, t, colors.get('grid') as string);

      // The previous level, fading out.
      if (s.fading) {
        ctx.globalAlpha = 1 - ease(fadeP);
        ctx.lineWidth = 1;
        for (const [x0, y0, x1, y1, c] of s.fading.links) {
          ctx.strokeStyle = c;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.stroke();
        }
        for (const d of s.fading.nodes) {
          ctx.fillStyle = d.fill;
          ctx.beginPath();
          ctx.arc(d.sx, d.sy, d.rs, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      if (!look) return;

      // Node placement, with the staggered pop from the origin while entering.
      const enter = s.enter;
      const pops: number[] = new Array(s.simNodes.length);
      const zoomScale = Math.min(2.5, Math.max(0.35, t.k));
      const hovered = s.hovered;
      const hoverScale = hovered < 0 ? 1 : 1 + 0.1 * (s.reduced ? 1 : ease(Math.min(1, (now - s.hoverStart) / HOVER_MS)));
      const drawn: Drawn[] = s.simNodes.map((n, i) => {
        let x = n.x ?? 0;
        let y = n.y ?? 0;
        let scale = 1;
        if (enter) {
          const p = Math.max(0, Math.min(1, (elapsed - enter.delays[i]) / ENTER_MS));
          const e = ease(p);
          x = enter.ox + (x - enter.ox) * e;
          y = enter.oy + (y - enter.oy) * e;
          scale = Math.max(0, backOut(p));
          pops[i] = p;
        } else pops[i] = 1;
        if (i === hovered) scale *= hoverScale;
        const layer = s.nodeFills?.[i] ?? null;
        return { sx: x * t.k + t.x, sy: y * t.k + t.y, rs: Math.max(2, n.r * zoomScale) * scale, fill: layer ?? look.fills[i] };
      });
      const selectedIndex = s.selected === null ? -1 : s.nodes.findIndex((n) => n.key === s.selected);
      // The focus: the hovered node, or a selection that is not a neighborhood's own center.
      const focus = hovered >= 0 ? hovered : selectedIndex >= 0 && s.nodes[selectedIndex].tone !== 'center' ? selectedIndex : -1;
      const related = (i: number) => focus < 0 || i === focus || look.neighbors[focus].has(i);
      const showAllCounts = look.merged.length <= 40;
      const linkLines: Line[] = [];

      // Links: one path per ordered pair, its types as colored segments.
      look.merged.forEach((m, li) => {
        const a = drawn[m.source];
        const b = drawn[m.target];
        if (!a || !b || m.source === m.target) return;
        const entryAlpha = Math.min(pops[m.source], pops[m.target]);
        if (entryAlpha <= 0) return;
        const dx = b.sx - a.sx;
        const dy = b.sy - a.sy;
        const len = Math.hypot(dx, dy) || 1;
        // Left of the direction of travel: a->b and b->a curve apart.
        const offset = Math.min(len * 0.25, m.reverse ? 18 : 10);
        const c: [number, number] = [(a.sx + b.sx) / 2 - (dy / len) * offset, (a.sy + b.sy) / 2 + (dx / len) * offset];
        const p0: [number, number] = [a.sx, a.sy];
        const p2: [number, number] = [b.sx, b.sy];
        const attached = focus >= 0 && (m.source === focus || m.target === focus);
        const base = linkAlpha(m.total, look.maxCount);
        const alpha = entryAlpha * (focus < 0 ? base : attached ? 1 : base * FOCUS_DIM);
        ctx.globalAlpha = alpha;
        ctx.lineWidth = linkWidth(m.total) + (attached ? 1 : 0);
        ctx.lineCap = 'round';
        let acc = 0;
        const bounds: Array<[number, number, string]> = [];
        for (const seg of m.segments) {
          const t0 = acc / m.total;
          acc += seg.count;
          const t1 = acc / m.total;
          const color = colors.get(seg.type) ?? '#888';
          bounds.push([t0, t1, color]);
          const sc = subCurve(p0, c, p2, t0, t1);
          ctx.strokeStyle = color;
          ctx.beginPath();
          ctx.moveTo(sc.from[0], sc.from[1]);
          ctx.quadraticCurveTo(sc.control[0], sc.control[1], sc.to[0], sc.to[1]);
          ctx.stroke();
        }
        const lastColor = bounds[bounds.length - 1][2];
        linkLines.push([a.sx, a.sy, b.sx, b.sy, bounds[0][2]]);
        const at = (u: number): [number, number] => [(1 - u) * (1 - u) * p0[0] + 2 * (1 - u) * u * c[0] + u * u * p2[0], (1 - u) * (1 - u) * p0[1] + 2 * (1 - u) * u * c[1] + u * u * p2[1]];
        // Arrowhead at the target's rim, sized by count.
        const size = arrowSize(m.total);
        const uEnd = Math.max(0.5, 1 - (b.rs + 3) / len);
        const [hx, hy] = at(uEnd);
        const [px, py] = at(uEnd - 0.02);
        const angle = Math.atan2(hy - py, hx - px);
        ctx.fillStyle = lastColor;
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(hx - size * Math.cos(angle - 0.42), hy - size * Math.sin(angle - 0.42));
        ctx.lineTo(hx - size * Math.cos(angle + 0.42), hy - size * Math.sin(angle + 0.42));
        ctx.closePath();
        ctx.fill();
        // Particles in the edge's direction, colored by the segment they cross (none under reduced motion).
        const count = s.reduced ? 0 : look.particles[li];
        if (count > 0) {
          const speed = 45 / len;
          ctx.globalAlpha = Math.min(1, alpha + 0.15);
          for (let i = 0; i < count; i += 1) {
            const u = ((now / 1000) * speed + i / count + ((li * 0.137) % 1)) % 1;
            const [qx, qy] = at(u);
            const seg = bounds.find(([t0, t1]) => u >= t0 && u < t1) ?? bounds[bounds.length - 1];
            ctx.fillStyle = seg[2];
            ctx.beginPath();
            ctx.arc(qx, qy, attached ? 2.6 : 2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        if ((showAllCounts && m.total > 1) || attached) {
          ctx.globalAlpha = entryAlpha * (focus < 0 || attached ? 1 : FOCUS_DIM);
          ctx.fillStyle = colors.get('muted') as string;
          ctx.font = '11px ui-monospace, Menlo, monospace';
          ctx.textAlign = 'center';
          ctx.fillText(String(m.total), c[0], c[1] - 3);
        }
      });

      // Nodes, largest first so small ones stay on top.
      const pulse = s.reduced ? 0.5 : (Math.sin(now / 320) + 1) / 2;
      for (const i of look.drawOrder) {
        const d = drawn[i];
        if (pops[i] <= 0) continue;
        const node = s.nodes[i];
        const shape = look.shapes[i];
        const hop2 = node.tone === 'hop2';
        const nodeAlpha = (related(i) ? 1 : FOCUS_DIM) * (hop2 ? 0.88 : 1) * Math.min(1, pops[i] * 2);
        ctx.globalAlpha = nodeAlpha;
        // Glow on hover, a drop shadow under a dragged node.
        if (i === s.dragging) {
          ctx.shadowColor = colors.get('shadow') as string;
          ctx.shadowBlur = 18;
          ctx.shadowOffsetY = 6;
        } else if (i === hovered) {
          ctx.shadowColor = colors.get('glow') as string;
          ctx.shadowBlur = 16;
        }
        if (shape === 'dashed-circle') {
          shapePath(ctx, shape, d.sx, d.sy, d.rs);
          ctx.fillStyle = d.fill;
          ctx.fill();
        } else fillShape(ctx, gradients, shape, d.sx, d.sy, d.rs, d.fill, dpr);
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
        // Outline.
        shapePath(ctx, shape, d.sx, d.sy, d.rs);
        const emphasized = i === selectedIndex || i === hovered;
        ctx.lineWidth = i === selectedIndex ? 3 : emphasized ? 2.2 : hop2 ? 1.4 : 1;
        ctx.strokeStyle = emphasized ? (colors.get('accent') as string) : hop2 ? (colors.get('hop2') as string) : (colors.get('outline') as string);
        if (shape === 'dashed-circle') ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
        // Language ring (directories, members) and in-degree ticks.
        const ringR = d.rs + 3;
        if (look.rings[i].length > 0) drawRing(ctx, d.sx, d.sy, ringR, look.rings[i], Math.max(2, Math.min(4, d.rs * 0.22)));
        drawTicks(ctx, d.sx, d.sy, (look.rings[i].length > 0 ? ringR + 2.5 : d.rs + 2) + (shape === 'diamond' ? d.rs * 0.2 : 0), look.ticks[i], colors.get('tick') as string);
        // Count badge.
        if (node.badge !== undefined && node.badge !== null && d.rs >= 10) {
          ctx.fillStyle = colors.get('badge') as string;
          ctx.font = `600 ${Math.min(13, Math.max(9, d.rs * 0.55))}px system-ui, -apple-system, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(compactCount(node.badge), d.sx, d.sy + 0.5);
          ctx.textBaseline = 'alphabetic';
        }
        const pinned = s.simNodes[i].fx !== undefined && s.simNodes[i].fx !== null;
        if (pinned) {
          ctx.fillStyle = colors.get('text') as string;
          ctx.beginPath();
          ctx.arc(d.sx + d.rs * 0.75, d.sy - d.rs * 0.75, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
        // The selected node's pulsing ring (static under reduced motion).
        if (i === selectedIndex) {
          ctx.globalAlpha = nodeAlpha * (0.85 - 0.6 * pulse);
          ctx.strokeStyle = colors.get('accent') as string;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(d.sx, d.sy, d.rs + 6 + 6 * pulse, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // Labels on plates, above everything: level of detail by zoom, collision culled.
      const mode = labelMode(t.k, s.fitK, s.nodes.length);
      const boxes: LabelBox[] = [];
      const texts: string[] = [];
      for (const i of look.labelOrder) {
        const d = drawn[i];
        const node = s.nodes[i];
        const strong = i === focus || node.tone === 'center';
        // The hovered node's label is drawn in full (its tooltip sits clear of it).
        const text = i === hovered ? node.label : truncate(node.label, strong ? 80 : 28);
        ctx.font = strong ? LABEL_FONT_BOLD : LABEL_FONT;
        let tw = strong ? null : look.labelWidth[i];
        if (tw === null) {
          tw = ctx.measureText(text).width;
          if (!strong) look.labelWidth[i] = tw;
        }
        const wBox = tw + 20;
        const top = d.sy + d.rs + (look.rings[i].length > 0 ? 7 : 4);
        boxes.push({ x: d.sx - wBox / 2, y: top, w: wBox, h: LABEL_H, forced: i === hovered || i === focus || node.tone === 'center' });
        texts.push(text);
      }
      const picked = pickLabels(boxes, mode);
      ctx.textBaseline = 'middle';
      for (const p of picked) {
        const i = look.labelOrder[p];
        if (pops[i] < 0.6) continue;
        const box = boxes[p];
        const node = s.nodes[i];
        const strong = i === focus || node.tone === 'center';
        ctx.globalAlpha = related(i) ? 1 : FOCUS_DIM;
        ctx.fillStyle = colors.get('plate') as string;
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') ctx.roundRect(box.x, box.y, box.w, box.h, 4);
        else ctx.rect(box.x, box.y, box.w, box.h);
        ctx.fill();
        ctx.font = LABEL_FONT_BOLD;
        ctx.textAlign = 'center';
        ctx.fillStyle = look.rings[i].length > 0 ? look.rings[i][0].resolved : drawn[i].fill;
        ctx.fillText(look.glyphs[i], box.x + 8, box.y + box.h / 2 + 0.5);
        ctx.font = strong ? LABEL_FONT_BOLD : LABEL_FONT;
        ctx.textAlign = 'left';
        ctx.fillStyle = node.tone === 'hop2' ? (colors.get('secondary') as string) : (colors.get('text') as string);
        ctx.fillText(texts[p], box.x + 15, box.y + box.h / 2 + 0.5);
      }
      ctx.textBaseline = 'alphabetic';
      ctx.globalAlpha = 1;
      s.lastDrawn = drawn;
      s.lastLinks = linkLines;

      put('data-graph-transform', `${t.k.toFixed(3)},${t.x.toFixed(1)},${t.y.toFixed(1)}`);
      put('data-graph-labels', `${mode}:${picked.length}/${s.nodes.length}`);
      put('data-graph-focus', focus >= 0 ? s.nodes[focus].key : 'none');
      // Mean draw time of the recent frames, reported at most four times a second.
      s.frameTimes.push(performance.now() - started);
      if (s.frameTimes.length > 60) s.frameTimes.shift();
      if (started - s.frameReportedAt > 250) {
        s.frameReportedAt = started;
        put('data-graph-frame-ms', (s.frameTimes.reduce((n, v) => n + v, 0) / s.frameTimes.length).toFixed(2));
      }
    };

    const paused = () => !s.visible || document.hidden;
    const loop = (now: number) => {
      s.frame = 0;
      if (!alive) return;
      if (paused()) {
        put('data-graph-raf', 'paused');
        return;
      }
      if (s.dirty || moving()) {
        s.dirty = false;
        draw(now);
      }
      if (moving()) {
        s.frame = requestAnimationFrame(loop);
        put('data-graph-raf', 'running');
      } else put('data-graph-raf', 'idle');
    };
    s.kick = () => {
      if (!alive || s.frame !== 0) return;
      if (paused()) {
        put('data-graph-raf', 'paused');
        return;
      }
      s.frame = requestAnimationFrame(loop);
    };
    const onVisibility = () => s.kick();
    document.addEventListener('visibilitychange', onVisibility);
    let observer: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver((entries) => {
        s.visible = entries.some((e) => e.isIntersecting);
        s.dirty = true;
        s.kick();
      });
      observer.observe(canvas);
    }
    // Draw once synchronously so the first report is there without waiting for a frame.
    draw(performance.now());
    s.kick();
    return () => {
      alive = false;
      cancelAnimationFrame(s.frame);
      s.frame = 0;
      s.kick = () => {};
      observer?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      const w = window as unknown as { __excavatorViewGraph?: Probe };
      if (w.__excavatorViewGraph === probe) delete w.__excavatorViewGraph;
    };
  }, [width, level]);

  // Pointer interaction: pan, pinch, node drag, click, hover, wheel, double-click.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const s = st.current;
    const pointers = new Map<number, { x: number; y: number }>();
    let gesture: null | { kind: 'pan' | 'node'; id: number; startX: number; startY: number; moved: boolean; node: number; lastX: number; lastY: number } = null;
    let pinch: null | { dist: number; k: number; mid: { x: number; y: number }; t: Transform } = null;

    const local = (event: { clientX: number; clientY: number }) => {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    const hit = (p: { x: number; y: number }) => {
      const order = s.look?.drawOrder ?? [];
      // Topmost first: the reverse of the draw order.
      for (let j = order.length - 1; j >= 0; j -= 1) {
        const i = order[j];
        const d = s.lastDrawn[i];
        if (d && Math.hypot(d.sx - p.x, d.sy - p.y) <= d.rs + 3) return i;
      }
      return -1;
    };
    const changed = () => {
      s.dirty = true;
      s.kick();
    };
    const userMoved = () => {
      s.fitAnim = null;
      changed();
    };
    const zoomAt = (p: { x: number; y: number }, k: number, base: Transform = s.transform) => {
      const nk = clampK(k);
      const wx = (p.x - base.x) / base.k;
      const wy = (p.y - base.y) / base.k;
      s.transform = { k: nk, x: p.x - wx * nk, y: p.y - wy * nk };
      userMoved();
    };
    const setHovered = (i: number) => {
      if (i === s.hovered) return;
      s.hovered = i;
      s.hoverStart = performance.now();
      changed();
    };

    const onDown = (event: PointerEvent) => {
      const p = local(event);
      pointers.set(event.pointerId, p);
      canvas.setPointerCapture?.(event.pointerId);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, k: s.transform.k, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, t: { ...s.transform } };
        gesture = null;
        return;
      }
      const node = hit(p);
      gesture = { kind: node >= 0 ? 'node' : 'pan', id: event.pointerId, startX: p.x, startY: p.y, moved: false, node, lastX: p.x, lastY: p.y };
    };
    const onMove = (event: PointerEvent) => {
      const p = local(event);
      if (pointers.has(event.pointerId)) pointers.set(event.pointerId, p);
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        zoomAt(pinch.mid, pinch.k * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.dist), pinch.t);
        return;
      }
      if (gesture && gesture.id === event.pointerId) {
        if (!gesture.moved && Math.hypot(p.x - gesture.startX, p.y - gesture.startY) > CLICK_SLOP) {
          gesture.moved = true;
          if (gesture.kind === 'node') {
            s.dragging = gesture.node;
            if (!s.reduced) s.sim?.alphaTarget(0.3).restart();
          }
        }
        if (gesture.moved) {
          if (gesture.kind === 'pan') {
            s.transform = { ...s.transform, x: s.transform.x + (p.x - gesture.lastX), y: s.transform.y + (p.y - gesture.lastY) };
            userMoved();
          } else {
            const n = s.simNodes[gesture.node];
            const t = s.transform;
            n.fx = (p.x - t.x) / t.k;
            n.fy = (p.y - t.y) / t.k;
            n.x = n.fx;
            n.y = n.fy;
            s.enter = null;
            changed();
          }
        }
        gesture.lastX = p.x;
        gesture.lastY = p.y;
        return;
      }
      if (pointers.size === 0) {
        const i = hit(p);
        if (i !== s.hovered) canvas.style.cursor = i >= 0 ? (s.nodes[i].activatable ? 'pointer' : 'grab') : 'default';
        setHovered(i);
        setTooltip(i >= 0 ? hoverTip(s.nodes[i], s.lastDrawn[i], (s.look?.rings[i].length ?? 0) > 0) : null);
      }
    };
    const onUp = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinch = null;
      if (!gesture || gesture.id !== event.pointerId) {
        if (pointers.size === 0) save();
        return;
      }
      const g = gesture;
      gesture = null;
      if (s.dragging >= 0) {
        s.dragging = -1;
        changed();
      }
      if (g.kind === 'node' && g.moved) {
        s.sim?.alphaTarget(0);
        save();
        return;
      }
      if (g.moved) {
        save();
        return;
      }
      if (g.kind === 'node' && s.nodes[g.node]?.activatable && event.detail < 2) {
        setLastActivation({ level: s.level, x: s.lastDrawn[g.node].sx, y: s.lastDrawn[g.node].sy });
        save();
        s.onActivate(g.node);
      }
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const p = local(event);
      // Pinch on a trackpad arrives as a wheel event with ctrlKey.
      const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015));
      zoomAt(p, s.transform.k * factor);
      save();
    };
    const onDouble = (event: MouseEvent) => {
      if (hit(local(event)) >= 0) return;
      const to = fitTransform(s.simNodes, s.width, HEIGHT);
      if (s.reduced) {
        s.transform = to;
        s.fitAnim = null;
      } else s.fitAnim = { from: { ...s.transform }, to, start: performance.now() };
      changed();
      setTimeout(save, s.reduced ? 0 : FIT_MS + 20);
    };
    const onLeave = () => {
      setHovered(-1);
      setTooltip(null);
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('dblclick', onDouble);
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('dblclick', onDouble);
    };
  }, []);

  useEffect(() => {
    st.current.dirty = true;
    st.current.kick();
  }, [selectedKey, reduced]);

  return (
    <div
      ref={wrapRef}
      className="graph-canvas"
      style={{ height: HEIGHT }}
      data-motion="graph"
      data-motion-state={reduced ? 'static' : 'animated'}
      data-canvas-nodes={nodes.length}
      data-canvas-links={links.length}
      data-canvas-colored={nodeColors ? nodeColors.filter(Boolean).length : 0}
    >
      <canvas ref={canvasRef} style={{ width: '100%', height: HEIGHT, touchAction: 'none' }} role="img" aria-label={ariaLabel} />
      <span hidden data-motion="graph-particles" data-motion-state={reduced ? 'static' : 'animated'} />
      {tooltip && (
        <NodeTooltip tip={tooltip} width={width} />
      )}
      <div className="graph-hint muted">Drag to pan · wheel or pinch to zoom · double-click to fit · drag a node to pin it · click to open</div>
    </div>
  );
}
