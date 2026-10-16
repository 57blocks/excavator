// Pure derivations for the Coverage & Gaps section. The conservation check is
// recomputed here from the coverage record, never trusted from elsewhere: a
// language row balances only when files = parsed + zeroSymbol + sum(skipped).
import type { Coverage, Gap, SelectionEntry, SelectionFunnel } from '../data';
import { languageOrder } from './colors';

export interface LanguageRow {
  language: string;
  files: number | null;
  parsed: number | null;
  zeroSymbol: number | null;
  skipped: Array<{ reason: string; count: number | null }>;
  /** parsed + zeroSymbol + sum(skipped); null when any term is not a number */
  accounted: number | null;
  balanced: boolean;
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

export function coverageRows(coverage: Coverage | null): { rows: LanguageRow[]; skipReasons: string[] } {
  const byLanguage = coverage?.byLanguage ?? {};
  const reasonTotals = new Map<string, number>();
  const rows = languageOrder(coverage).map((language): LanguageRow => {
    const entry = byLanguage[language] ?? {};
    const skippedRecord = entry.skipped && typeof entry.skipped === 'object' ? entry.skipped : {};
    const skipped = Object.entries(skippedRecord).map(([reason, value]) => {
      const n = count(value);
      reasonTotals.set(reason, (reasonTotals.get(reason) ?? 0) + (n ?? 0));
      return { reason, count: n };
    });
    const files = count(entry.files);
    const parsed = count(entry.parsed);
    const zeroSymbol = count(entry.zeroSymbol);
    const terms = [parsed, zeroSymbol, ...skipped.map((s) => s.count)];
    const accounted = terms.every((t) => t !== null) ? terms.reduce<number>((sum, t) => sum + (t as number), 0) : null;
    return { language, files, parsed, zeroSymbol, skipped, accounted, balanced: files !== null && accounted === files };
  });
  const skipReasons = [...reasonTotals].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([reason]) => reason);
  return { rows, skipReasons };
}

/** The equation text for one row, e.g. "3 = 2 + 0 + 1" or "5 ≠ 3 + 0 + 1". */
export function conservationText(row: LanguageRow): string {
  const fmt = (n: number | null) => (n === null ? '?' : String(n));
  const rhs = [fmt(row.parsed), fmt(row.zeroSymbol), ...row.skipped.map((s) => fmt(s.count))].join(' + ');
  return `${fmt(row.files)} ${row.balanced ? '=' : '≠'} ${rhs}`;
}

export interface FunnelModel {
  recorded: boolean;
  policyVersion: string | null;
  candidates: number | null;
  branches: Array<{ key: string; label: string; value: number | null }>;
}

export function selectionFunnel(selection: SelectionFunnel | null | undefined): FunnelModel {
  const s = selection ?? null;
  return {
    recorded: s !== null,
    policyVersion: typeof s?.policyVersion === 'string' ? s.policyVersion : null,
    candidates: count(s?.candidates),
    branches: [
      { key: 'selected', label: 'Selected', value: count(s?.selected) },
      { key: 'filteredByDefaults', label: 'Filtered by defaults', value: count(s?.filteredByDefaults) },
      { key: 'filteredByIgnore', label: 'Filtered by ignore file', value: count(s?.filteredByIgnore) },
      { key: 'sensitive', label: 'Sensitive (excluded)', value: count(s?.sensitive) },
    ],
  };
}

export interface GapGroup {
  kind: string;
  records: Gap[];
  total: number;
}

/** Gaps grouped by kind (first-seen order), optionally filtered to one scope. */
export function groupGaps(gaps: Gap[], scope: string | null): { scopes: string[]; groups: GapGroup[] } {
  const scopes = [...new Set(gaps.map(scopeOf))].sort();
  const groups = new Map<string, GapGroup>();
  for (const gap of gaps) {
    if (scope !== null && scopeOf(gap) !== scope) continue;
    const kind = typeof gap.kind === 'string' ? gap.kind : '(no kind)';
    const group = groups.get(kind) ?? { kind, records: [], total: 0 };
    group.records.push(gap);
    group.total += count(gap.count) ?? 0;
    groups.set(kind, group);
  }
  return { scopes, groups: [...groups.values()] };
}

export function scopeOf(gap: Gap): string {
  return typeof gap.scope === 'string' ? gap.scope : '(no scope)';
}

/** Non-selected selection entries (the bake already dropped the selected ones). */
export function excludedEntries(selection: SelectionFunnel | null | undefined): SelectionEntry[] {
  return Array.isArray(selection?.entries) ? selection.entries.filter((e) => e?.kind !== 'selected') : [];
}
