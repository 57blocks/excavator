/**
 * The batches of the design-problems section (openspec change handbook-design-review, D4): one batch per
 * business domain when the domains chapter passed and domains.json exists, else one per area of the map,
 * numbered b1..bn in that order, then the cross batch for what spans batches. Pure over map.json,
 * domains.json and state.json.
 */

import { join } from 'node:path';

import { readJson } from './json-file.mjs';
import { loadStateV2 } from './state-v2.mjs';

export const CROSS_BATCH = 'cross';
export const FACTS_FILE = 'entries/review-facts.json';
export const FACTS_FORMAT = 'excavator-product-handbook-review-facts/1';

/** `{ ok: true, source, batches: [{ id, name, features }] }` (the cross batch last, with no features of its own) or `{ ok: false, lines }`. */
export function reviewBatches(outDir) {
  const map = readJson(join(outDir, 'map.json'));
  if (!map.ok || !Array.isArray(map.value?.features)) return { ok: false, lines: ['map.json is missing or has no features; write and check the map first'] };
  const ids = map.value.features.map((feature) => feature.id);
  const loaded = loadStateV2(outDir);
  if (!loaded.ok) return { ok: false, lines: [loaded.line] };
  let source = 'areas';
  let groups = null;
  const record = loaded.state.chapters.domains;
  if (record !== undefined && record.status === 'passed') {
    const domains = readJson(join(outDir, 'domains.json'));
    if (domains.ok && Array.isArray(domains.value?.domains)) {
      groups = domains.value.domains
        .filter((domain) => Array.isArray(domain.features))
        .map((domain) => ({ name: String(domain.name), features: domain.features.filter((id) => ids.includes(id)) }));
      source = 'domains';
    }
  }
  if (groups === null) {
    const areas = Array.isArray(map.value.areas) ? map.value.areas : [];
    groups = areas.map((area) => ({ name: String(area.name), features: map.value.features.filter((feature) => feature.area === area.id).map((feature) => feature.id) }));
  }
  const batches = groups.filter((group) => group.features.length > 0).map((group, at) => ({ id: `b${at + 1}`, name: group.name, features: group.features }));
  batches.push({ id: CROSS_BATCH, name: CROSS_BATCH, features: [] });
  return { ok: true, source, batches, map: map.value };
}
