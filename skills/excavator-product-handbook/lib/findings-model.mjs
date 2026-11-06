/**
 * The verified findings of a loaded run as the outputs write them (openspec
 * change handbook-feature-findings): one row per finding of each verified
 * findings unit, in the map's feature order and then the file's order. A unit
 * that is not verified has no row, whatever its file holds. Both outputs build
 * it here, so the handbook and the page cannot differ. The technical view also
 * gets the file and lines of each finding's quoted passages, located with the
 * function the citation check defines (citation-locator.mjs); a passage that
 * cannot be located (the file changed since it was checked) is listed with null
 * lines, never dropped.
 */

import { citationLocator } from './citation-locator.mjs';
import { findingsId } from './findings-shape.mjs';

/** The status of the findings unit of feature `featureId`: planned when the state has no entry. */
export const findingsStatus = (state, featureId) => state.findings?.[featureId]?.status ?? 'planned';

/**
 * `{ list, locations }`: `list` is `[{ id, feature, category, text }]` (`id` is the
 * unit id and the item path, `F3.findings[0]`); `locations` maps each id to
 * `[{ file, startLine, endLine }]`, or is null unless `technical`.
 */
export function buildFindings(run, root, { technical }) {
  const locate = technical ? citationLocator(root) : null;
  const list = [];
  const locations = technical ? new Map() : null;
  for (const feature of run.map.features) {
    const doc = run.findings.get(feature.id);
    if (doc === undefined) continue;
    doc.findings.forEach((finding, index) => {
      const id = `${findingsId(feature.id)}[${index}]`;
      list.push({ id, feature: feature.id, category: finding.category, text: finding.text });
      if (technical) {
        locations.set(id, finding.evidence.map((citation) => {
          const found = locate(citation);
          return { file: citation.file, startLine: found?.startLine ?? null, endLine: found?.endLine ?? null };
        }));
      }
    });
  }
  return { list, locations };
}
