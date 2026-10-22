import { BaseEdge, getStraightPath, useInternalNode, type EdgeProps } from '@xyflow/react';

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where the line from the middle of `from` towards the middle of `to` leaves `from`'s box. */
function borderPoint(from: Rect, to: Rect): { x: number; y: number } {
  const cx = from.x + from.width / 2;
  const cy = from.y + from.height / 2;
  const dx = to.x + to.width / 2 - cx;
  const dy = to.y + to.height / 2 - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const scale = 1 / Math.max(Math.abs(dx) / (from.width / 2), Math.abs(dy) / (from.height / 2));
  return { x: cx + dx * scale, y: cy + dy * scale };
}

/** The straight line from the border of the `source` node to the border of the `target` node, with its middle; null while either is not measured. */
export function useFloatingLine(source: string, target: string): { path: string; labelX: number; labelY: number } | null {
  const from = useInternalNode(source);
  const to = useInternalNode(target);
  if (!from || !to) return null;
  const rect = (node: typeof from): Rect => ({ x: node.internals.positionAbsolute.x, y: node.internals.positionAbsolute.y, width: node.measured.width ?? node.width ?? 0, height: node.measured.height ?? node.height ?? 0 });
  const a = rect(from);
  const b = rect(to);
  const start = borderPoint(a, b);
  const end = borderPoint(b, a);
  const [path, labelX, labelY] = getStraightPath({ sourceX: start.x, sourceY: start.y, targetX: end.x, targetY: end.y });
  return { path, labelX, labelY };
}

/** A straight edge from the border of one box to the border of the other, so its arrowhead is not under a node. */
export function FloatingEdge({ id, source, target, markerEnd, markerStart, style, label, labelStyle, labelBgStyle, labelBgPadding, labelBgBorderRadius }: EdgeProps) {
  const line = useFloatingLine(source, target);
  if (!line) return null;
  return (
    <BaseEdge
      id={id}
      path={line.path}
      markerEnd={markerEnd}
      markerStart={markerStart}
      style={style}
      label={label}
      labelX={line.labelX}
      labelY={line.labelY}
      labelStyle={labelStyle}
      labelBgStyle={labelBgStyle}
      labelBgPadding={labelBgPadding}
      labelBgBorderRadius={labelBgBorderRadius}
      interactionWidth={16}
    />
  );
}

export const FLOATING_EDGE_TYPES = { floating: FloatingEdge };
