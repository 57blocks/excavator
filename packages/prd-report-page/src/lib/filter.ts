import type { ClassFilter, FindingsFilters, PriorityFilter } from './route';
import type { Finding } from './types';

/**
 * The findings that pass `filters`: the class, the level (`unranked` is a null priority), the owning feature, and a
 * case-insensitive text search over the statement and every evidence passage.
 * The order of `findings` is kept.
 */
export function filterFindings(findings: readonly Finding[], filters: FindingsFilters): Finding[] {
  const needle = filters.q.trim().toLowerCase();
  return findings.filter((finding) => {
    if (filters.class !== 'all' && finding.class !== filters.class) return false;
    if (filters.priority !== 'all' && (finding.priority ?? 'unranked') !== filters.priority) return false;
    if (filters.feature !== '' && finding.feature !== filters.feature) return false;
    if (needle === '') return true;
    if (finding.statement.toLowerCase().includes(needle)) return true;
    return finding.evidence.some((item) => item.passage.toLowerCase().includes(needle));
  });
}

export interface FacetCounts {
  class: Record<ClassFilter, number>;
  priority: Record<PriorityFilter, number>;
}

/**
 * The number each segment of the class and level controls shows: the findings
 * that pass every filter except the control's own, so a segment says how many
 * findings clicking it would show.
 */
export function facetCounts(findings: readonly Finding[], filters: FindingsFilters): FacetCounts {
  const underClass = filterFindings(findings, { ...filters, class: 'all' });
  const underPriority = filterFindings(findings, { ...filters, priority: 'all' });
  const level = (finding: Finding) => finding.priority ?? 'unranked';
  return {
    class: {
      all: underClass.length,
      product: underClass.filter((finding) => finding.class === 'product').length,
      technical: underClass.filter((finding) => finding.class === 'technical').length,
    },
    priority: {
      all: underPriority.length,
      P0: underPriority.filter((finding) => level(finding) === 'P0').length,
      P1: underPriority.filter((finding) => level(finding) === 'P1').length,
      P2: underPriority.filter((finding) => level(finding) === 'P2').length,
      unranked: underPriority.filter((finding) => level(finding) === 'unranked').length,
    },
  };
}

/** The `file:line` of one evidence item; a missing line gives the file alone. */
export function evidenceLocation(item: { file: string; line?: number }): string {
  return item.line === undefined ? item.file : `${item.file}:${item.line}`;
}

/** A source revision as the sidebar shows it: a full git hash is cut to 8 characters. */
export function shortRevision(revision: string): string {
  if (/^[0-9a-f]{40}$/.test(revision)) return revision.slice(0, 8);
  return revision.length > 28 ? `${revision.slice(0, 27)}...` : revision;
}
