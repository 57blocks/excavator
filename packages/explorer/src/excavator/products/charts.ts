/**
 * The geometry of the hand-drawn charts of the detail pages (openspec:
 * changes/viewer-learn, design D6): bar lengths, area paths and histogram
 * bins. Pure functions; the components in components/ui draw what these return.
 */

/** A value a chart can draw: a finite number of at least 0. Anything else is drawn as 0. */
function drawable(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Round to two decimals, so the markup carries short numbers. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The length of each bar on a track of `length`: proportional to its value over
 * the largest value, so the largest is the whole track and 0 is no bar. A list
 * whose values are all 0 has no bars.
 */
export function barLengths(values: readonly number[], length: number): number[] {
  let max = 0;
  for (const value of values) max = Math.max(max, drawable(value));
  return values.map((value) => (max === 0 ? 0 : round((drawable(value) / max) * length)));
}

export interface AreaPoint {
  label: string;
  value: number;
}

export interface AreaGeometry {
  /** Where each point is drawn, in the order given. */
  coords: [number, number][];
  /** The line through every point. */
  line: string;
  /** The line closed down to the baseline: the filled area. */
  area: string;
}

/**
 * An area chart in a box of `width` by `height`: the points spread evenly from
 * left to right (one point sits in the middle), the largest value at the top
 * and 0 on the baseline. No points, no paths.
 */
export function areaGeometry(points: readonly AreaPoint[], width: number, height: number): AreaGeometry {
  if (points.length === 0) return { coords: [], line: '', area: '' };
  let max = 0;
  for (const point of points) max = Math.max(max, drawable(point.value));
  const step = points.length === 1 ? 0 : width / (points.length - 1);
  const coords = points.map((point, i): [number, number] => [
    round(points.length === 1 ? width / 2 : i * step),
    round(max === 0 ? height : height - (drawable(point.value) / max) * height),
  ]);
  const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`).join(' ');
  const first = coords[0][0];
  const last = coords[coords.length - 1][0];
  return { coords, line, area: `M${first},${height} ${line.replace(/^M/, 'L')} L${last},${height} Z` };
}

export interface HistogramBin {
  /** The lower edge, included. */
  from: number;
  /** The upper edge: excluded, except for the last bin, which includes it. */
  to: number;
  count: number;
}

export interface HistogramCounts {
  bins: HistogramBin[];
  /** Values below the first edge, above the last, or not numbers: counted, never dropped. */
  outside: number;
}

/**
 * Count `values` into the bins the caller fixes by `edges` (ascending; n + 1
 * edges make n bins). Every value lands in one bin or in `outside`, so the
 * counts always add up to the number of values.
 */
export function histogramBins(values: readonly number[], edges: readonly number[]): HistogramCounts {
  for (let i = 1; i < edges.length; i++) {
    if (!(edges[i] > edges[i - 1])) throw new Error('histogram edges must be finite and strictly ascending');
  }
  if (edges.length < 2) throw new Error('a histogram needs at least two edges');
  const bins = edges.slice(0, -1).map((from, i) => ({ from, to: edges[i + 1], count: 0 }));
  let outside = 0;
  const last = bins.length - 1;
  for (const value of values) {
    if (!Number.isFinite(value) || value < edges[0] || value > edges[edges.length - 1]) {
      outside += 1;
      continue;
    }
    let index = bins.findIndex((bin) => value >= bin.from && value < bin.to);
    if (index === -1) index = last;
    bins[index].count += 1;
  }
  return { bins, outside };
}
