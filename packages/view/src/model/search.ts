// Name / path / id search (artifact-view task 5.2): case-insensitive
// subsequence matching over every node. Pure and DOM-free: the index is built
// and queried inside the data Worker (or on the main thread when no Worker is
// available) and in Node tests.
import { isTable, type Segments } from '../data';

export type MatchField = 'name' | 'id' | 'path';

export interface NameHit {
  row: number;
  field: MatchField;
  score: number;
}

export interface NameSearchResult {
  query: string;
  /** Every matching node, before the limit. */
  total: number;
  hits: NameHit[];
}

export interface NameIndex {
  rows: number;
  names: string[];
  ids: string[];
  paths: string[];
}

/**
 * Score a subsequence match of `query` in `target` (both lowercased), or -1
 * when `query` is not a subsequence. Higher is better: contiguous runs, a
 * match at the start or right after a separator, and short targets score more.
 */
export function subsequenceScore(query: string, target: string): number {
  if (query.length === 0) return -1;
  if (query.length > target.length) return -1;
  let score = 0;
  let qi = 0;
  let previous = -2;
  for (let ti = 0; ti < target.length && qi < query.length; ti += 1) {
    if (target.charCodeAt(ti) !== query.charCodeAt(qi)) continue;
    score += 1;
    if (ti === previous + 1) score += 2;
    if (ti === 0 || isSeparator(target.charCodeAt(ti - 1))) score += 3;
    previous = ti;
    qi += 1;
  }
  if (qi < query.length) return -1;
  return score * 100 - target.length;
}

function isSeparator(code: number): boolean {
  // / . : _ - ( , space #
  return code === 47 || code === 46 || code === 58 || code === 95 || code === 45 || code === 40 || code === 44 || code === 32 || code === 35;
}

export function buildNameIndex(segments: Segments, strings: string[]): NameIndex {
  const nodes = segments.nodes;
  if (!isTable(nodes)) return { rows: 0, names: [], ids: [], paths: [] };
  const text = (col: Int32Array | undefined, row: number) => {
    const c = col ? col[row] : -1;
    return c >= 0 && typeof strings[c] === 'string' ? strings[c].toLowerCase() : '';
  };
  const names: string[] = new Array(nodes.rows);
  const ids: string[] = new Array(nodes.rows);
  const paths: string[] = new Array(nodes.rows);
  for (let row = 0; row < nodes.rows; row += 1) {
    names[row] = text(nodes.columns.name, row);
    ids[row] = text(nodes.columns.id, row);
    paths[row] = text(nodes.columns.path, row);
  }
  return { rows: nodes.rows, names, ids, paths };
}

/** Name matches rank above id matches, id above path matches; ties keep graph order. */
const FIELD_BONUS: Record<MatchField, number> = { name: 2_000_000, id: 1_000_000, path: 0 };

export function searchNames(index: NameIndex, rawQuery: string, limit: number): NameSearchResult {
  const query = rawQuery.trim().toLowerCase();
  if (query === '') return { query: rawQuery, total: 0, hits: [] };
  const hits: NameHit[] = [];
  for (let row = 0; row < index.rows; row += 1) {
    let best: NameHit | null = null;
    for (const field of ['name', 'id', 'path'] as const) {
      const target = field === 'name' ? index.names[row] : field === 'id' ? index.ids[row] : index.paths[row];
      const s = subsequenceScore(query, target);
      if (s < 0) continue;
      const score = s + FIELD_BONUS[field];
      if (best === null || score > best.score) best = { row, field, score };
    }
    if (best) hits.push(best);
  }
  hits.sort((a, b) => b.score - a.score || a.row - b.row);
  return { query: rawQuery, total: hits.length, hits: hits.slice(0, Math.max(0, limit)) };
}
