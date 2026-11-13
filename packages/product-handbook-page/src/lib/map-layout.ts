/**
 * The layout of the domain map: a pure function of the domains in their order and the hand-overs between them. The same
 * input always gives the same output (there is no random number and no clock), so the map is a survey plan, not a tangle.
 */

export interface MapDomain { id: string; name: string; features: number }
export interface MapHandover { from: string; to: string }

/** One domain box: its centre, its size, the label drawn in it and the colour index (null: the neutral pair of the centre). */
export interface NodePlace {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** The name as drawn: the name itself, or its start and an ellipsis when the box is too narrow for it. */
  label: string;
  truncated: boolean;
  /** The place on the ring, wrapping over the twelve colour pairs; null for the centre. */
  colour: number | null;
}

/** One hand-over line: the SVG path from the edge of one box to the edge of the other, and whether the opposite line exists too. */
export interface EdgePlace { index: number; from: string; to: string; d: string; twoWay: boolean }

export interface MapLayout {
  centre: string | null;
  /** The domains on the ring in drawing order (the first at the top, then clockwise), without the centre. */
  ring: string[];
  nodes: NodePlace[];
  edges: EdgePlace[];
  viewBox: { w: number; h: number };
}

const WIDTH = 1000;
const BASE_RX = 390;
const BASE_RY = 238;
const BASE_CAP = 12;
const MARGIN_Y = 78;
const BOX_H = 46;
const MIN_W = 96;
const MAX_W = 180;
const PADDING = 34;
const WIDE_CHAR = 15;
const NARROW_CHAR = 8;
const BOW = 0.28;
const OFFSET = 26;
const GAP = 4;

const ELLIPSIS = String.fromCharCode(0x2026);

/** A character of a script drawn full width (CJK, Hangul, kana, full-width forms) takes more room than a Latin one. */
const isWide = (character: string): boolean => {
  const code = character.codePointAt(0) ?? 0;
  return code >= 0x2e80 && code <= 0xd7a3 || code >= 0xf900 && code <= 0xfaff || code >= 0xff00 && code <= 0xff60;
};
const charWidth = (character: string): number => (isWide(character) ? WIDE_CHAR : NARROW_CHAR);

/** The box width of a name: its characters' room plus the padding, between the minimum and the maximum. */
export function boxWidth(name: string): number {
  const room = Array.from(name).reduce((sum, character) => sum + charWidth(character), 0);
  return Math.min(MAX_W, Math.max(MIN_W, room + PADDING));
}

/** The name as drawn: itself when it fits the widest box, else its start that fits with an ellipsis. */
export function fitLabel(name: string): { label: string; truncated: boolean } {
  const room = MAX_W - PADDING;
  const characters = Array.from(name);
  if (characters.reduce((sum, character) => sum + charWidth(character), 0) <= room) return { label: name, truncated: false };
  const budget = room - NARROW_CHAR;
  let used = 0;
  let label = '';
  for (const character of characters) {
    if (used + charWidth(character) > budget) break;
    used += charWidth(character);
    label += character;
  }
  return { label: `${label}${ELLIPSIS}`, truncated: true };
}

/** The centre: the domain with no incoming hand-over and the most outgoing ones (at least one), the earlier on a tie; null when none. */
export function centreOf(domains: readonly MapDomain[], handovers: readonly MapHandover[]): string | null {
  const known = new Set(domains.map((domain) => domain.id));
  const out = new Map<string, number>();
  const into = new Set<string>();
  for (const handover of handovers) {
    if (!known.has(handover.from) || !known.has(handover.to)) continue;
    out.set(handover.from, (out.get(handover.from) ?? 0) + 1);
    into.add(handover.to);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const domain of domains) {
    const count = out.get(domain.id) ?? 0;
    if (!into.has(domain.id) && count > bestCount) { best = domain.id; bestCount = count; }
  }
  return best;
}

/** The sum over the hand-overs between ring members of the shorter way round the ring between their places. */
export function ringCost(order: readonly string[], handovers: readonly MapHandover[]): number {
  const at = new Map(order.map((id, place) => [id, place]));
  const n = order.length;
  let cost = 0;
  for (const handover of handovers) {
    const a = at.get(handover.from);
    const b = at.get(handover.to);
    if (a === undefined || b === undefined) continue;
    const gap = Math.abs(a - b);
    cost += Math.min(gap, n - gap);
  }
  return cost;
}

/** From `start`, swap any two places while that lowers the ring cost; stops when a whole pass swaps nothing. Deterministic. */
export function orderRing(start: readonly string[], handovers: readonly MapHandover[]): string[] {
  const ring = start.slice();
  let cost = ringCost(ring, handovers);
  for (let swapped = true; swapped;) {
    swapped = false;
    for (let i = 0; i < ring.length; i += 1) {
      for (let j = i + 1; j < ring.length; j += 1) {
        [ring[i], ring[j]] = [ring[j], ring[i]];
        const next = ringCost(ring, handovers);
        if (next < cost) { cost = next; swapped = true; } else [ring[i], ring[j]] = [ring[j], ring[i]];
      }
    }
  }
  return ring;
}

interface Box { x: number; y: number; w: number; h: number }

/** Where the line from a box's centre towards (tx, ty) leaves the box, plus a small gap. */
function leave(box: Box, tx: number, ty: number): [number, number] {
  const dx = tx - box.x;
  const dy = ty - box.y;
  const sx = (box.w / 2 + GAP) / Math.abs(dx || 1e-6);
  const sy = (box.h / 2 + GAP) / Math.abs(dy || 1e-6);
  const s = Math.min(sx, sy);
  return [box.x + dx * s, box.y + dy * s];
}

const round = (value: number): string => value.toFixed(1);

/** The layout of `domains` (in the order given) and the hand-overs between them. */
export function layoutMap(domains: readonly MapDomain[], handovers: readonly MapHandover[]): MapLayout {
  const known = new Map(domains.map((domain) => [domain.id, domain]));
  const usable = handovers.filter((handover) => known.has(handover.from) && known.has(handover.to));
  const slot = new Map(usable.map((handover) => [handover, handovers.indexOf(handover)]));
  const centre = centreOf(domains, usable);
  const ring = orderRing(domains.map((domain) => domain.id).filter((id) => id !== centre), usable);

  const scale = Math.max(1, ring.length / BASE_CAP);
  const rx = Math.min(BASE_RX * scale, 400);
  const ry = BASE_RY * scale;
  const cx = WIDTH / 2;
  const cy = ry + MARGIN_Y;
  const viewBox = { w: WIDTH, h: Math.round(cy * 2) };

  const places = new Map<string, NodePlace>();
  const place = (id: string, x: number, y: number, colour: number | null): void => {
    const name = (known.get(id) as MapDomain).name;
    places.set(id, { id, x, y, w: boxWidth(name), h: BOX_H, ...fitLabel(name), colour });
  };
  ring.forEach((id, k) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * k) / ring.length;
    place(id, cx + rx * Math.cos(angle), cy + ry * Math.sin(angle), k % 12);
  });
  if (centre !== null) place(centre, cx, cy, null);

  const pairs = new Set(usable.map((handover) => `${handover.from}>${handover.to}`));
  const edges = usable.map((handover): EdgePlace => {
    const a = places.get(handover.from) as NodePlace;
    const b = places.get(handover.to) as NodePlace;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    let qx = mx + (cx - mx) * BOW;
    let qy = my + (cy - my) * BOW;
    const twoWay = pairs.has(`${handover.to}>${handover.from}`);
    if (twoWay) {
      const nx = -(b.y - a.y);
      const ny = b.x - a.x;
      const length = Math.hypot(nx, ny) || 1;
      qx += (nx / length) * OFFSET;
      qy += (ny / length) * OFFSET;
    }
    const [x1, y1] = leave(a, qx, qy);
    const [x2, y2] = leave(b, qx, qy);
    return { index: slot.get(handover) as number, from: handover.from, to: handover.to, twoWay, d: `M${round(x1)},${round(y1)} Q${round(qx)},${round(qy)} ${round(x2)},${round(y2)}` };
  });

  return { centre, ring, nodes: [...ring, ...(centre === null ? [] : [centre])].map((id) => places.get(id) as NodePlace), edges, viewBox };
}
