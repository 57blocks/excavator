/**
 * The source positions of the technical view (openspec change
 * handbook-entities-and-views, design D3): for each verified unit, each item
 * that carries evidence with its claim (claims.mjs, so it reads the way the
 * verifiers read it) and, for each of its citations, the file and the first and
 * last line the passage covers. The range comes from the citation locator
 * (citation-locator.mjs), which is the function the citation check's
 * normalization defines. A citation that cannot be located (the file changed
 * since it was checked) is listed with null lines, never dropped.
 * Features follow the map's order; the system overview comes last.
 */

import { citationLocator } from './citation-locator.mjs';
import { OVERVIEW_ID, unitFor } from './unit.mjs';

/** `[{ id, items: [{ claim, citations: [{ file, startLine, endLine }] }] }]` for the verified units of `run` (`{ map, entries, ui }`) over the project at `root`. */
export function buildLocations(run, root) {
  const { map, entries, ui } = run;
  const locate = citationLocator(root);
  const ids = [...map.features.map((feature) => feature.id), OVERVIEW_ID].filter((id) => entries.has(id));
  return ids.map((id) => {
    const entry = entries.get(id);
    const unit = unitFor(id);
    const claims = unit.claims(entry, ui, { map });
    const items = unit.items(entry)
      .filter((item) => item.evidence.length > 0)
      .map((item) => ({
        claim: claims.get(item.path) ?? item.path,
        citations: item.evidence.map((citation) => {
          const found = locate(citation);
          return { file: citation.file, startLine: found?.startLine ?? null, endLine: found?.endLine ?? null };
        }),
      }));
    return { id, items };
  });
}
