/**
 * What the Unused page shows around one row and above its table (openspec:
 * changes/viewer-learn, design D6): the other members of the row's group and
 * the group's entries, the row's referrers, and the bars by confidence and by
 * language. Everything is read from the product as it is; what the product
 * does not hold is said to be missing, never 0 or an empty list.
 */

import type { BarRow } from './bar-row';
import { CONFIDENCES, type UnusedRow } from './unused';

type Counts = Record<string, any>;

export type GroupMates =
  | { state: 'listed'; group: number; entries: string[]; others: string[] }
  | { state: 'no-group' }
  | { state: 'not-listed'; group: number };

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);

/** The row's group in the product's `groups`: its entries and its members other than the row, in the product's order. */
export function groupMates(groups: unknown, row: Pick<UnusedRow, 'id' | 'group'>): GroupMates {
  if (row.group === null) return { state: 'no-group' };
  const found = (Array.isArray(groups) ? groups : []).find((g) => g !== null && typeof g === 'object' && g.group === row.group);
  if (!found) return { state: 'not-listed', group: row.group };
  return { state: 'listed', group: row.group, entries: strings(found.entries), others: strings(found.members).filter((id) => id !== row.id) };
}

export interface ReferrerItem {
  id: string;
  edge: string | null;
  reverse: boolean | null;
  /** The referrer is a row of the unused list, so it can be opened. */
  listed: boolean;
}

export type ReferrerList = { state: 'listed'; referrers: ReferrerItem[] } | { state: 'not-provided' };

/** The row's direct referrers as the product records them; `listed` names those that are rows of the unused list. */
export function referrerList(row: Pick<UnusedRow, 'referrers'>, unusedIds: ReadonlySet<string>): ReferrerList {
  if (row.referrers === null) return { state: 'not-provided' };
  return { state: 'listed', referrers: row.referrers.map((r) => ({ ...r, listed: unusedIds.has(r.id) })) };
}

export interface Bars {
  rows: BarRow[];
  /** The bars the product has no count for, by label. */
  missing: string[];
}

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** The unused functions by confidence: the product's `counts.byConfidence`, in confidence order. */
export function confidenceBars(counts: Counts): Bars {
  const by = counts && typeof counts.byConfidence === 'object' && counts.byConfidence !== null ? counts.byConfidence : {};
  const rows: BarRow[] = [];
  const missing: string[] = [];
  for (const c of CONFIDENCES) {
    if (isCount(by[c])) rows.push({ key: c, label: c, value: by[c] });
    else missing.push(c);
  }
  return { rows, missing };
}

/** The unused functions by language: `counts.byLanguage[language].unused`, languages by name. */
export function languageBars(counts: Counts): Bars {
  const by = counts && typeof counts.byLanguage === 'object' && counts.byLanguage !== null ? counts.byLanguage : {};
  const rows: BarRow[] = [];
  const missing: string[] = [];
  for (const language of Object.keys(by).sort()) {
    const value = by[language]?.unused;
    if (isCount(value)) rows.push({ key: language, label: language, value });
    else missing.push(language);
  }
  return { rows, missing };
}
