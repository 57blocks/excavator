import { byChapter } from './nav';
import { featureHash } from './route';
import type { Feature, Finding } from './types';

/** The most results the quick-jump dialog lists; the total number of matches is reported next to them. */
export const JUMP_LIMIT = 50;

export type JumpItem =
  | { type: 'feature'; feature: Feature }
  | { type: 'finding'; finding: Finding };

export interface JumpResult {
  items: JumpItem[];
  /** The number of matches before the cap. */
  total: number;
}

/** 0 = the id equals the query, 1 = the id starts with it, 2 = the name or statement contains it, -1 = no match. */
function rank(id: string, text: string, needle: string): number {
  const lower = id.toLowerCase();
  if (lower === needle) return 0;
  if (lower.startsWith(needle)) return 1;
  return text.toLowerCase().includes(needle) ? 2 : -1;
}

/**
 * The quick-jump matches of `query` (without case): features match on id and
 * name, findings on id and statement. They are ordered by how they match (id
 * equal, id prefix, then text contains) and, inside one rank, features before
 * findings, each in the order given. At most JUMP_LIMIT are listed. A blank
 * query lists the features in chapter order and no finding.
 */
export function matchJump(features: readonly Feature[], findings: readonly Finding[], query: string): JumpResult {
  const needle = query.trim().toLowerCase();
  if (needle === '') {
    const all = byChapter(features).map((feature): JumpItem => ({ type: 'feature', feature }));
    return { items: all.slice(0, JUMP_LIMIT), total: all.length };
  }
  const hits: { item: JumpItem; rank: number; order: number }[] = [];
  features.forEach((feature, at) => {
    const found = rank(feature.id, feature.name, needle);
    if (found >= 0) hits.push({ item: { type: 'feature', feature }, rank: found, order: at });
  });
  findings.forEach((finding, at) => {
    const found = rank(finding.id, finding.statement, needle);
    if (found >= 0) hits.push({ item: { type: 'finding', finding }, rank: found, order: features.length + at });
  });
  // `order` puts every feature before every finding, so features lead inside a rank.
  hits.sort((a, b) => a.rank - b.rank || a.order - b.order);
  return { items: hits.slice(0, JUMP_LIMIT).map((hit) => hit.item), total: hits.length };
}

/** The fragment a result opens: a feature's page, or its owning feature's page with the finding to scroll to. */
export const jumpHash = (item: JumpItem): string => (item.type === 'feature' ? featureHash(item.feature.id) : featureHash(item.finding.feature, item.finding.id));
