/**
 * Search over the graph's nodes (openspec: changes/viewer-app, design D3; spec
 * "Search, filters, focus and paths"): fuzzy subsequence scoring over a node's
 * name and file path, in the package, no search library. A query matches when
 * each of its words matches the name or the path; a word matches as the whole
 * text, a prefix, a run of characters, or a subsequence (its characters in
 * order, gaps allowed). The tiers are far apart, so a closer kind of match
 * always ranks above a looser one; inside a tier, word starts, unbroken runs
 * and shorter text rank higher.
 */

import type { GraphNode } from '../data/graph';

export interface SearchEntry {
  id: string;
  type: string;
  name: string;
  path: string;
  lowerName: string;
  lowerPath: string;
}

export interface SearchHit {
  id: string;
  score: number;
  /** What matched best: the name or the path. */
  field: 'name' | 'path';
}

const TIER = { whole: 1000, prefix: 900, run: 700, subsequence: 400 } as const;
/** A path match ranks below the same kind of name match. */
const PATH_OFFSET = 200;
/** A match in the path of a node that is not a file ranks below the file node's own match, and below a name that matches loosely. */
const NON_FILE_PENALTY = 200;
const BOUNDARY = /[\s/._\-:()[\]]/;

const isBoundaryAt = (text: string, i: number) => i === 0 || BOUNDARY.test(text[i - 1]);

/**
 * How well `query` (lower case, no spaces) matches `text` (lower case): the tier
 * base plus bonuses and minus a small length cost; null when it does not match.
 */
export function fuzzyScore(query: string, text: string): number | null {
  if (query === '' || text === '') return null;
  const lengthCost = Math.min(text.length, 200) * 0.05;
  if (text === query) return TIER.whole;
  if (text.startsWith(query)) return TIER.prefix - lengthCost;
  const at = text.indexOf(query);
  if (at !== -1) return TIER.run + (isBoundaryAt(text, at) ? 40 : 0) - Math.min(at, 100) * 0.2 - lengthCost;

  // Subsequence: the earliest match of each character in order.
  let from = 0;
  let bonus = 0;
  let previous = -2;
  let first = -1;
  for (const char of query) {
    const found = text.indexOf(char, from);
    if (found === -1) return null;
    if (first === -1) first = found;
    if (found === previous + 1) bonus += 6;
    if (isBoundaryAt(text, found)) bonus += 8;
    previous = found;
    from = found + 1;
  }
  const span = previous - first + 1;
  return TIER.subsequence + Math.min(bonus, 150) - Math.min(span - query.length, 100) * 1.5 - lengthCost;
}

/** The searchable form of the graph's nodes, built once. */
export function buildSearchIndex(nodes: Iterable<GraphNode>): SearchEntry[] {
  const entries: SearchEntry[] = [];
  for (const node of nodes) {
    const path = typeof node.filePath === 'string' ? node.filePath : '';
    entries.push({ id: node.id, type: node.type, name: node.name, path, lowerName: node.name.toLowerCase(), lowerPath: path.toLowerCase() });
  }
  return entries;
}

function scoreEntry(words: readonly string[], entry: SearchEntry): SearchHit | null {
  let total = 0;
  let nameWords = 0;
  for (const word of words) {
    const name = fuzzyScore(word, entry.lowerName);
    const path = fuzzyScore(word, entry.lowerPath);
    const pathScore = path === null ? null : path - PATH_OFFSET - (entry.type === 'file' ? 0 : NON_FILE_PENALTY);
    if (name === null && pathScore === null) return null;
    if (name !== null && (pathScore === null || name >= pathScore)) {
      total += name;
      nameWords += 1;
    } else {
      total += pathScore as number;
    }
  }
  return { id: entry.id, score: total / words.length, field: nameWords * 2 >= words.length ? 'name' : 'path' };
}

/** The best `limit` matches of `query`, best first; ties go to the shorter name, then the id. An empty query matches nothing. */
export function searchNodes(entries: readonly SearchEntry[], query: string, limit = 30): SearchHit[] {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word !== '');
  if (words.length === 0) return [];
  const hits: { hit: SearchHit; entry: SearchEntry }[] = [];
  for (const entry of entries) {
    const hit = scoreEntry(words, entry);
    if (hit) hits.push({ hit, entry });
  }
  hits.sort((a, b) => b.hit.score - a.hit.score || a.entry.name.length - b.entry.name.length || (a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0));
  return hits.slice(0, limit).map((item) => item.hit);
}
