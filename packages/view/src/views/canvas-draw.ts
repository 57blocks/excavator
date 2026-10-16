// Canvas 2D drawing primitives for the graph explorer's node visual language
// (task 10.0): shape paths, cached radial gradients, the language ring, the
// in-degree ticks, a quadratic sub-curve, and the background grid. Kept free
// of React and of the explorer's state.
import type { NodeShape, RingSegment } from '../model/node-visual';
import { mixColor } from '../model/node-visual';

/** Trace a node shape of radius r centered at (cx, cy) as the current path. */
export function shapePath(ctx: CanvasRenderingContext2D, shape: NodeShape, cx: number, cy: number, r: number): void {
  ctx.beginPath();
  if (shape === 'rounded-square') {
    const h = r * 0.88;
    const c = r * 0.32;
    ctx.moveTo(cx - h + c, cy - h);
    ctx.lineTo(cx + h - c, cy - h);
    ctx.arcTo(cx + h, cy - h, cx + h, cy - h + c, c);
    ctx.lineTo(cx + h, cy + h - c);
    ctx.arcTo(cx + h, cy + h, cx + h - c, cy + h, c);
    ctx.lineTo(cx - h + c, cy + h);
    ctx.arcTo(cx - h, cy + h, cx - h, cy + h - c, c);
    ctx.lineTo(cx - h, cy - h + c);
    ctx.arcTo(cx - h, cy - h, cx - h + c, cy - h, c);
    ctx.closePath();
  } else if (shape === 'hexagon') {
    const R = r * 1.08;
    for (let i = 0; i < 6; i += 1) {
      const a = (Math.PI / 3) * i;
      const x = cx + R * Math.cos(a);
      const y = cy + R * Math.sin(a);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  } else if (shape === 'diamond') {
    const R = r * 1.2;
    ctx.moveTo(cx, cy - R);
    ctx.lineTo(cx + R, cy);
    ctx.lineTo(cx, cy + R);
    ctx.lineTo(cx - R, cy);
    ctx.closePath();
  } else {
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
  }
}

/**
 * Radial gradients in unit space (center 0,0, radius 1), one per base color,
 * reused by drawing under a translate+scale transform: a light spot up-left
 * fading to the color and a slightly darker rim.
 */
export class GradientCache {
  private cache = new Map<string, CanvasGradient>();

  constructor(private readonly ctx: CanvasRenderingContext2D) {}

  get(color: string): CanvasGradient {
    let g = this.cache.get(color);
    if (!g) {
      g = this.ctx.createRadialGradient(-0.35, -0.4, 0.05, 0, 0, 1.25);
      g.addColorStop(0, mixColor(color, '#ffffff', 0.42));
      g.addColorStop(0.55, color);
      g.addColorStop(1, mixColor(color, '#000000', 0.28));
      this.cache.set(color, g);
    }
    return g;
  }
}

/** Fill a shape with its color's cached gradient (dpr: device pixel ratio of the base transform). */
export function fillShape(ctx: CanvasRenderingContext2D, gradients: GradientCache, shape: NodeShape, cx: number, cy: number, r: number, color: string, dpr: number): void {
  ctx.setTransform(dpr * r, 0, 0, dpr * r, dpr * cx, dpr * cy);
  shapePath(ctx, shape, 0, 0, 1);
  ctx.fillStyle = gradients.get(color);
  ctx.fill();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/** A ring of arcs just outside a disc, one per language by share. */
export function drawRing(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, segments: Array<RingSegment & { resolved: string }>, width: number): void {
  if (segments.length === 0) return;
  const gap = segments.length > 1 ? 0.06 : 0;
  let a = -Math.PI / 2;
  ctx.lineWidth = width;
  ctx.lineCap = 'butt';
  for (const seg of segments) {
    const span = seg.share * Math.PI * 2;
    ctx.strokeStyle = seg.resolved;
    ctx.beginPath();
    ctx.arc(cx, cy, r, a + gap / 2, a + Math.max(gap / 2 + 0.02, span - gap / 2));
    ctx.stroke();
    a += span;
  }
}

/** Short radial ticks around a node's rim (count = log in-degree). */
export function drawTicks(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, count: number, color: string): void {
  if (count <= 0) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < count; i += 1) {
    const a = -Math.PI / 2 + (Math.PI * 2 * i) / Math.max(count, 6);
    ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    ctx.lineTo(cx + Math.cos(a) * (r + 4.5), cy + Math.sin(a) * (r + 4.5));
  }
  ctx.stroke();
}

/** The control point of the sub-curve [t0, t1] of a quadratic curve P0, C, P2 (blossoming). */
export function subCurve(p0: [number, number], c: [number, number], p2: [number, number], t0: number, t1: number): { from: [number, number]; control: [number, number]; to: [number, number] } {
  const at = (t: number): [number, number] => [(1 - t) * (1 - t) * p0[0] + 2 * (1 - t) * t * c[0] + t * t * p2[0], (1 - t) * (1 - t) * p0[1] + 2 * (1 - t) * t * c[1] + t * t * p2[1]];
  const w0 = (1 - t0) * (1 - t1);
  const w1 = (1 - t0) * t1 + t0 * (1 - t1);
  const w2 = t0 * t1;
  return { from: at(t0), control: [w0 * p0[0] + w1 * c[0] + w2 * p2[0], w0 * p0[1] + w1 * c[1] + w2 * p2[1]], to: at(t1) };
}

/** A very faint grid in world space (it pans and zooms with the view), spacing kept between 24 and 96 px. */
export function drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number, t: { k: number; x: number; y: number }, color: string): void {
  let g = 40 * t.k;
  while (g < 24) g *= 2;
  while (g > 96) g /= 2;
  const ox = ((t.x % g) + g) % g;
  const oy = ((t.y % g) + g) % g;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = ox; x < width; x += g) {
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, height);
  }
  for (let y = oy; y < height; y += g) {
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(width, Math.round(y) + 0.5);
  }
  ctx.stroke();
}
