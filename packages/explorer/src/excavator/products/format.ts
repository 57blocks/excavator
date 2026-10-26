/**
 * What the page shows for a number or a value a product does not hold
 * (report-viewer: the em dash is an empty value, never 0 or an empty string;
 * a field an older product predates says so in words).
 */

/** The em dash. */
export const EMPTY = String.fromCharCode(0x2014);
export const EN_DASH = String.fromCharCode(0x2013);
/** What the page says where a product predates a field (the field is absent, not null). */
export const NOT_PROVIDED = 'not provided by the product';

/** Group digits in threes: 1234567 becomes "1,234,567". Anything that is not a finite number gives the empty-value dash. */
export function formatNumber(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return EMPTY;
  const sign = value < 0 ? '-' : '';
  return sign + String(Math.abs(Math.round(value))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** A source revision as the top bar's chip shows it: each run of twelve or more hex digits (a commit hash) cut to its first eight; the full revision stays in the chip's title. */
export function shortRevision(revision: string): string {
  return revision.replace(/[0-9a-f]{12,}/gi, (hash) => hash.slice(0, 8));
}
