/**
 * The checks of a feature entry against the map and the project (design D5 to
 * D9 of product-handbook-map): shape, id, roles from the map, then the
 * citation, label, number, banned-words and narrative-language checks of every
 * item. The system overview has its own (overview-check.mjs); unit.mjs picks.
 */

import { OPERATION_PARTS, partList } from './entry-parts.mjs';
import { entryShapeProblems } from './entry-shape.mjs';
import { entryItems } from './items.mjs';
import { reviewItems } from './review.mjs';

const HANDOFFS = OPERATION_PARTS.find((part) => part.key === 'handoffs');

/**
 * Every way a parsed entry fails, given the map's roles and map-wide verified
 * labels. `settled` is for an entry that verdicts round 2 has trimmed (design
 * D14): its purpose may be absent. A written entry (check-entry, try-entry)
 * is never settled, so its purpose stays required.
 */
export function entryProblems(entry, id, { map, files, memberDirs, mapLabels, languageCheck = null }, { settled = false } = {}) {
  const shape = entryShapeProblems(entry, { settled });
  if (shape.length > 0) return shape;
  const problems = [];
  if (entry.id !== id) problems.push(`id: ${JSON.stringify(entry.id)} is not ${JSON.stringify(id)}, the feature this entry is checked as`);
  const roles = map.roles.map((role) => role.label);
  entry.who.forEach((who, i) => {
    if (!roles.includes(who.role)) problems.push(`who[${i}].role: ${JSON.stringify(who.role)} is not a role in map.json (roles: ${roles.map((r) => JSON.stringify(r)).join(', ') || 'none'})`);
  });
  // A handoff names another feature of the map (its id is not reader text, so the item checks skip it).
  const featureIds = map.features.map((feature) => feature.id);
  entry.operations.forEach((operation, i) => {
    partList(operation, HANDOFFS).forEach((handoff, j) => {
      const at = `operations[${i}].handoffs[${j}].feature`;
      if (handoff.feature === id) problems.push(`${at}: ${JSON.stringify(handoff.feature)} is this feature itself; a handoff names another feature of the map`);
      else if (!featureIds.includes(handoff.feature)) problems.push(`${at}: ${JSON.stringify(handoff.feature)} is not a feature in map.json (features: ${featureIds.map((f) => JSON.stringify(f)).join(', ')})`);
    });
  });
  problems.push(...reviewItems(entryItems(entry), { files, memberDirs, exemptLabels: mapLabels, languageCheck }).problems);
  return problems;
}
