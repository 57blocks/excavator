import { findingsHash } from './route';
import type { PriorityFilter } from './route';
import type { Feature, Finding } from './types';

/** The levels of the page in display order; `unranked` is a finding whose priority is null. */
export const LEVELS = ['P0', 'P1', 'P2', 'unranked'] as const;
export type Level = (typeof LEVELS)[number];

export const LEVEL_LABELS: Record<Level, string> = { P0: 'P0', P1: 'P1', P2: 'P2', unranked: 'Unranked' };

export const levelOf = (finding: Finding): Level => finding.priority ?? 'unranked';

export type LevelCounts = Record<Level, number>;

/** Findings per owning feature id and level, counted from `findings`. */
export function levelCountsByFeature(findings: readonly Finding[]): Map<string, LevelCounts> {
  const counts = new Map<string, LevelCounts>();
  for (const finding of findings) {
    const row = counts.get(finding.feature) ?? { P0: 0, P1: 0, P2: 0, unranked: 0 };
    row[levelOf(finding)] += 1;
    counts.set(finding.feature, row);
  }
  return counts;
}

export interface MatrixCell {
  level: Level;
  count: number;
  /** The findings page filtered to this feature and level; null for a zero cell. */
  href: string | null;
}

export interface MatrixRow {
  feature: Feature;
  total: number;
  cells: MatrixCell[];
}

/**
 * One row per feature, in the order given: its findings counted per level from
 * `findings`, so the cells of a row sum to the feature's findings and all rows
 * sum to the findings. A non-zero cell links to the findings page filtered by
 * that feature and level.
 */
export function featureMatrix(features: readonly Feature[], findings: readonly Finding[]): MatrixRow[] {
  const counts = levelCountsByFeature(findings);
  return features.map((feature) => {
    const row = counts.get(feature.id) ?? { P0: 0, P1: 0, P2: 0, unranked: 0 };
    const cells = LEVELS.map((level): MatrixCell => ({
      level,
      count: row[level],
      href: row[level] === 0 ? null : findingsHash({ feature: feature.id, priority: level as PriorityFilter }),
    }));
    return { feature, total: cells.reduce((sum, cell) => sum + cell.count, 0), cells };
  });
}

/** Whether any feature has an unranked finding; the matrix leaves the column out when none does. */
export const hasUnranked = (rows: readonly MatrixRow[]): boolean => rows.some((row) => row.cells.some((cell) => cell.level === 'unranked' && cell.count > 0));

export interface LevelGroup {
  level: Level;
  label: string;
  findings: Finding[];
}

/** The list cut into runs of one level, in the order given: a heading goes where the level changes. */
export function groupByLevel(findings: readonly Finding[]): LevelGroup[] {
  const groups: LevelGroup[] = [];
  for (const finding of findings) {
    const level = levelOf(finding);
    const last = groups[groups.length - 1];
    if (last !== undefined && last.level === level) last.findings.push(finding);
    else groups.push({ level, label: LEVEL_LABELS[level], findings: [finding] });
  }
  return groups;
}
