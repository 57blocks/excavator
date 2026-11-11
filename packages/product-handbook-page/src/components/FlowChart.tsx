import type { ReactElement } from 'react';
import { layered } from '../lib/layers';

/** A box of the diagram: what it shows, where it links and its kind (the styles tell an external system apart). */
export interface ChartNode { id: string; label: string; href: string; kind?: 'system' | 'feature' | 'state' | 'item'; unverified?: boolean }
/** An arrow of the diagram; `count`, when given, is drawn on it and links to `href`; `text`, when given, is drawn beside it. */
export interface ChartEdge { from: string; to: string; count?: number; href?: string; text?: string }

/** The size of a box and the gaps between them, in pixels. */
const WIDTH = 168;
const HEIGHT = 56;
const GAP_X = 72;
const GAP_Y = 20;
const PAD = 12;
const BELOW = 32;
const HEAD = 8;
/** An edge text is 11px: a CJK or fullwidth character is as wide as the font is high, any other character about half of it. */
const WIDE = 11;
const NARROW = 6;
const LABEL_PAD = 8;
const LABEL_HEIGHT = 14;

const textWidth = (text: string): number => [...text].reduce((sum, char) => sum + (char.codePointAt(0)! >= 0x2e80 ? WIDE : NARROW), 0);

/** Where the cubic curve of a forward arrow (both control points at the bend) is at the abscissa `x`: its height there. */
function curveY(x1: number, y1: number, x2: number, y2: number, x: number): number {
  const bend = (x1 + x2) / 2;
  let [low, high] = [0, 1];
  for (let step = 0; step < 40; step += 1) {
    const t = (low + high) / 2;
    const at = (1 - t) ** 3 * x1 + 3 * (1 - t) ** 2 * t * bend + 3 * (1 - t) * t * t * bend + t ** 3 * x2;
    if (at < x) low = t; else high = t;
  }
  const t = (low + high) / 2;
  return y1 + (y2 - y1) * (3 * t * t - 2 * t ** 3);
}

const right = (x: number, y: number): string => `M${x},${y} L${x - HEAD},${y - 4} L${x - HEAD},${y + 4} z`;
const up = (x: number, y: number): string => `M${x},${y} L${x - 4},${y + HEAD} L${x + 4},${y + HEAD} z`;

/**
 * A flowchart of the overview (openspec change handbook-domain-page, design D3): the layout is `layered`, left to right.
 * Each box is a link drawn in HTML over an inline SVG of the arrows, so a long name wraps inside its box; an arrow that
 * closes a cycle runs below the boxes, dashed. The boxes have a fixed size, so a wide diagram scrolls inside its own box
 * and the page never does.
 */
export function FlowChart({ nodes, edges, label, part }: { nodes: ChartNode[]; edges: ChartEdge[]; label: string; part: string }) {
  const layout = layered(nodes.map((node) => node.id), edges);
  const place = new Map(layout.nodes.map((node) => [node.id, node]));
  const layers = Math.max(0, ...layout.nodes.map((node) => node.layer)) + 1;
  const counts = Array.from({ length: layers }, (_, at) => layout.nodes.filter((node) => node.layer === at).length);
  const rows = Math.max(1, ...counts);
  const back = new Set(layout.back);
  // A gap between two layers is as wide as the longest text of an arrow that ends in the layer after it, and never narrower than GAP_X.
  const gaps = Array.from({ length: Math.max(0, layers - 1) }, () => GAP_X);
  edges.forEach((edge, at) => {
    if (edge.text === undefined || back.has(at) || !place.has(edge.from) || !place.has(edge.to)) return;
    const gap = place.get(edge.to)!.layer - 1;
    gaps[gap] = Math.max(gaps[gap], Math.ceil(textWidth(edge.text)) + 2 * LABEL_PAD);
  });
  const layerX = (layer: number): number => PAD + layer * WIDTH + gaps.slice(0, layer).reduce((sum, gap) => sum + gap, 0);
  const box = (id: string) => {
    const node = place.get(id)!;
    const offset = ((rows - counts[node.layer]) * (HEIGHT + GAP_Y)) / 2;
    return { x: layerX(node.layer), y: PAD + offset + node.order * (HEIGHT + GAP_Y) };
  };
  // Each text sits in its gap at the height of its own arrow; the texts of one gap, from the top, are pushed down to keep LABEL_HEIGHT apart.
  const labels = new Map<number, { x: number; y: number }>();
  const byGap = new Map<number, { at: number; x: number; y: number }[]>();
  edges.forEach((edge, at) => {
    if (edge.text === undefined || back.has(at) || !place.has(edge.from) || !place.has(edge.to)) return;
    const [from, to] = [box(edge.from), box(edge.to)];
    const gap = place.get(edge.to)!.layer - 1;
    const x = layerX(gap) + WIDTH + gaps[gap] / 2;
    const y = curveY(from.x + WIDTH, from.y + HEIGHT / 2, to.x - HEAD, to.y + HEIGHT / 2, x) - 6;
    byGap.set(gap, [...(byGap.get(gap) ?? []), { at, x, y }]);
  });
  let lowest = 0;
  for (const items of byGap.values()) {
    items.sort((a, b) => a.y - b.y || a.at - b.at);
    items.forEach((item, index) => {
      if (index > 0) item.y = Math.max(item.y, items[index - 1].y + LABEL_HEIGHT);
      labels.set(item.at, { x: item.x, y: item.y });
      lowest = Math.max(lowest, item.y + 3 + PAD);
    });
  }
  const width = layers * WIDTH + gaps.reduce((sum, gap) => sum + gap, 0) + 2 * PAD;
  const height = Math.max(rows * HEIGHT + (rows - 1) * GAP_Y + 2 * PAD + (back.size > 0 ? BELOW : 0), Math.ceil(lowest));
  const texts: ReactElement[] = [];
  return (
    <figure className="flow" data-part={part}>
      <div className="flow-scroll">
        <div className="flow-inner" style={{ width, height }}>
          <svg className="flow-svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
            {edges.map((edge, at) => {
              if (!place.has(edge.from) || !place.has(edge.to)) return null;
              const from = box(edge.from);
              const to = box(edge.to);
              let path: string;
              let head: string;
              let middle: { x: number; y: number };
              if (back.has(at)) {
                const bottom = Math.max(from.y, to.y) + HEIGHT + BELOW - 4;
                const [x1, x2] = [from.x + WIDTH / 2, to.x + WIDTH / 2];
                path = `M${x1},${from.y + HEIGHT} C${x1},${bottom} ${x2},${bottom} ${x2},${to.y + HEIGHT + HEAD}`;
                head = up(x2, to.y + HEIGHT);
                middle = { x: (x1 + x2) / 2, y: bottom - 0.25 * (bottom - Math.max(from.y, to.y) - HEIGHT) };
              } else {
                const [x1, y1, x2, y2] = [from.x + WIDTH, from.y + HEIGHT / 2, to.x - HEAD, to.y + HEIGHT / 2];
                const bend = (x1 + x2) / 2;
                path = `M${x1},${y1} C${bend},${y1} ${bend},${y2} ${x2},${y2}`;
                head = right(to.x, y2);
                middle = { x: bend, y: (y1 + y2) / 2 };
              }
              const count = edge.count === undefined ? null : (
                <>
                  <circle className="flow-badge" cx={middle.x} cy={middle.y} r={10} />
                  <text className="flow-count" x={middle.x} y={middle.y} dy="0.35em" textAnchor="middle">{String(edge.count)}</text>
                </>
              );
              const spot = labels.get(at) ?? { x: middle.x, y: middle.y - 6 };
              // The texts are drawn in a group after every arrow, so no line runs over one.
              if (edge.text !== undefined) texts.push(<text key={at} className="flow-text" x={spot.x} y={spot.y} textAnchor="middle">{edge.text}</text>);
              return (
                <g key={at} className="flow-edge" data-edge={`${edge.from} ${edge.to}`} data-back={back.has(at) ? '' : undefined}>
                  <path className="flow-line" d={path} fill="none" />
                  <path className="flow-head" d={head} />
                  {count !== null && (edge.href === undefined ? count : <a href={edge.href}>{count}</a>)}
                </g>
              );
            })}
            {texts.length > 0 && <g className="flow-labels">{texts}</g>}
          </svg>
          {nodes.map((node) => {
            const { x, y } = box(node.id);
            return (
              <a key={node.id} className="flow-node" data-kind={node.kind} data-unverified={node.unverified === true ? '' : undefined} href={node.href} title={node.label} style={{ left: x, top: y, width: WIDTH, height: HEIGHT }}>
                <span>{node.label}</span>
              </a>
            );
          })}
        </div>
      </div>
    </figure>
  );
}
