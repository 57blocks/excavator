/**
 * The room the camera leaves around a level when it fits the view (openspec:
 * changes/viewer-app, design D4): the cards that sit over the canvas (the
 * breadcrumbs above, the legend, the minimap and the controls below) take their
 * own height, so the first row of nodes is never under one. The cards are
 * measured, not assumed: their height changes with the breadcrumb's wrapping and
 * the overlays' legends.
 */

export interface Edges {
  top: number;
  bottom: number;
}

/** A card over the canvas, as a box in the pane's own coordinates. */
export interface Card {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** The space left on every side, and between a card and the nodes. */
export const SIDE = 24;
const GAP = 16;

/**
 * The padding that clears every card: a card on the top edge of `pane` clears by the distance from the pane's top to the card's
 * bottom, one on the bottom edge by the distance from the card's top to the pane's bottom, plus a gap. With no card on a side, that side has SIDE.
 */
export function fitPadding(pane: Edges, topCards: readonly Edges[], bottomCards: readonly Edges[]): Padding {
  const top = Math.max(0, ...topCards.map((card) => card.bottom - pane.top));
  const bottom = Math.max(0, ...bottomCards.map((card) => pane.bottom - card.top));
  return { top: top > 0 ? top + GAP : SIDE, right: SIDE, bottom: bottom > 0 ? bottom + GAP : SIDE, left: SIDE };
}

/** What the cards over the canvas are marked with, and the library's own bottom cards. */
const TOP = '[data-xv-chrome="top"]';
const BOTTOM = '[data-xv-chrome="bottom"], .react-flow__minimap, .react-flow__controls';
/** Every card over the canvas. */
export const CARDS = `${TOP}, ${BOTTOM}`;

/** The padding that clears the cards currently over `pane` (a card that is not drawn has no height and is skipped). */
export function measureFitPadding(pane: HTMLElement): Padding {
  const edges = (selector: string) => [...pane.querySelectorAll(selector)].map((el) => el.getBoundingClientRect()).filter((box) => box.height > 0);
  return fitPadding(pane.getBoundingClientRect(), edges(TOP), edges(BOTTOM));
}

/** The cards over `pane` along its top edge and along its bottom edge, in the pane's own coordinates (a card that is not drawn is skipped). */
export function measureCards(pane: HTMLElement): { topCards: Card[]; bottomCards: Card[] } {
  const origin = pane.getBoundingClientRect();
  const cards = (selector: string): Card[] =>
    [...pane.querySelectorAll(selector)]
      .map((el) => el.getBoundingClientRect())
      .filter((box) => box.height > 0)
      .map((box) => ({ left: box.left - origin.left, right: box.right - origin.left, top: box.top - origin.top, bottom: box.bottom - origin.top }));
  return { topCards: cards(TOP), bottomCards: cards(BOTTOM) };
}

/** The padding as the camera takes it. */
export const asPixels = (padding: Padding) => ({
  top: `${padding.top}px` as const,
  right: `${padding.right}px` as const,
  bottom: `${padding.bottom}px` as const,
  left: `${padding.left}px` as const,
});
