/**
 * Where the Domain view puts its canvas when a level opens: the content centred in the pane when it fits, top-aligned
 * and left-aligned at the padding when it does not. Pure; the view applies the result once per level change.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface InitialViewportInput {
  /** The bounding box of the nodes, in flow coordinates. */
  bounds: Rect;
  /** The size of the canvas container, in pixels. */
  pane: { width: number; height: number };
  padding: number;
  minZoom: number;
  maxZoom: number;
  /** The height at the top that something covers (the Back and breadcrumb bar); the content's top stays below it. */
  topInset?: number;
}

/** One axis: the content's offset in the pane, centred in the space between the margins when it fits, else at the start margin. */
function place(start: number, length: number, paneLength: number, zoom: number, before: number, after: number): number {
  const size = length * zoom;
  const room = paneLength - before - after;
  return size <= room ? before + (room - size) / 2 - start * zoom : before - start * zoom;
}

export function initialViewport({ bounds, pane, padding, minZoom, maxZoom, topInset = 0 }: InitialViewportInput): Viewport {
  const top = Math.max(padding, topInset);
  const fitX = bounds.width > 0 ? (pane.width - 2 * padding) / bounds.width : Infinity;
  const fitY = bounds.height > 0 ? (pane.height - top - padding) / bounds.height : Infinity;
  const zoom = Math.max(minZoom, Math.min(maxZoom, fitX, fitY));
  return {
    x: place(bounds.x, bounds.width, pane.width, zoom, padding, padding),
    y: place(bounds.y, bounds.height, pane.height, zoom, top, padding),
    zoom,
  };
}
