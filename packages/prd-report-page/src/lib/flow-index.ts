import { featureHash } from './route';
import type { Feature } from './types';

/** One row of the overview's flow index (openspec change prd-report-prd-shape, design D4 and D10). */
export interface FlowIndexRow {
  /** The feature id for a reference feature, `<id>.<n>` for the n-th flow of another feature. */
  number: string;
  flow: string;
  /** `<id> <name>`, as the PRD's table writes it. */
  feature: string;
  featureId: string;
  kind: string;
  /** The page of the feature; never a heading anchor, which the fragment router would take for a route. */
  href: string;
}

/** The statuses that have a chapter; the same two `aggregate` counts as written. */
const WRITTEN = ['checked', 'verified'];

const idNumber = (id: string): number => Number(id.slice(1));
const inChapterOrder = (a: Feature, b: Feature): number => a.chapter - b.chapter || idNumber(a.id) - idNumber(b.id);

/**
 * The flow index of the written features, in chapter order: a row for each
 * reference feature (named by the feature) and a row for each flow of every
 * other feature. Built from the page data, so it needs no anchor of the PRD.
 */
export function flowIndexRows(features: readonly Feature[]): FlowIndexRow[] {
  const rows: FlowIndexRow[] = [];
  for (const feature of features.filter((item) => WRITTEN.includes(item.status)).sort(inChapterOrder)) {
    const common = { feature: `${feature.id} ${feature.name}`, featureId: feature.id, kind: feature.kind, href: featureHash(feature.id) };
    if (feature.kind === 'reference') rows.push({ number: feature.id, flow: feature.name, ...common });
    else feature.flows.forEach((flow, at) => rows.push({ number: `${feature.id}.${at + 1}`, flow, ...common }));
  }
  return rows;
}
