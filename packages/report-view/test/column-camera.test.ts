import { describe, expect, it } from 'vitest';

import { columnCamera, type ColumnInput } from '../src/lib/column-camera';

const PANE = { width: 1080, height: 812 };
// The breadcrumbs over the top-left corner, the controls and the minimap in the bottom corners.
const CRUMBS = { left: 12, right: 572, top: 12, bottom: 113 };
const CONTROLS = { left: 12, right: 40, top: 700, bottom: 800 };
const MINIMAP = { left: 868, right: 1068, top: 650, bottom: 800 };
const base: ColumnInput = { bounds: { x: 0, y: 0, width: 320, height: 700 }, pane: PANE, topCards: [CRUMBS], bottomCards: [CONTROLS, MINIMAP], maxZoom: 1, floor: 0.9 };

/** Where the camera puts the point (x, y) of the column on screen. */
const screen = (move: { x: number; y: number; zoom: number }, x: number, y: number) => ({ x: x * move.zoom + move.x, y: y * move.zoom + move.y });

describe('columnCamera', () => {
  it('clears only the cards the column is under: the minimap and the controls at the sides leave the bottom free', () => {
    const move = columnCamera(base);
    // The free height is the pane's less the crumbs' and the margin below: (812 - 121 - 24) / 700 = 0.95.
    expect(move.zoom).toBeCloseTo((812 - 121 - 24) / 700, 2);
    expect(screen(move, 0, 0).y).toBeGreaterThanOrEqual(121);
    expect(screen(move, 0, 700).y).toBeLessThanOrEqual(812 - 24);
  });

  it('clears a card the column is under, and one that is moved aside no longer costs room', () => {
    const under = columnCamera({ ...base, bottomCards: [{ left: 400, right: 700, top: 700, bottom: 800 }] });
    const aside = columnCamera({ ...base, bottomCards: [{ left: 12, right: 200, top: 700, bottom: 800 }] });
    expect(under.zoom).toBeLessThan(aside.zoom);
  });

  it('centres a column that fits, at no more than the maximum zoom', () => {
    const move = columnCamera({ ...base, bounds: { x: 0, y: 0, width: 320, height: 300 } });
    expect(move.zoom).toBe(1);
    const centre = screen(move, 160, 150);
    expect(centre.x).toBeCloseTo(PANE.width / 2, 5);
    expect(centre.y).toBeGreaterThan(121);
    expect(centre.y).toBeLessThan(812 - 24);
  });

  it('does not draw a tall column below the floor: it starts at the top of the free room and is scrolled', () => {
    const move = columnCamera({ ...base, bounds: { x: 0, y: 0, width: 320, height: 2000 } });
    expect(move.zoom).toBe(0.9);
    expect(screen(move, 0, 0).y).toBe(121);
  });

  it('fits a column that is wider than the pane by its width', () => {
    const move = columnCamera({ ...base, bounds: { x: 0, y: 0, width: 4000, height: 100 }, floor: 0.05 });
    expect(move.zoom).toBeCloseTo((1080 - 48) / 4000, 3);
  });

  it('follows the bounds that do not start at the origin', () => {
    const move = columnCamera({ ...base, bounds: { x: 500, y: 300, width: 320, height: 700 } });
    expect(screen(move, 660, 300).x).toBeCloseTo(PANE.width / 2, 5);
    expect(screen(move, 500, 300).y).toBeGreaterThanOrEqual(121);
  });
});
