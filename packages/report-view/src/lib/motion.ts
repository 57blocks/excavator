import type { Variants } from 'motion/react';

/**
 * The motion vocabulary of the 57blocks site (openspec: changes/viewer-app,
 * design D8): one easing, and durations of 0.2 to 0.45 s. Entrances move up and
 * fade in; with reduced motion requested the components skip them altogether.
 */

/** The site's `--ease`. */
export const EASE = [0.16, 1, 0.3, 1] as const;

export const DURATION = {
  view: 0.35,
  panel: 0.3,
  dialog: 0.25,
  count: 0.6,
  camera: 0.4,
} as const;

export const STAGGER_STEP = 0.03;
/** Only the first twelve cards or tiles of a view are staggered; the rest enter with the twelfth. */
export const STAGGER_MAX = 12;

/** The delay before the item at `index` (0-based) of a view enters. */
export function staggerDelay(index: number): number {
  return Math.min(Math.max(0, index), STAGGER_MAX - 1) * STAGGER_STEP;
}

/**
 * A view's entrance: the page holds the "hidden" and "show" labels and each card
 * under it (at any depth) fades in and rises 12 px, one after another. A card
 * that arrives after the page has shown (data still loading) enters on its own.
 */
export const PAGE_VARIANTS: Variants = {
  hidden: {},
  show: { transition: { delayChildren: (index: number) => staggerDelay(index) } },
};

export const CARD_VARIANTS: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: DURATION.view, ease: EASE } },
};
