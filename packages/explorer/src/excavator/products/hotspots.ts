/**
 * The Hotspots page's pure functions (openspec: changes/viewer-app, design D6;
 * spec "Hotspots page"): the window, fields a product may lack, scores, the
 * commits-by-year series and the notices about what the history can show.
 * Numbers are shown as the product states them; a field an older product lacks
 * says so and is never 0.
 */

import { formatNumber, NOT_PROVIDED } from './format';

export interface HotspotsWindow {
  since?: string | null;
  sinceUtc?: string | null;
}

export interface YearPoint {
  year: string;
  commits: number;
}

export interface SparkBar {
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
}

/** The window in words: "since 2025-01-01 (UTC midnight 2025-01-01T00:00:00Z)" or "whole history". */
export function windowText(win: HotspotsWindow | null | undefined): string {
  if (!win || typeof win.since !== 'string') return 'whole history';
  return `since ${win.since}${typeof win.sinceUtc === 'string' ? ` (${win.sinceUtc})` : ''}`;
}

/** A numeric field as a cell: absent is "not provided by the product", null is empty, a number is grouped. */
export function numberField(value: number | null | undefined): string | null {
  if (value === undefined) return NOT_PROVIDED;
  return value === null ? null : formatNumber(value);
}

/** A plain value as a cell: absent is "not provided by the product", null is empty. */
export function plainField(value: unknown): string | null {
  if (value === undefined) return NOT_PROVIDED;
  return value === null ? null : String(value);
}

/** The date part of an ISO time, or null. */
export function dateText(iso: unknown): string | null {
  return typeof iso === 'string' ? iso.slice(0, 10) : iso === undefined ? NOT_PROVIDED : null;
}

/** The instant of an ISO time as a number, for sorting (offsets are taken into account). */
export function timeKey(iso: unknown): number | null {
  if (typeof iso !== 'string') return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** The highest score among the rows; null when none has one. */
export function maxScore(rows: readonly { score?: number | null }[]): number | null {
  let max: number | null = null;
  for (const row of rows) if (typeof row.score === 'number' && (max === null || row.score > max)) max = row.score;
  return max;
}

/** A score as a percentage of the highest, 0 to 100; null when the row has no score or there is no highest. */
export function scoreShare(score: unknown, max: number | null): number | null {
  if (typeof score !== 'number' || max === null || max <= 0) return null;
  return Math.max(0, Math.min(100, (score / max) * 100));
}

/** The commits of each year, in year order; null when the row has none to give. */
export function yearSeries(commitsByYear: unknown): YearPoint[] | null {
  if (!commitsByYear || typeof commitsByYear !== 'object') return null;
  const byYear = commitsByYear as Record<string, number>;
  return Object.keys(byYear).sort((a, b) => Number(a) - Number(b)).map((year) => ({ year, commits: byYear[year] }));
}

/** The years as one text: "2020: 767, 2021: 462". */
export function yearText(series: readonly YearPoint[]): string {
  return series.map((p) => `${p.year}: ${p.commits}`).join(', ');
}

/** The bars of a sparkline: one per year, in a box of width x height, the highest year as tall as the box. */
export function sparkBars(series: readonly YearPoint[], width: number, height: number, gap: number): SparkBar[] {
  const n = series.length;
  if (n === 0) return [];
  const barWidth = Math.max(1, (width - (n - 1) * gap) / n);
  let max = 0;
  for (const p of series) if (p.commits > max) max = p.commits;
  return series.map((p, i) => {
    const barHeight = max === 0 ? 0 : (p.commits / max) * height;
    return { x: i * (barWidth + gap), y: height - barHeight, width: barWidth, height: barHeight, title: `${p.year}: ${p.commits} commits` };
  });
}

/** What the history cannot show, as sentences the product backs: no history, shallow clones, files outside every repository. */
export function notices(product: Record<string, any>): string[] {
  const out: string[] = [];
  if (product.historyAvailable === false) {
    const no = product.noHistory || {};
    let text = 'There is no history to count. Only line counts have values; commits, authors, scores and every other history field are empty.';
    if (no.reason === 'not-a-repository') {
      text += ' Reason: not-a-repository: the project root is not inside a Git work tree, and no child directory is a Git repository with commits.';
    } else if (no.reason === 'inside-repository') {
      text += ` Reason: inside-repository: the project root is the directory "${no.pathInRepository}" of the Git repository at "${no.repositoryRoot}" (relative to the project root). History is read only from a repository root.`;
    } else {
      text += ' The product records no reason.';
    }
    out.push(text);
  }
  for (const repo of Array.isArray(product.repos) ? product.repos : []) {
    if (repo.shallow === true) {
      out.push(`${repo.path} is a shallow clone: its counts are lower bounds. ${formatNumber(repo.boundaryCommits)} boundary commit(s) are not counted, and nothing before ${repo.earliestVisibleCommit} is visible.`);
    }
  }
  const counts = product.counts || {};
  if (typeof counts.filesWithoutHistory === 'number' && counts.filesWithoutHistory > 0 && product.historyAvailable !== false) {
    out.push(`${formatNumber(counts.filesWithoutHistory)} file(s) belong to no repository whose history was read and have no history.`);
  }
  return out;
}

/** The conservation line: changes read = attributed + outside the selection, with whether the numbers add up. */
export function conservationText(c: { changesRead?: number; attributed: number; outsideSelection: number } | null | undefined): string | null {
  if (!c || typeof c.changesRead !== 'number') return null;
  const holds = c.changesRead === c.attributed + c.outsideSelection;
  return `changes read (${formatNumber(c.changesRead)}) = attributed to selected files (${formatNumber(c.attributed)}) + outside the selection (${formatNumber(c.outsideSelection)}): ${holds ? 'holds' : 'does not hold'}`;
}

/** The rule the product used for pairs, in its own numbers. */
export function coChangeText(c: { maxFilesPerCommit: number; minTogether: number } | null | undefined): string | null {
  if (!c) return null;
  return `A pair counts the commits that changed both files. Commits that changed 2 to ${formatNumber(c.maxFilesPerCommit)} selected files are counted; a pair is listed when its files changed together at least ${formatNumber(c.minTogether)} times.`;
}

/** Rows whose text for any of `fields` (functions returning text) contains the query, ignoring case. */
export function filterRows<T>(rows: readonly T[], query: string, fields: readonly ((row: T) => unknown)[]): readonly T[] {
  const q = (query || '').trim().toLowerCase();
  if (q === '') return rows;
  return rows.filter((row) => fields.some((field) => {
    const value = field(row);
    return typeof value === 'string' && value.toLowerCase().includes(q);
  }));
}
