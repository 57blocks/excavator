import { describe, expect, it } from 'vitest';

import { areaGeometry, barLengths, histogramBins } from '../charts';

describe('barLengths (design D6)', () => {
  it('makes each bar its value over the largest: the largest fills the track and 0 draws nothing', () => {
    expect(barLengths([40, 10, 0, 20], 100)).toEqual([100, 25, 0, 50]);
    expect(barLengths([3, 7], 210)).toEqual([90, 210]);
  });

  it('keeps the ratios of any two bars equal to the ratios of their values', () => {
    const values = [17, 5, 93, 41, 1];
    const lengths = barLengths(values, 100);
    for (let i = 0; i < values.length; i++) {
      for (let j = 0; j < values.length; j++) expect(lengths[i] * values[j]).toBeCloseTo(lengths[j] * values[i], 0);
    }
  });

  it('draws no bar when every value is 0, and treats a negative or missing number as 0', () => {
    expect(barLengths([0, 0], 100)).toEqual([0, 0]);
    expect(barLengths([Number.NaN, -4, 8], 100)).toEqual([0, 0, 100]);
    expect(barLengths([], 100)).toEqual([]);
  });
});

describe('areaGeometry (design D6)', () => {
  const points = [
    { label: '2021', value: 4 },
    { label: '2022', value: 0 },
    { label: '2023', value: 8 },
    { label: '2024', value: 2 },
  ];

  it('places every point, left to right, the largest at the top and 0 on the baseline', () => {
    const { coords } = areaGeometry(points, 300, 60);
    expect(coords).toEqual([[0, 30], [100, 60], [200, 0], [300, 45]]);
  });

  it('runs the line through every point and closes the area on the baseline', () => {
    const { coords, line, area } = areaGeometry(points, 300, 60);
    for (const [x, y] of coords) {
      expect(line).toContain(`${x},${y}`);
      expect(area).toContain(`${x},${y}`);
    }
    expect(line.match(/[ML]/g)).toHaveLength(points.length);
    expect(area.startsWith('M0,60 ')).toBe(true);
    expect(area.endsWith(' L300,60 Z')).toBe(true);
  });

  it('puts a single point in the middle, and draws nothing for none', () => {
    expect(areaGeometry([{ label: '2024', value: 3 }], 300, 60).coords).toEqual([[150, 0]]);
    expect(areaGeometry([], 300, 60)).toEqual({ coords: [], line: '', area: '' });
  });
});

describe('histogramBins (design D6)', () => {
  it('counts each value into the bin the caller fixed, the top edge into the last bin', () => {
    const { bins, outside } = histogramBins([0, 0.1, 0.25, 0.5, 0.5, 0.75, 0.99, 1], [0, 0.25, 0.5, 0.75, 1]);
    expect(bins.map((b) => b.count)).toEqual([2, 1, 2, 3]);
    expect(bins.map((b) => [b.from, b.to])).toEqual([[0, 0.25], [0.25, 0.5], [0.5, 0.75], [0.75, 1]]);
    expect(outside).toBe(0);
  });

  it('counts a value outside the edges or not a number as outside, so nothing is dropped', () => {
    const values = [-1, 5, Number.NaN, 2, 3];
    const { bins, outside } = histogramBins(values, [0, 2, 4]);
    expect(bins.map((b) => b.count)).toEqual([0, 2]);
    expect(outside).toBe(3);
    expect(bins.reduce((n, b) => n + b.count, outside)).toBe(values.length);
  });

  it('refuses edges that do not ascend or are too few', () => {
    expect(() => histogramBins([1], [0, 0, 1])).toThrow(/ascending/);
    expect(() => histogramBins([1], [2, 1])).toThrow(/ascending/);
    expect(() => histogramBins([1], [1])).toThrow(/two edges/);
  });
});
