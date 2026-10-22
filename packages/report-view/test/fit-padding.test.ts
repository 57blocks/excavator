import { describe, expect, it } from 'vitest';

import { asPixels, fitPadding, SIDE } from '../src/lib/fit-padding';

const pane = { top: 100, bottom: 900 };

describe('fitPadding', () => {
  it('leaves the plain margin on every side when no card is over the canvas', () => {
    expect(fitPadding(pane, [], [])).toEqual({ top: SIDE, right: SIDE, bottom: SIDE, left: SIDE });
  });

  it('clears a card on the top edge by its own height: a taller card leaves more room', () => {
    const short = fitPadding(pane, [{ top: 112, bottom: 152 }], []);
    const tall = fitPadding(pane, [{ top: 112, bottom: 232 }], []);
    expect(short.top).toBe(152 - 100 + 16);
    expect(tall.top).toBe(232 - 100 + 16);
    expect(tall.top).toBeGreaterThan(short.top);
  });

  it('clears the tallest of the cards on the bottom edge: the legend, the minimap and the controls', () => {
    const legend = { top: 780, bottom: 888 };
    const minimap = { top: 735, bottom: 888 };
    const controls = { top: 800, bottom: 888 };
    expect(fitPadding(pane, [], [legend, minimap, controls]).bottom).toBe(900 - 735 + 16);
    expect(fitPadding(pane, [], [{ top: 700, bottom: 888 }, minimap, controls]).bottom).toBe(900 - 700 + 16);
  });

  it('keeps the top and the bottom apart', () => {
    const padding = fitPadding(pane, [{ top: 112, bottom: 200 }], [{ top: 800, bottom: 888 }]);
    expect(padding).toEqual({ top: 116, right: SIDE, bottom: 116, left: SIDE });
  });

  it('writes the padding in pixels for the camera', () => {
    expect(asPixels({ top: 116, right: 24, bottom: 90, left: 24 })).toEqual({ top: '116px', right: '24px', bottom: '90px', left: '24px' });
  });
});
