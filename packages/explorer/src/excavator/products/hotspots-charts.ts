/**
 * What the file panel reads from the hotspots product: the files most often changed together with a file, and the
 * files with the highest scores. A field the product lacks is left out, never drawn as 0.
 */

type Row = Record<string, any>;

const listOf = (value: unknown): Row[] => (Array.isArray(value) ? value.filter((row) => row !== null && typeof row === 'object') : []);

const comparePaths = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

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
