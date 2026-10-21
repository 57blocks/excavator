/**
 * Where the camera goes when a level is shown (openspec: changes/viewer-app,
 * design D4 and D7). A level opens fitted whole, unless something in it was
 * located (a search result, a "Locate in graph", a pasted address) and fitting
 * the whole level would draw that node too small to read: a function inside a
 * file expanded to hundreds of rows is a row a few pixels tall at the zoom that
 * shows the file. Then the camera centres on the node instead, at a readable
 * zoom, in the room the cards over the canvas leave free.
 */

import type { Padding } from './fit-padding';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The zoom below which a node's text is too small to read; the camera keeps a located node at least this large. */
export const READABLE_ZOOM = 0.8;

export interface CameraInput {
  /** The box around everything the level draws, in the level's own coordinates. */
  bounds: Rect;
  /** The box of the located node, when there is one and the level draws it. */
  target: Rect | null;
  /** The size of the canvas. */
  pane: { width: number; height: number };
  /** The room the cards over the canvas take on each side. */
  padding: Padding;
  minZoom: number;
  maxZoom: number;
}

export type CameraMove = { kind: 'fit' } | { kind: 'centre'; x: number; y: number; zoom: number };

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

/** The box around `boxes`; null when there are none. */
export function boundsOf(boxes: Iterable<Rect>): Rect | null {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const box of boxes) {
    left = Math.min(left, box.x);
    top = Math.min(top, box.y);
    right = Math.max(right, box.x + box.width);
    bottom = Math.max(bottom, box.y + box.height);
  }
  return left === Number.POSITIVE_INFINITY ? null : { x: left, y: top, width: right - left, height: bottom - top };
}

/** Fit the level, or centre on the located node when the fit would leave it too small to read. */
export function levelCamera({ bounds, target, pane, padding, minZoom, maxZoom }: CameraInput): CameraMove {
  if (target === null) return { kind: 'fit' };
  const freeWidth = Math.max(1, pane.width - padding.left - padding.right);
  const freeHeight = Math.max(1, pane.height - padding.top - padding.bottom);
  const fit = clamp(Math.min(freeWidth / Math.max(1, bounds.width), freeHeight / Math.max(1, bounds.height)), minZoom, maxZoom);
  if (fit >= READABLE_ZOOM) return { kind: 'fit' };
  // As large as is readable, but no larger than lets the node itself show whole; never smaller than the whole level would be.
  const zoom = clamp(Math.min(1, freeWidth / Math.max(1, target.width), freeHeight / Math.max(1, target.height)), fit, maxZoom);
  if (zoom <= fit) return { kind: 'fit' };
  const middle = { x: (padding.left + pane.width - padding.right) / 2, y: (padding.top + pane.height - padding.bottom) / 2 };
  return {
    kind: 'centre',
    x: middle.x - (target.x + target.width / 2) * zoom,
    y: middle.y - (target.y + target.height / 2) * zoom,
    zoom,
  };
}
