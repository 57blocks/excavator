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
  const width = layers * WIDTH + (layers - 1) * GAP_X + 2 * PAD;
  const height = rows * HEIGHT + (rows - 1) * GAP_Y + 2 * PAD + (back.size > 0 ? BELOW : 0);
  const box = (id: string) => {
    const node = place.get(id)!;
    const offset = ((rows - counts[node.layer]) * (HEIGHT + GAP_Y)) / 2;
    return { x: PAD + node.layer * (WIDTH + GAP_X), y: PAD + offset + node.order * (HEIGHT + GAP_Y) };
  };
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
              const text = edge.text === undefined ? null : (
                <text className="flow-text" x={middle.x} y={middle.y - 6} textAnchor="middle">{edge.text}</text>
              );
              return (
                <g key={at} className="flow-edge" data-edge={`${edge.from} ${edge.to}`} data-back={back.has(at) ? '' : undefined}>
                  <path className="flow-line" d={path} fill="none" />
                  <path className="flow-head" d={head} />
                  {text}
                  {count !== null && (edge.href === undefined ? count : <a href={edge.href}>{count}</a>)}
                </g>
              );
            })}
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
