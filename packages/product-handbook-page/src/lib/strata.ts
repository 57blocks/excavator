import type { CSSProperties } from 'react';

/** A fill and the edge that goes with it. */
export interface Pair { fill: string; edge: string }

/** The twelve low-saturation pairs of the domains (sand, glacier, clay, sage, rose, straw, slate, mint, taupe, lime, heather, amber). */
export const STRATA: readonly Pair[] = [
  { fill: '#E9DDBF', edge: '#8C6D2C' },
  { fill: '#C4DDE8', edge: '#2E6B85' },
  { fill: '#F1D2C3', edge: '#9A4E2E' },
  { fill: '#CFE2C6', edge: '#4C7A3D' },
  { fill: '#EBCFD9', edge: '#93405E' },
  { fill: '#ECE4AE', edge: '#7A6C17' },
  { fill: '#CED8EC', edge: '#3D5A93' },
  { fill: '#C6E1D8', edge: '#2F7461' },
  { fill: '#E1D2BC', edge: '#7A5B36' },
  { fill: '#D8E6B0', edge: '#5C7420' },
  { fill: '#DCD5EC', edge: '#5E4F94' },
  { fill: '#F0D9B0', edge: '#8A5A12' },
];

/** The pair of the centre domain and of anything that has no domain. */
export const NEUTRAL: Pair = { fill: '#DCDFE3', edge: '#59636F' };

/**
 * The colour pair of each domain id. For now a pair goes to each id by its place in `ids`, wrapping after twelve; the map
 * will assign them by the position on its ring through this one function.
 */
export function domainColours(ids: readonly string[]): Record<string, Pair> {
  return Object.fromEntries(ids.map((id, at) => [id, STRATA[at % STRATA.length]]));
}

/** The attributes an element carries to take a pair: the custom properties the stylesheet reads, and the marker that selects them. */
export function colourProps(pair: Pair): { 'data-dom': string; style: CSSProperties } {
  return { 'data-dom': '', style: { '--c-fill': pair.fill, '--c-edge': pair.edge } as CSSProperties };
}
