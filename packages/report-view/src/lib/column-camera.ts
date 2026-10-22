/**
 * Where the camera puts a column of cards (the steps of a flow; openspec: changes/viewer-app, design D4 and D12). Fitting a tall
 * column into what every card over the canvas leaves free shrinks it to a strip; but the cards sit at the sides and the corners,
 * and a column in the middle of the pane is under only some of them. The room is cleared for the cards the column would be under
 * at the zoom it ends up at, and the zoom never goes below `floor`: a column taller than what is left is read from its top and
 * scrolled, not drawn small.
 */

import { SIDE, type Card } from './fit-padding';
import type { Rect } from './camera';

export interface ColumnInput {
  /** The box around the column, in the level's own coordinates. */
  bounds: Rect;
  pane: { width: number; height: number };
  /** The cards along the top edge of the pane and those along the bottom edge. */
  topCards: readonly Card[];
  bottomCards: readonly Card[];
  /** The zoom the column is fitted at when it fits, and the zoom it is not drawn below. */
  maxZoom: number;
  floor: number;
}

export interface ColumnMove {
  x: number;
  y: number;
  zoom: number;
}

/** The gap between the column and a card it is under. */
const GAP = 8;
/** The zoom is looked for in steps of this much, from the maximum down. */
const STEP = 0.01;

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

/**
 * The camera for a column centred in the pane: the largest zoom at which the column fits in what the cards it would be under
 * leave free (a card is cleared only when the column, drawn at that zoom, is under it); when none does, the zoom `floor`, with the
 * column started at the top of the free room and scrolled.
 */
export function columnCamera({ bounds, pane, topCards, bottomCards, maxZoom, floor }: ColumnInput): ColumnMove {
  const width = Math.max(1, bounds.width);
  const height = Math.max(1, bounds.height);
  const centre = pane.width / 2;
  const roomAt = (zoom: number) => {
    const left = centre - (width * zoom) / 2;
    const right = centre + (width * zoom) / 2;
    const under = (card: Card) => card.left < right && card.right > left;
    const clearTop = Math.max(0, ...topCards.filter(under).map((card) => card.bottom));
    const clearBottom = Math.max(0, ...bottomCards.filter(under).map((card) => pane.height - card.top));
    return { top: clearTop > 0 ? clearTop + GAP : SIDE, bottom: clearBottom > 0 ? clearBottom + GAP : SIDE };
  };
  const widthZoom = (pane.width - 2 * SIDE) / width;
  let zoom = floor;
  let room = roomAt(floor);
  for (let candidate = clamp(widthZoom, floor, maxZoom); candidate > floor; candidate -= STEP) {
    const at = roomAt(candidate);
    if (height * candidate <= pane.height - at.top - at.bottom) {
      zoom = candidate;
      room = at;
      break;
    }
  }
  const free = pane.height - room.top - room.bottom;
  const x = centre - (bounds.x + width / 2) * zoom;
  // A column that fits is centred in what is free; one that does not starts at the top of it.
  const y = (height * zoom <= free ? room.top + (free - height * zoom) / 2 : room.top) - bounds.y * zoom;
  return { x, y, zoom };
}
