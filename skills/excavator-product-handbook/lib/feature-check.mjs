/**
 * The checks of a feature entry against the map and the project (design D5 to
 * D9 of product-handbook-map): shape, id, roles from the map, then the
 * citation, label, number, banned-words and narrative-language checks of every
 * item. The system overview has its own (overview-check.mjs); unit.mjs picks.
 */

import { OPERATION_PARTS, partList } from './entry-parts.mjs';
import { ENTRY_FORMAT, ENTRY_FORMAT_V1, ENTRY_FORMAT_V3, entryShapeProblems } from './entry-shape.mjs';
import { entryItems } from './items.mjs';
import { reviewItems } from './review.mjs';

/**
 * A new entry is /3 (openspec change handbook-free-chapter D10); /2 and /1 are read only, to assemble what was
 * verified before. A /2 file that is not a settled one is refused here. Tests that build /2 runs set this variable,
 * as lock.mjs has its own for the lock wait; the skill never sets it.
 */
const LEGACY_VARIABLE = 'EXCAVATOR_HANDBOOK_ALLOW_V2_ENTRY';
const legacyAllowed = () => process.env[LEGACY_VARIABLE] === '1';

const HANDOFFS = OPERATION_PARTS.find((part) => part.key === 'handoffs');

/**
 * Every way a parsed entry fails, given the map's roles and map-wide verified
 * labels. `settled` is for an entry that verdicts round 2 has trimmed (design
 * D14): its purpose may be absent. A written entry (check-entry, try-entry)
 * is never settled, so its purpose stays required.
 */
export function entryProblems(entry, id, { map, files, memberDirs, mapLabels, languageCheck = null }, { settled = false } = {}) {
  if (!settled && (entry?.format === ENTRY_FORMAT_V1 || (entry?.format === ENTRY_FORMAT && !legacyAllowed()))) {
    return [`format: ${JSON.stringify(entry.format)} is not accepted; ${JSON.stringify(ENTRY_FORMAT_V3)} is the format of a new entry (the fact sheet, with the chapter in chapters/${id}.md): new entries use /3`];
  }
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
  const handoffProblem = (handoff, at) => {
    if (handoff.feature === id) problems.push(`${at}: ${JSON.stringify(handoff.feature)} is this feature itself; a handoff names another feature of the map`);
    else if (!featureIds.includes(handoff.feature)) problems.push(`${at}: ${JSON.stringify(handoff.feature)} is not a feature in map.json (features: ${featureIds.map((f) => JSON.stringify(f)).join(', ')})`);
  };
  (entry.operations ?? []).forEach((operation, i) => {
    partList(operation, HANDOFFS).forEach((handoff, j) => handoffProblem(handoff, `operations[${i}].handoffs[${j}].feature`));
  });
  (entry.handoffs ?? []).forEach((handoff, j) => handoffProblem(handoff, `handoffs[${j}].feature`));
  problems.push(...reviewItems(entryItems(entry), { files, memberDirs, exemptLabels: mapLabels, languageCheck }).problems);
  return problems;
}
