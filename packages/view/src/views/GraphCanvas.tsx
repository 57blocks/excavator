// The graph explorer's Canvas 2D surface (artifact-view task 6.2): one
// viewport transform (k, x, y) for pan and zoom, drawn at devicePixelRatio,
// with text at a fixed screen size so labels stay readable at any zoom.
//
// Layout: d3-force, computed to rest synchronously when a level opens (so the
// zoom-to-fit target is known at once), then animated from the clicked node's
// position outward while the previous level fades out. Returning to a level
// restores its saved node positions, pins and viewport unchanged. Dragging a
// node pins it (fx/fy) where it is dropped; the simulation is reheated only
// while dragging. Particles flow along every drawn edge in its direction.
//
// Interaction: drag the background to pan; wheel or pinch to zoom around the
// pointer; double-click the background to zoom to fit; drag a node to move
// it; click a node to open it. Under the page's reduced-motion switch nothing
// animates: levels switch at once, there are no particles, zoom-to-fit jumps,
// and the canvas is redrawn only when something changes.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationNodeDatum } from 'd3-force';
import { edgeColorVar } from '../model/edge-types';
import { report } from '../instrument';
import { useReducedMotion } from '../motion';
import { lastActivation, levelMemory, saveLevel, setLastActivation, type Transform } from './graph-state';

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

const HEIGHT = 560;
const ENTER_MS = 450;
const FIT_MS = 320;
const CLICK_SLOP = 4;
const MIN_K = 0.05;
const MAX_K = 8;

/** Aggregated nodes: area proportional to node count, relative to the heaviest in the level. */
function radius(node: CanvasNode, maxSize: number): number {
  if (node.tone === 'center') return 10;
  if (node.tone === 'symbol' || node.tone === 'hop1' || node.tone === 'hop2') return 6;
  return 6 + 24 * Math.sqrt(Math.max(0, node.size) / Math.max(1, maxSize));
}

function ease(t: number): number {
  return 1 - (1 - t) ** 3;
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

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Test probe: the screen position (CSS px, viewport coordinates) of a drawn node. */
interface Probe {
  level: string;
  position(key: string): { x: number; y: number } | null;
}

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
   * tone's color), indexed like `nodes`: the layer coloring (task 8.2). Kept
   * out of `nodes` so switching it recolors without a new layout.
   */
  nodeColors?: Array<string | null> | null;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const reduced = useReducedMotion();
  const [tooltip, setTooltip] = useState<{ x: number; y: number; lines: string[] } | null>(null);

  // Everything the frame loop reads lives in one mutable ref.
  const st = useRef({
    level: '',
    nodes: [] as CanvasNode[],
    links: [] as CanvasLink[],
    sim: null as Simulation<SimNode, undefined> | null,
    simNodes: [] as SimNode[],
    transform: { k: 1, x: 0, y: 0 } as Transform,
    fitAnim: null as null | { from: Transform; to: Transform; start: number },
    enter: null as null | { start: number; ox: number; oy: number },
    fading: null as null | { start: number; nodes: Drawn[]; links: Array<[number, number, number, number, string]> },
    lastDrawn: [] as Drawn[],
    lastLinks: [] as Array<[number, number, number, number, string]>,
    hovered: -1,
    selected: null as string | null,
    colors: new Map<string, string>(),
    width: 0,
    reduced: false,
    dirty: true,
    reported: '',
    onActivate,
    linkSlots: [] as number[],
    nodeFills: null as Array<string | null> | null,
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
    const color = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
    s.colors = new Map([
      ['text', color('--text-primary', '#fff')],
      ['muted', color('--text-muted', '#888')],
      ['surface', color('--surface-2', '#333')],
      ['accent', color('--accent', '#3987e5')],
      ['dir', color('--graph-dir', '#3a4a5e')],
      ['member', color('--graph-member', '#2e5d8f')],
      ['file', color('--graph-file', '#4a4a46')],
      ['symbol', color('--graph-symbol', '#55534d')],
      ['hop1', color('--graph-hop1', '#5f6f86')],
      ['hop2', color('--graph-hop2', '#46505e')],
      ['border', color('--baseline', '#555')],
    ]);
    for (const link of links) if (!s.colors.has(link.type)) s.colors.set(link.type, color(edgeColorVar(link.type), '#888'));

    const previousLevel = s.level;
    if (previousLevel && previousLevel !== level) save();
    const reduce = s.reduced;
    s.fading = !reduce && previousLevel && previousLevel !== level && s.lastDrawn.length > 0
      ? { start: performance.now(), nodes: s.lastDrawn, links: s.lastLinks }
      : null;
    s.sim?.stop();

    const memory = levelMemory(level);
    const maxSize = nodes.reduce((m, n) => Math.max(m, n.size), 1);
    const simNodes: SimNode[] = nodes.map((node, index) => {
      const saved = memory?.nodes.get(node.key);
      const n: SimNode = { index, r: radius(node, maxSize) };
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
    });
    s.sim = sim;
    s.simNodes = simNodes;
    s.nodes = nodes;
    s.links = links;
    s.hovered = -1;
    s.level = level;
    s.width = width;
    // Edge slots: links between the same ordered pair fan out side by side.
    const slotCounter = new Map<string, number>();
    s.linkSlots = links.map((link) => {
      const key = `${link.source}>${link.target}`;
      const slot = slotCounter.get(key) ?? 0;
      slotCounter.set(key, slot + 1);
      return slot;
    });

    const target = memory?.transform ?? fitTransform(simNodes, width, HEIGHT);
    s.transform = { ...target };
    s.fitAnim = null;
    const activation = lastActivation;
    s.enter = !reduce && !allSaved && activation !== null
      ? { start: performance.now(), ox: (activation.x - target.x) / target.k, oy: (activation.y - target.y) / target.k }
      : !reduce && !allSaved
        ? { start: performance.now(), ox: (width / 2 - target.x) / target.k, oy: (HEIGHT / 2 - target.y) / target.k }
        : null;
    setLastActivation(null);
    s.dirty = true;
    setTooltip(null);
    report('data-graph-canvas-level', level);
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
  }, [colorsKey, width]);

  // Save the level when the explorer goes away (a route outside the graph).
  useEffect(() => () => save(), []);

  // Frame loop.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let frame = 0;
    let alive = true;
    const s = st.current;
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

    const draw = (now: number) => {
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
      const enterP = s.enter ? Math.min(1, (now - s.enter.start) / ENTER_MS) : 1;
      if (s.enter && enterP >= 1) s.enter = null;
      const fadeP = s.fading ? Math.min(1, (now - s.fading.start) / ENTER_MS) : 1;
      if (s.fading && fadeP >= 1) s.fading = null;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, HEIGHT);
      const colors = s.colors;

      // The previous level, fading out.
      if (s.fading) {
        ctx.globalAlpha = 1 - ease(fadeP);
        for (const [x0, y0, x1, y1, c] of s.fading.links) {
          ctx.strokeStyle = c;
          ctx.lineWidth = 1;
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

      const e = ease(enterP);
      const drawn: Drawn[] = s.simNodes.map((n, i) => {
        const x = s.enter ? s.enter.ox + ((n.x ?? 0) - s.enter.ox) * e : (n.x ?? 0);
        const y = s.enter ? s.enter.oy + ((n.y ?? 0) - s.enter.oy) * e : (n.y ?? 0);
        const tone = s.nodes[i].tone;
        const layerFill = s.nodeFills?.[i] ?? null;
        const fill = layerFill ?? (tone === 'center' ? (colors.get('accent') as string) : (colors.get(tone === 'more' || tone === 'nopath' ? 'surface' : tone) ?? (colors.get('symbol') as string)));
        return { sx: x * t.k + t.x, sy: y * t.k + t.y, rs: Math.max(2, n.r * Math.min(2.5, Math.max(0.35, t.k))), fill };
      });
      const hovered = s.hovered;
      const selectedIndex = s.selected === null ? -1 : s.nodes.findIndex((n) => n.key === s.selected);
      const focus = hovered >= 0 ? hovered : selectedIndex;
      const showAllCounts = s.links.length <= 40;
      const linkLines: Array<[number, number, number, number, string]> = [];

      ctx.globalAlpha = s.enter ? e : 1;
      s.links.forEach((link, li) => {
        const a = drawn[link.source];
        const b = drawn[link.target];
        if (!a || !b) return;
        const dx = b.sx - a.sx;
        const dy = b.sy - a.sy;
        const len = Math.hypot(dx, dy) || 1;
        // Left of the direction of travel, one slot per type: a->b and b->a never overlap.
        const offset = 6 + s.linkSlots[li] * 7;
        const cx = (a.sx + b.sx) / 2 - (dy / len) * offset;
        const cy = (a.sy + b.sy) / 2 + (dx / len) * offset;
        const attached = focus >= 0 && (link.source === focus || link.target === focus);
        const c = colors.get(link.type) ?? '#888';
        ctx.strokeStyle = c;
        ctx.globalAlpha = (s.enter ? e : 1) * (focus >= 0 && !attached ? 0.18 : 0.75);
        ctx.lineWidth = Math.min(5, 1 + Math.log2(link.count) * 0.6);
        ctx.beginPath();
        ctx.moveTo(a.sx, a.sy);
        ctx.quadraticCurveTo(cx, cy, b.sx, b.sy);
        ctx.stroke();
        linkLines.push([a.sx, a.sy, b.sx, b.sy, c]);
        const at = (u: number) => [(1 - u) * (1 - u) * a.sx + 2 * (1 - u) * u * cx + u * u * b.sx, (1 - u) * (1 - u) * a.sy + 2 * (1 - u) * u * cy + u * u * b.sy];
        // Arrowhead at the target's rim.
        const uEnd = Math.max(0.5, 1 - (b.rs + 3) / len);
        const [hx, hy] = at(uEnd);
        const [px, py] = at(uEnd - 0.02);
        const angle = Math.atan2(hy - py, hx - px);
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(hx - 7 * Math.cos(angle - 0.4), hy - 7 * Math.sin(angle - 0.4));
        ctx.lineTo(hx - 7 * Math.cos(angle + 0.4), hy - 7 * Math.sin(angle + 0.4));
        ctx.closePath();
        ctx.fill();
        // Particles in the edge's direction (none under reduced motion).
        if (!s.reduced) {
          const n = Math.min(3, 1 + Math.floor(Math.log10(link.count)));
          const speed = 45 / len;
          for (let i = 0; i < n; i += 1) {
            const u = ((now / 1000) * speed + i / n + (li * 0.137) % 1) % 1;
            const [qx, qy] = at(u);
            ctx.beginPath();
            ctx.arc(qx, qy, 2, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        if ((showAllCounts && link.count > 1) || attached) {
          ctx.globalAlpha = s.enter ? e : 1;
          ctx.fillStyle = colors.get('muted') as string;
          ctx.font = '11px ui-monospace, Menlo, monospace';
          ctx.textAlign = 'center';
          ctx.fillText(String(link.count), cx, cy - 3);
        }
      });

      const labelAll = s.nodes.length <= 150;
      drawn.forEach((d, i) => {
        const node = s.nodes[i];
        ctx.globalAlpha = (s.enter ? e : 1) * (focus >= 0 && i !== focus && !s.links.some((l) => (l.source === focus && l.target === i) || (l.target === focus && l.source === i)) ? 0.45 : 1);
        ctx.fillStyle = d.fill;
        ctx.beginPath();
        ctx.arc(d.sx, d.sy, d.rs, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = i === selectedIndex || i === hovered ? 2.5 : 1;
        ctx.strokeStyle = i === selectedIndex || i === hovered ? (colors.get('accent') as string) : (colors.get('border') as string);
        if (node.tone === 'more' || node.tone === 'nopath') ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
        const pinned = s.simNodes[i].fx !== undefined && s.simNodes[i].fx !== null;
        if (pinned) {
          ctx.fillStyle = colors.get('text') as string;
          ctx.beginPath();
          ctx.arc(d.sx + d.rs * 0.7, d.sy - d.rs * 0.7, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
        if (labelAll || d.rs >= 10 || i === focus || node.tone === 'center') {
          ctx.fillStyle = colors.get('text') as string;
          ctx.font = `${i === focus || node.tone === 'center' ? '600 ' : ''}12px system-ui, -apple-system, sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillText(truncate(node.label, i === focus ? 80 : 28), d.sx, d.sy + d.rs + 13);
        }
      });
      ctx.globalAlpha = 1;
      s.lastDrawn = drawn;
      s.lastLinks = linkLines;

      const reportText = `${t.k.toFixed(3)},${t.x.toFixed(1)},${t.y.toFixed(1)}`;
      if (reportText !== s.reported) {
        s.reported = reportText;
        report('data-graph-transform', reportText);
      }
    };

    const loop = (now: number) => {
      if (!alive) return;
      const s2 = st.current;
      const animating = !s2.reduced || s2.dirty || s2.fitAnim !== null || s2.enter !== null || s2.fading !== null;
      if (animating) {
        s2.dirty = false;
        draw(now);
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    // Draw once synchronously so the first report is there without waiting for a frame.
    draw(performance.now());
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
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
      for (let i = s.lastDrawn.length - 1; i >= 0; i -= 1) {
        const d = s.lastDrawn[i];
        if (Math.hypot(d.sx - p.x, d.sy - p.y) <= d.rs + 3) return i;
      }
      return -1;
    };
    const userMoved = () => {
      s.fitAnim = null;
      s.dirty = true;
    };
    const zoomAt = (p: { x: number; y: number }, k: number, base: Transform = s.transform) => {
      const nk = clampK(k);
      const wx = (p.x - base.x) / base.k;
      const wy = (p.y - base.y) / base.k;
      s.transform = { k: nk, x: p.x - wx * nk, y: p.y - wy * nk };
      userMoved();
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
          if (gesture.kind === 'node' && !s.reduced) s.sim?.alphaTarget(0.3).restart();
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
            s.dirty = true;
          }
        }
        gesture.lastX = p.x;
        gesture.lastY = p.y;
        return;
      }
      if (pointers.size === 0) {
        const i = hit(p);
        if (i !== s.hovered) {
          s.hovered = i;
          s.dirty = true;
          canvas.style.cursor = i >= 0 ? (s.nodes[i].activatable ? 'pointer' : 'grab') : 'default';
        }
        setTooltip(i >= 0 ? { x: p.x, y: p.y, lines: s.nodes[i].tooltip } : null);
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
      s.dirty = true;
      setTimeout(save, s.reduced ? 0 : FIT_MS + 20);
    };
    const onLeave = () => {
      if (s.hovered !== -1) {
        s.hovered = -1;
        s.dirty = true;
      }
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
      {tooltip && (
        <div className="graph-tooltip" style={{ left: Math.min(tooltip.x + 14, Math.max(0, width - 260)), top: tooltip.y + 14 }} role="tooltip">
          {tooltip.lines.map((line, i) => (
            <div key={i} className={i === 0 ? 'mono' : 'muted'}>
              {line}
            </div>
          ))}
        </div>
      )}
      <div className="graph-hint muted">Drag to pan · wheel or pinch to zoom · double-click to fit · drag a node to pin it · click to open</div>
    </div>
  );
}
