// artifact-view final acceptance: the graph's hover tooltip never covers the
// hovered node or its label.
import { describe, expect, it } from 'vitest';
import { clearOfBand, placeTooltip } from '../../packages/view/src/views/tooltip-place.ts';

const bounds = { w: 800, h: 560 };
const size = { w: 200, h: 60 };

describe('hover tooltip placement', () => {
  it('goes above the node, centered on it', () => {
    const p = placeTooltip({ x: 400, top: 200, bottom: 240 }, size, bounds);
    expect(p).toEqual({ left: 300, top: 132, side: 'above' });
  });

  it('flips below the label when there is no room above', () => {
    const p = placeTooltip({ x: 400, top: 30, bottom: 70 }, size, bounds);
    expect(p).toEqual({ left: 300, top: 78, side: 'below' });
  });

  it('stays inside the canvas horizontally', () => {
    expect(placeTooltip({ x: 10, top: 200, bottom: 240 }, size, bounds).left).toBe(0);
    expect(placeTooltip({ x: 790, top: 200, bottom: 240 }, size, bounds).left).toBe(600);
  });

  it('takes the roomier side, still clear of the band, when neither side fits', () => {
    const tall = { w: 200, h: 300 };
    const p = placeTooltip({ x: 400, top: 250, bottom: 290 }, tall, bounds);
    expect(p.side).toBe('below');
    expect(clearOfBand({ top: p.top, height: tall.h }, { x: 400, top: 250, bottom: 290 })).toBe(true);
  });

  it('judges a laid-out box against the band, red for the old pointer-offset spot (instrument check)', () => {
    const band = { x: 400, top: 200, bottom: 240 };
    // The old placement: 14 px below and right of a pointer on the node, over its label.
    expect(clearOfBand({ top: 220 + 14, height: 60 }, band)).toBe(false);
    expect(clearOfBand({ top: 132, height: 60 }, band)).toBe(true);
    expect(clearOfBand({ top: 248, height: 60 }, band)).toBe(true);
  });
});
