import { describe, expect, it } from "vitest";
import { initialViewport } from "../initialViewport";

const pane = { width: 1000, height: 600 };
const base = { pane, padding: 40, minZoom: 0.75, maxZoom: 1 };

describe("initialViewport", () => {
  it("centres small content on both axes at the maximum zoom", () => {
    const view = initialViewport({ ...base, bounds: { x: 0, y: 0, width: 400, height: 200 } });
    expect(view).toEqual({ x: 300, y: 200, zoom: 1 });
  });

  it("allows for the bounds' own offset when centring", () => {
    const view = initialViewport({ ...base, bounds: { x: 100, y: 50, width: 400, height: 200 } });
    expect(view).toEqual({ x: 200, y: 150, zoom: 1 });
  });

  it("top-aligns tall content and still centres it horizontally", () => {
    const view = initialViewport({ ...base, minZoom: 1, bounds: { x: 0, y: 0, width: 400, height: 5000 } });
    expect(view).toEqual({ x: 300, y: 40, zoom: 1 });
  });

  it("leaves content wider than the pane at the left padding when the zoom is held at the minimum", () => {
    const view = initialViewport({ ...base, bounds: { x: 0, y: 0, width: 3000, height: 200 } });
    expect(view.zoom).toBe(0.75);
    expect(view.x).toBe(40);
    expect(view.y).toBe((600 - 200 * 0.75) / 2);
  });

  it("fits content that is a little too large, between the zoom limits", () => {
    const view = initialViewport({ ...base, bounds: { x: 0, y: 0, width: 1200, height: 200 } });
    expect(view.zoom).toBeCloseTo((1000 - 80) / 1200, 6);
    expect(view.x).toBeCloseTo(40, 6);
  });

  it("never goes above the maximum or below the minimum zoom", () => {
    expect(initialViewport({ ...base, bounds: { x: 0, y: 0, width: 10, height: 10 } }).zoom).toBe(1);
    expect(initialViewport({ ...base, bounds: { x: 0, y: 0, width: 90000, height: 90000 } }).zoom).toBe(0.75);
  });

  it("copes with an empty pane or empty content", () => {
    expect(initialViewport({ ...base, pane: { width: 0, height: 0 }, bounds: { x: 0, y: 0, width: 400, height: 200 } }).zoom).toBeGreaterThan(0);
    expect(initialViewport({ ...base, bounds: { x: 0, y: 0, width: 0, height: 0 } })).toEqual({ x: 500, y: 300, zoom: 1 });
  });
});
