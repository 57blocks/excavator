import { STATUSES } from './types';
import type { Feature, Finding, PageData, Status } from './types';

/** Findings per owning feature id, from findings.json. */
export function findingsByFeature(findings: readonly Finding[]): Map<string, Finding[]> {
  const byFeature = new Map<string, Finding[]>();
  for (const finding of findings) byFeature.set(finding.feature, [...(byFeature.get(finding.feature) ?? []), finding]);
  return byFeature;
}

/** The number of features in each status, in the page's status order, all five listed. */
export function statusCounts(features: readonly Feature[]): Record<Status, number> {
  const counts = Object.fromEntries(STATUSES.map((status) => [status, 0])) as Record<Status, number>;
  for (const feature of features) counts[feature.status] += 1;
  return counts;
}

export const featureById = (data: PageData, id: string): Feature | undefined => data.features.find((feature) => feature.id === id);
