/**
 * `handbook.mjs select <out> --features <list> --project <root>` (design D9):
 * resolve the `--features` list of a run to feature ids. The ids of a map are
 * only known once the map is written, so each item of the list is either an
 * id (exact) or a feature name (equal ignoring case and surrounding white
 * space). The map is checked again first. Every item must match exactly one
 * feature; there is no fuzzy matching, because selecting the wrong feature is
 * worse than stopping. It changes no file: a feature that is not selected
 * simply stays planned in state.json, which assemble lists as not written.
 */

import { UsageError } from './errors.mjs';
import { loadCheckedMap } from './check-map.mjs';

/** The stop line of a failed selection: the orchestrator ends the run here. */
export const SELECT_NEXT = 'Next: stop the run; report the lines above to the user and dispatch no lane';

const fold = (text) => text.trim().toLowerCase();

/** The items of a comma-separated list, trimmed; an empty list or item is a usage error. */
export function parseFeatureList(list) {
  const items = String(list).split(',').map((item) => item.trim());
  if (items.some((item) => item === '')) throw new UsageError('--features needs a comma-separated list with no empty item (for example F2 or "Orders, F3")');
  return items;
}

/** Returns { status, lines }: the selected ids in map order, or every problem, every feature and the stop line. */
export function selectFeatures(outDir, root, list) {
  const items = parseFeatureList(list);
  const loaded = loadCheckedMap(outDir, root);
  if (!loaded.ok) return { status: 1, lines: loaded.lines };
  const { features } = loaded.map;
  const problems = [];
  const selected = new Set();
  for (const item of items) {
    const hits = features.filter((feature) => feature.id === item || fold(feature.name) === fold(item));
    if (hits.length === 1) selected.add(hits[0].id);
    else if (hits.length === 0) problems.push(`${JSON.stringify(item)}: matches no feature id or name`);
    else problems.push(`${JSON.stringify(item)}: matches ${hits.length} features (${hits.map((feature) => feature.id).join(', ')}); use an id`);
  }
  if (problems.length > 0) {
    return { status: 1, lines: [...problems, ...features.map((feature) => `${feature.id}  ${feature.name}`), SELECT_NEXT] };
  }
  return { status: 0, lines: features.filter((feature) => selected.has(feature.id)).map((feature) => feature.id) };
}
