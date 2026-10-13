// Node shape legend (task 10.0): the shapes the current level draws, in the
// same geometry as the canvas, with how many nodes take each shape.
import { SHAPE_LEGEND, shapeForKind, type NodeShape } from '../model/node-visual';
import { fmtNumber } from '../format';
import type { CanvasNode } from './GraphCanvas';

function kindOf(node: CanvasNode): string {
  return node.kind ?? (node.tone === 'symbol' || node.tone === 'center' || node.tone === 'hop1' || node.tone === 'hop2' ? 'function' : node.tone);
}

export function ShapeIcon({ shape }: { shape: NodeShape }) {
  const common = { fill: 'var(--graph-legend-fill)', stroke: 'var(--text-secondary)', strokeWidth: 1 };
  let el;
  if (shape === 'rounded-square') el = <rect x={2.5} y={2.5} width={11} height={11} rx={3} {...common} />;
  else if (shape === 'hexagon') el = <polygon points="14,8 11,13.2 5,13.2 2,8 5,2.8 11,2.8" {...common} />;
  else if (shape === 'diamond') el = <polygon points="8,1.5 14.5,8 8,14.5 1.5,8" {...common} />;
  else if (shape === 'dashed-circle') el = <circle cx={8} cy={8} r={5.5} {...common} strokeDasharray="2 2" />;
  else if (shape === 'disc') el = <><circle cx={8} cy={8} r={4.5} {...common} /><circle cx={8} cy={8} r={6.6} fill="none" stroke="var(--series-1)" strokeWidth={1.6} /></>;
  else el = <circle cx={8} cy={8} r={5.5} {...common} />;
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden="true" className="shape-icon">
      {el}
    </svg>
  );
}

export function NodeLegend({ nodes }: { nodes: CanvasNode[] }) {
  const counts = new Map<NodeShape, number>();
  for (const node of nodes) {
    const shape = shapeForKind(kindOf(node));
    counts.set(shape, (counts.get(shape) ?? 0) + 1);
  }
  const rows = SHAPE_LEGEND.filter((row) => counts.has(row.shape));
  return (
    <ul className="legend node-legend" aria-label="Node shapes in this view">
      {rows.map((row) => (
        <li key={row.shape} data-node-shape={row.shape} data-node-shape-count={counts.get(row.shape)}>
          <ShapeIcon shape={row.shape} />
          {row.label} <span className="muted">{fmtNumber(counts.get(row.shape) ?? 0)}</span>
        </li>
      ))}
      <li className="muted" data-node-legend-note="">fill: language (as in the overview) · ring: a directory's languages by lines · rim ticks: incoming edges (log scale)</li>
    </ul>
  );
}
