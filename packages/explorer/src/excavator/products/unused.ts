/**
 * The unused-code rows the right panel and the node panel read from what `unused-code.json` holds.
 * Missing fields stay null, never 0 or an empty string.
 */

export interface UnusedSignal {
  signal: string;
  [field: string]: unknown;
}

/** One direct referrer of an unused function, as the product records it. */
export interface UnusedReferrer {
  id: string;
  edge: string | null;
  reverse: boolean | null;
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
  /** Null when the product's row has no `referrers` field (an older product); an empty list when it has none. */
  referrers: UnusedReferrer[] | null;
  /** Lower-cased name, owner and file, joined, for the text search. */
  search: string;
}

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

const isReferrer = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && typeof (value as Record<string, unknown>).id === 'string';
const toReferrer = (r: Record<string, unknown>): UnusedReferrer => ({ id: r.id as string, edge: text(r.edge), reverse: typeof r.reverse === 'boolean' ? r.reverse : null });

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
    referrers: Array.isArray(raw.referrers) ? raw.referrers.filter(isReferrer).map(toReferrer) : null,
    search: [name, owner, file].join('\n').toLowerCase(),
  };
}
