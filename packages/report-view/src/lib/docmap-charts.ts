/**
 * What the Doc map page draws above its tables (openspec: changes/viewer-learn,
 * design D6): the units by lookup status, from the product's counts, and the
 * evidence by verdict, counted over the units joined to their checks. The
 * files of a unit's evidence are what the path filter reads.
 */

import type { BarRow } from '../components/ui/BarList';
import type { Bars } from './unused-related';
import type { UnitRow } from './docmap';

const LOOKUP: readonly (readonly [key: string, label: string, field: string])[] = [
  ['found', 'found', 'found'],
  ['not-found', 'not found', 'notFound'],
  ['not-checked', 'not checked', 'notChecked'],
];

/** The units by lookup status: `counts.found`, `counts.notFound` and `counts.notChecked`. */
export function lookupBars(counts: Record<string, unknown> | null | undefined): Bars {
  const rows: BarRow[] = [];
  const missing: string[] = [];
  for (const [key, label, field] of LOOKUP) {
    const value = counts?.[field];
    if (typeof value === 'number' && Number.isFinite(value)) rows.push({ key, label, value });
    else missing.push(label);
  }
  return { rows, missing };
}

/**
 * The evidence by the verdict of its check (does, not, none), the evidence that has no check (not checked), and,
 * when there is any, the evidence whose check has another verdict.
 */
export function verdictBars(rows: readonly UnitRow[]): BarRow[] {
  const total = { does: 0, not: 0, none: 0, unchecked: 0, other: 0 };
  for (const row of rows) {
    total.does += row.verdicts.does;
    total.not += row.verdicts.not;
    total.none += row.verdicts.none;
    total.unchecked += row.verdicts.unchecked;
    total.other += row.verdicts.other;
  }
  const bars: BarRow[] = [
    { key: 'does', label: 'does', value: total.does },
    { key: 'not', label: 'not', value: total.not },
    { key: 'none', label: 'none', value: total.none },
    { key: 'not checked', label: 'not checked', value: total.unchecked },
  ];
  if (total.other > 0) bars.push({ key: 'other', label: 'other verdict', value: total.other });
  return bars;
}

/** The distinct files of a unit's evidence, in the order they first appear. */
export function unitFiles(row: Pick<UnitRow, 'evidence'>): string[] {
  const files: string[] = [];
  for (const item of row.evidence) if (item.file !== null && !files.includes(item.file)) files.push(item.file);
  return files;
}
