import { describe, expect, it } from 'vitest';

import { CARD_VARIANTS, DURATION, EASE, PAGE_VARIANTS, STAGGER_MAX, STAGGER_STEP, staggerDelay } from '../src/lib/motion';

describe('the motion vocabulary (design D8)', () => {
  it('staggers the first twelve by 30 ms and holds the rest at the twelfth', () => {
    expect(staggerDelay(0)).toBe(0);
    expect(staggerDelay(1)).toBeCloseTo(0.03);
    expect(staggerDelay(STAGGER_MAX - 1)).toBeCloseTo(0.33);
    expect(staggerDelay(STAGGER_MAX)).toBeCloseTo(staggerDelay(STAGGER_MAX - 1));
    expect(staggerDelay(500)).toBeCloseTo(staggerDelay(STAGGER_MAX - 1));
    expect(staggerDelay(-3)).toBe(0);
    expect(STAGGER_STEP).toBe(0.03);
  });

  it('uses the site easing and durations between 0.2 and 0.45 s, except the count roll', () => {
    expect([...EASE]).toEqual([0.16, 1, 0.3, 1]);
    for (const [name, seconds] of Object.entries(DURATION)) {
      if (name !== 'count') expect(seconds, name).toBeGreaterThanOrEqual(0.2);
      if (name !== 'count') expect(seconds, name).toBeLessThanOrEqual(0.45);
    }
    expect(DURATION.count).toBe(0.6);
  });

  it('lets a card enter by fading in and rising 12 px, staggered through the page', () => {
    expect(CARD_VARIANTS.hidden).toEqual({ opacity: 0, y: 12 });
    expect(CARD_VARIANTS.show).toMatchObject({ opacity: 1, y: 0 });
    const delay = (PAGE_VARIANTS.show as { transition: { delayChildren: (i: number) => number } }).transition.delayChildren;
    expect(delay(2)).toBeCloseTo(0.06);
    expect(delay(40)).toBeCloseTo(0.33);
  });
});
