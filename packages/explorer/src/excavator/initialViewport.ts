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
}

/** One axis: the content's offset in the pane, centred when it fits inside the padding, else at the padding. */
function place(start: number, length: number, paneLength: number, zoom: number, padding: number): number {
  const size = length * zoom;
  return size <= paneLength - 2 * padding ? (paneLength - size) / 2 - start * zoom : padding - start * zoom;
}

export function initialViewport({ bounds, pane, padding, minZoom, maxZoom }: InitialViewportInput): Viewport {
  const fitX = bounds.width > 0 ? (pane.width - 2 * padding) / bounds.width : Infinity;
  const fitY = bounds.height > 0 ? (pane.height - 2 * padding) / bounds.height : Infinity;
  const zoom = Math.max(minZoom, Math.min(maxZoom, fitX, fitY));
  return {
    x: place(bounds.x, bounds.width, pane.width, zoom, padding),
    y: place(bounds.y, bounds.height, pane.height, zoom, padding),
    zoom,
  };
}
