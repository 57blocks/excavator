// Where the graph's hover tooltip goes: never over the hovered node or the
// label drawn under it. The tooltip sits above the node; when there is no
// room above it flips below the label; horizontally it is centered on the
// node and kept inside the canvas.

/** The hovered node's vertical band on screen: from its top edge down to the bottom of its label. */
export interface TooltipAnchor {
  x: number;
  top: number;
  bottom: number;
}

export interface TooltipPlacement {
  left: number;
  top: number;
  side: 'above' | 'below';
}

export const TOOLTIP_GAP = 8;

export function placeTooltip(
  anchor: TooltipAnchor,
  size: { w: number; h: number },
  bounds: { w: number; h: number },
  gap: number = TOOLTIP_GAP,
): TooltipPlacement {
  const left = Math.min(Math.max(0, anchor.x - size.w / 2), Math.max(0, bounds.w - size.w));
  const above = anchor.top - gap - size.h;
  const below = anchor.bottom + gap;
  let side: 'above' | 'below';
  if (above >= 0) side = 'above';
  else if (below + size.h <= bounds.h) side = 'below';
  // Fits on neither side: take the roomier one and overflow the canvas rather than cover the label.
  else side = anchor.top >= bounds.h - anchor.bottom ? 'above' : 'below';
  return { left, top: side === 'above' ? above : below, side };
}

/** Whether a box's vertical extent (as laid out in the page) stays clear of the anchor band. */
export function clearOfBand(box: { top: number; height: number }, anchor: TooltipAnchor): boolean {
  return box.top + box.height <= anchor.top || box.top >= anchor.bottom;
}
