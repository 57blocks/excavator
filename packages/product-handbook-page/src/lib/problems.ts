import type { Group } from './groups';
import type { ProblemFilters } from './route';
import type { Text } from './text';
import type { DesignText, ProblemLevel, ProblemRow, ProblemType, View } from './types';

/** The types in the order the problems page lists them. */
export const PROBLEM_TYPES: readonly ProblemType[] = ['defect', 'design', 'open'];

/** The levels of each type, strongest first; a defect's are P0 to P2, a design problem's are its impact. */
export const LEVELS: Record<ProblemType, readonly ProblemLevel[]> = { defect: ['P0', 'P1', 'P2'], design: ['high', 'medium', 'low'], open: [] };

/** Every level a filter can name, in the order of the list: the defects' first, then the design problems'. */
export const ALL_LEVELS: readonly ProblemLevel[] = [...LEVELS.defect, ...LEVELS.design];

/** The type a level belongs to: P0 to P2 are defects', the impacts are design problems'. */
export const typeOfLevel = (level: string): ProblemType | null => (LEVELS.defect.includes(level as ProblemLevel) ? 'defect' : LEVELS.design.includes(level as ProblemLevel) ? 'design' : null);

/** The default order: by type, then by level (never mixing the P levels with the impacts), then the order of the rows; a stable sort. */
export function sortRows(rows: readonly ProblemRow[]): ProblemRow[] {
  const rank = (row: ProblemRow): [number, number] => [PROBLEM_TYPES.indexOf(row.type), row.level === null ? 0 : LEVELS[row.type].indexOf(row.level)];
  return rows
    .map((row, at) => ({ row, at, key: rank(row) }))
    .sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.at - b.at)
    .map((entry) => entry.row);
}

/** The text of a row in `view` as one string: a design row's situation and consequence joined. */
export function textOfRow(row: ProblemRow, view: View): string {
  const text = row.texts[view];
  if (text === undefined) return '';
  return typeof text === 'string' ? text : `${(text as DesignText).situation}\n${(text as DesignText).consequence}`;
}

/**
 * The rows that pass the filters. `domain`: any of the row's features is in that group; `feature`: the row names it;
 * `type` and `level`: equal; `q`: a case-insensitive substring of the summary or of the row's text in `view`.
 */
export function filterRows(rows: readonly ProblemRow[], filters: ProblemFilters, groups: readonly Group[], view: View): ProblemRow[] {
  const domain = filters.domain === undefined ? null : new Set(groups.find((group) => group.id === filters.domain)?.features.map((item) => item.block) ?? []);
  const needle = filters.q?.trim().toLowerCase() ?? '';
  return rows.filter((row) => {
    if (domain !== null && !row.features.some((id) => domain.has(id))) return false;
    if (filters.feature !== undefined && !row.features.includes(filters.feature)) return false;
    if (filters.type !== undefined && row.type !== filters.type) return false;
    if (filters.level !== undefined && row.level !== filters.level) return false;
    if (needle !== '' && !row.summary.toLowerCase().includes(needle) && !textOfRow(row, view).toLowerCase().includes(needle)) return false;
    return true;
  });
}

/** The count of the rows of `type` at each level of it (an open question has none), and the total. */
export function countRows(rows: readonly ProblemRow[], type: ProblemType): { total: number; byLevel: { level: ProblemLevel; count: number }[] } {
  const own = rows.filter((row) => row.type === type);
  return { total: own.length, byLevel: LEVELS[type].map((level) => ({ level, count: own.filter((row) => row.level === level).length })) };
}

/** The rows that concern feature `id` (the chapter id, or `system`), in their original order: the one predicate of every count and list of a feature. */
export const rowsOfFeature = (rows: readonly ProblemRow[], id: string): ProblemRow[] => rows.filter((row) => row.features.includes(id));

/** The text of a level: P0 to P2 as they are, an impact by its fixed text. */
export const levelText = (t: Text, level: string): string => (typeOfLevel(level) === 'design' ? t(`chapter.review.impact.${level}`) : level);

/** The strongest defect level (P0 over P1 over P2) and the strongest design impact (high over medium over low) among the rows of feature `id`; null for a type with none. Points to confirm have no level. */
export function highestLevels(rows: readonly ProblemRow[], id: string): { defect: ProblemLevel | null; design: ProblemLevel | null } {
  const own = rowsOfFeature(rows, id);
  const top = (type: 'defect' | 'design'): ProblemLevel | null => LEVELS[type].find((level) => own.some((row) => row.type === type && row.level === level)) ?? null;
  return { defect: top('defect'), design: top('design') };
}
