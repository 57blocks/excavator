/**
 * What the Hotspots page draws above its tables and in a file's row panel
 * (openspec: changes/viewer-learn, design D6): the project's commits per year,
 * the distribution of file scores, the files with the highest scores, and the
 * files most often changed together with a file. Every number is a product
 * field or a count over the product's rows; a field the product lacks is said
 * to be missing, never drawn as 0.
 */

import type { AreaPoint } from './charts';

type Row = Record<string, any>;

const listOf = (value: unknown): Row[] => (Array.isArray(value) ? value.filter((row) => row !== null && typeof row === 'object') : []);

const comparePaths = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export type ProjectYears =
  | { state: 'provided'; points: AreaPoint[]; total: number }
  | { state: 'not-provided' }
  | { state: 'no-history' };

/** The directory row that stands for the whole project. */
export const ROOT_DIRECTORY = '.';

/**
 * The project's commits per year: the `commitsByYear` of the product's project-root directory row (`.`), whose
 * commits are each counted once. The rows of other directories are not added up: a commit that changed two of them
 * would count twice. No root row, or a root row without the field (or with a value that is not a count), is not
 * provided; `null` is the product's word for no history.
 */
export function projectYears(product: Row): ProjectYears {
  const root = listOf(product.directories).find((row) => row.path === ROOT_DIRECTORY);
  if (!root || root.commitsByYear === undefined) return { state: 'not-provided' };
  if (root.commitsByYear === null) return { state: 'no-history' };
  const byYear = root.commitsByYear;
  if (typeof byYear !== 'object' || Array.isArray(byYear)) return { state: 'not-provided' };
  const years = Object.keys(byYear).sort((a, b) => Number(a) - Number(b));
  if (years.some((year) => typeof byYear[year] !== 'number' || !Number.isFinite(byYear[year]))) return { state: 'not-provided' };
  const points = years.map((year) => ({ label: year, value: byYear[year] as number }));
  return { state: 'provided', points, total: points.reduce((sum, point) => sum + point.value, 0) };
}

export interface CoChange {
  path: string;
  together: number;
}

/**
 * The files most often changed together with `path`: the other file of each pair that names it, by the pair's
 * `together` (most first, ties by path), the first `n`. A pair without a count is left out.
 */
export function coChanged(pairs: unknown, path: string, n: number): CoChange[] {
  const best = new Map<string, number>();
  for (const pair of listOf(pairs)) {
    if (typeof pair.together !== 'number') continue;
    const other = pair.a === path ? pair.b : pair.b === path ? pair.a : null;
    if (typeof other !== 'string' || other === path) continue;
    best.set(other, Math.max(best.get(other) ?? -Infinity, pair.together));
  }
  return [...best].map(([other, together]) => ({ path: other, together }))
    .sort((x, y) => y.together - x.together || comparePaths(x.path, y.path))
    .slice(0, n);
}

/** The `n` files with the highest scores (ties by path); a file without a score is left out. */
export function topFiles(files: unknown, n: number): { path: string; score: number }[] {
  return listOf(files)
    .filter((row) => typeof row.path === 'string' && typeof row.score === 'number' && Number.isFinite(row.score))
    .map((row) => ({ path: row.path as string, score: row.score as number }))
    .sort((x, y) => y.score - x.score || comparePaths(x.path, y.path))
    .slice(0, n);
}

/** How many bins the score distribution has. */
export const SCORE_BINS = 10;

export type ScoreHistogram =
  | { state: 'bins'; values: number[]; edges: number[]; withoutScore: number }
  | { state: 'none'; withoutScore: number; scored: number };

/**
 * The scores of the files, binned evenly from 0 to the highest score. A file without a score (binary, or no
 * history) is counted apart. With no score above 0 there is nothing to bin.
 */
export function scoreHistogram(files: unknown): ScoreHistogram {
  const values: number[] = [];
  let withoutScore = 0;
  for (const row of listOf(files)) {
    if (typeof row.score === 'number' && Number.isFinite(row.score)) values.push(row.score);
    else withoutScore += 1;
  }
  const max = values.reduce((m, v) => Math.max(m, v), 0);
  if (max <= 0) return { state: 'none', withoutScore, scored: values.length };
  const edges = Array.from({ length: SCORE_BINS + 1 }, (_, i) => (i === SCORE_BINS ? max : (max * i) / SCORE_BINS));
  return { state: 'bins', values, edges, withoutScore };
}
