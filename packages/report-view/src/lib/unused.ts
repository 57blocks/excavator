/**
 * The Unused code page's pure functions (openspec: changes/viewer-app, design
 * D6; spec "Unused code page"): rows, filters and sort keys over what
 * `unused-code.json` holds. Missing fields stay null, never 0 or an empty string.
 */

import type { SortKey } from './table';

export const CONFIDENCES = ['high', 'medium', 'low'] as const;
export const REASONS = ['unreferenced', 'only-reachable-from-unused'] as const;

const CONFIDENCE_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };
const NO_LANGUAGE = 'unknown';
const SIGNALS_SHOWN = 2;
const QUERY_HEAD_CHARS = 60;

export interface UnusedSignal {
  signal: string;
  [field: string]: unknown;
}

export interface UnusedRow {
  id: string;
  name: string | null;
  owner: string | null;
  language: string | null;
  file: string | null;
  lineRange: number[] | null;
  visibility: string | null;
  reason: string | null;
  confidence: string | null;
  group: number | null;
  signals: UnusedSignal[];
  /** Lower-cased name, owner and file, joined, for the text search. */
  search: string;
}

export interface UnusedFilters {
  confidence?: readonly string[];
  reason?: readonly string[];
  language?: readonly string[];
  text?: string;
  group?: number | null;
}

/** The signals as one short text: the first two names, then how many more there are ("capped, name-elsewhere +3"). */
export function signalsText(signals: readonly UnusedSignal[] | null | undefined): string | null {
  if (!signals || signals.length === 0) return null;
  const names = signals.slice(0, SIGNALS_SHOWN).map((signal) => signal.signal);
  const more = signals.length - names.length;
  return names.join(', ') + (more > 0 ? ` +${more}` : '');
}

/** Everything the signals record, as JSON text, for the tooltip. */
export function signalsTitle(signals: readonly UnusedSignal[] | null | undefined): string | null {
  return signals && signals.length > 0 ? JSON.stringify(signals) : null;
}

/** The first line of a query, cut to QUERY_HEAD_CHARS; `rest` says whether anything of the query is left out. */
export function queryHead(query: string): { head: string; rest: boolean } {
  const first = query.split('\n')[0];
  const head = first.length > QUERY_HEAD_CHARS ? `${first.slice(0, QUERY_HEAD_CHARS)}...` : first;
  return { head, rest: head !== query };
}

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** A table row from one `unused[]` entry of the product. */
export function normalizeRow(raw: Record<string, unknown>): UnusedRow {
  const range = Array.isArray(raw.lineRange) && typeof raw.lineRange[0] === 'number' ? (raw.lineRange as number[]) : null;
  const name = text(raw.name);
  const owner = text(raw.owner);
  const file = text(raw.file);
  return {
    id: String(raw.id),
    name,
    owner,
    language: text(raw.language),
    file,
    lineRange: range,
    visibility: text(raw.visibility),
    reason: text(raw.reason),
    confidence: text(raw.confidence),
    group: typeof raw.group === 'number' ? raw.group : null,
    signals: Array.isArray(raw.signals) ? (raw.signals as UnusedSignal[]) : [],
    search: [name, owner, file].join('\n').toLowerCase(),
  };
}

export const languageOf = (row: Pick<UnusedRow, 'language'>) => (row.language === null ? NO_LANGUAGE : row.language);

const includes = (list: readonly string[], value: string) => list.length === 0 || list.includes(value);

/**
 * The rows that match every filter. An empty list or text, or a null group, does not filter.
 * Text is matched, ignoring case, against the name, the owner and the file.
 */
export function filterRows(rows: readonly UnusedRow[], filters: UnusedFilters): UnusedRow[] {
  const query = (filters.text || '').trim().toLowerCase();
  const confidence = filters.confidence || [];
  const reason = filters.reason || [];
  const language = filters.language || [];
  const group = filters.group === undefined ? null : filters.group;
  return rows.filter((row) => (
    includes(confidence, row.confidence as string) && includes(reason, row.reason as string) && includes(language, languageOf(row))
    && (group === null || row.group === group) && (query === '' || row.search.includes(query))
  ));
}

/** The distinct values of a field over the rows, sorted. */
export function distinct<T>(rows: readonly T[], valueOf: (row: T) => string): string[] {
  return [...new Set(rows.map(valueOf))].sort();
}

const pad = (n: number) => String(n).padStart(10, '0');

/** The sort keys of the columns, by column id. */
export const KEYS: Record<'name' | 'owner' | 'language' | 'location' | 'visibility' | 'reason' | 'confidence' | 'group' | 'signals', (row: UnusedRow) => SortKey> = {
  name: (row) => row.name,
  owner: (row) => row.owner,
  language: (row) => row.language,
  location: (row) => (row.file === null ? null : `${row.file}\n${pad(row.lineRange === null ? 0 : row.lineRange[0])}`),
  visibility: (row) => row.visibility,
  reason: (row) => row.reason,
  confidence: (row) => (row.confidence === null ? null : CONFIDENCE_RANK[row.confidence] || 0),
  group: (row) => row.group,
  signals: (row) => row.signals.length,
};
