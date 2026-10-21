import { describe, expect, it } from 'vitest';

import { boundsOf, levelCamera, READABLE_ZOOM, type CameraInput } from '../src/lib/camera';

const PANE = { width: 1000, height: 800 };
const PADDING = { top: 100, right: 24, bottom: 60, left: 24 };
const base: Omit<CameraInput, 'bounds' | 'target'> = { pane: PANE, padding: PADDING, minZoom: 0.02, maxZoom: 1.2 };

/** Where the camera puts the point (x, y) of the flow on screen. */
const screen = (move: { x: number; y: number; zoom: number }, x: number, y: number) => ({ x: x * move.zoom + move.x, y: y * move.zoom + move.y });

describe('levelCamera', () => {
  it('fits the level when nothing is located', () => {
    expect(levelCamera({ ...base, bounds: { x: 0, y: 0, width: 4000, height: 3000 }, target: null })).toEqual({ kind: 'fit' });
  });

  it('fits the level when the fit leaves things readable, whatever is located', () => {
    const bounds = { x: 0, y: 0, width: 1200, height: 900 };
    const target = { x: 100, y: 100, width: 240, height: 56 };
    // The fit zoom here is about 0.71, below the readable zoom; the smaller level fits at more than 1.
    const small = { x: 0, y: 0, width: 800, height: 500 };
    expect(levelCamera({ ...base, bounds: small, target })).toEqual({ kind: 'fit' });
    expect(levelCamera({ ...base, bounds, target }).kind).toBe('centre');
  });

  it('centres on the located node, at a readable zoom, when the fit would make it tiny: a function in a long file', () => {
    // One file expanded to a thousand rows: 240 wide and 26,000 tall; the fit zoom is far below a readable size.
    const bounds = { x: 0, y: 0, width: 600, height: 26000 };
    const target = { x: 12, y: 15000, width: 216, height: 22 };
    const move = levelCamera({ ...base, bounds, target });
    expect(move.kind).toBe('centre');
    if (move.kind !== 'centre') return;
    expect(move.zoom).toBe(1);
    // The node's middle is in the middle of the room the cards leave free.
    const at = screen(move, target.x + target.width / 2, target.y + target.height / 2);
    expect(at.x).toBeCloseTo((PADDING.left + (PANE.width - PADDING.right)) / 2);
    expect(at.y).toBeCloseTo((PADDING.top + (PANE.height - PADDING.bottom)) / 2);
  });

  it('leaves the room the cards take: more padding below moves the node up', () => {
    const bounds = { x: 0, y: 0, width: 600, height: 26000 };
    const target = { x: 12, y: 15000, width: 216, height: 22 };
    const open = levelCamera({ ...base, bounds, target }) as Extract<ReturnType<typeof levelCamera>, { kind: 'centre' }>;
    const crowded = levelCamera({ ...base, padding: { ...PADDING, bottom: 400 }, bounds, target }) as Extract<ReturnType<typeof levelCamera>, { kind: 'centre' }>;
    expect(screen(crowded, 0, 15011).y).toBeLessThan(screen(open, 0, 15011).y);
  });

  it('does not zoom past the maximum or below what the whole level would be at', () => {
    const bounds = { x: 0, y: 0, width: 600, height: 26000 };
    const target = { x: 12, y: 15000, width: 216, height: 22 };
    const limited = levelCamera({ ...base, maxZoom: 0.9, bounds, target }) as Extract<ReturnType<typeof levelCamera>, { kind: 'centre' }>;
    expect(limited.zoom).toBe(0.9);
    // A node bigger than the free room shrinks until it fits, but never below the zoom that fits the level.
    const huge = levelCamera({ ...base, bounds: { x: 0, y: 0, width: 600, height: 26000 }, target: { x: 0, y: 0, width: 600, height: 26000 } });
    expect(huge.kind).toBe('fit');
  });

  it('has a readable zoom that is the one the camera keeps for a selected node', () => {
    expect(READABLE_ZOOM).toBeGreaterThan(0.5);
    expect(READABLE_ZOOM).toBeLessThan(1);
  });
});

describe('boundsOf', () => {
  it('is the box around every box', () => {
    expect(boundsOf([{ x: 10, y: 20, width: 100, height: 50 }, { x: -30, y: 0, width: 10, height: 400 }])).toEqual({ x: -30, y: 0, width: 140, height: 400 });
  });

  it('is nothing for no boxes', () => {
    expect(boundsOf([])).toBeNull();
  });
});
