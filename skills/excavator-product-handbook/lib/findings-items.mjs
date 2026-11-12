/**
 * The items and the claims of a findings unit (openspec change
 * handbook-feature-findings), in the shapes items.mjs and claims.mjs give for a
 * feature entry, so the review, the verifiers and the tracers treat the three
 * kinds of unit the same way. An item is a finding that carries evidence, named
 * by its JSON path (`findings[0]`); its statement is narrative text a model
 * wrote, so its numbers must occur in its own citations. The category is an
 * enum, not reader text. `unknowns` say what is not known: no evidence, no
 * number check.
 */

import { categoryKey } from './findings-shape.mjs';
import { itemOf, textOf } from './items.mjs';
import { scopeWordsOf, wordsIn } from './word-lists.mjs';

const SEP = ' > ';

/** The items of a findings file that passed the shape check. */
export function findingsItems(doc) {
  const items = [];
  doc.findings.forEach((finding, i) => {
    items.push(itemOf(`findings[${i}]`, [textOf(`findings[${i}].text`, finding.text, { narrative: true })], finding.evidence));
  });
  doc.unknowns.forEach((entry, i) => {
    const path = `unknowns[${i}]`;
    items.push(itemOf(path, [textOf(`${path}.item`, entry.item, { numbers: false, narrative: true }), textOf(`${path}.searched`, entry.searched, { numbers: false, narrative: true })], undefined));
  });
  return items;
}

/**
 * A Map from item path to claim for every finding: the fixed word, the category's display name and the statement.
 * `labelKey` is the fixed-text key of the word: a system finding (openspec change handbook-system-findings) has its own.
 */
export function findingsClaims(doc, ui, labelKey = 'md.findings.claimLabel') {
  const t = (key) => {
    if (!Object.hasOwn(ui, key)) throw new Error(`the fixed-text table has no key ${key}`);
    return ui[key];
  };
  const claims = new Map();
  doc.findings.forEach((finding, i) => claims.set(`findings[${i}]`, [t(labelKey), t(categoryKey(finding.category)), finding.text].join(SEP)));
  return claims;
}

/** The claims of the findings of a system unit: the same, with the fixed word of a system finding. */
export const systemFindingsClaims = (doc, ui) => findingsClaims(doc, ui, 'md.findings.systemClaimLabel');

/** Remove the findings of the path set `removed`; nothing hangs on a finding, so nothing goes with them. Returns `{ entry, together }`. */
export function trimFindings(doc, removed) {
  const out = structuredClone(doc);
  out.findings = doc.findings.filter((_, i) => !removed.has(`findings[${i}]`));
  return { entry: out, together: [] };
}

/**
 * The scope words of one finding for its trace item (design D9 of the change):
 * the words of the run's table that its statement holds, in the order of the
 * table. The statement only, never the fixed words of the claim. `[]` for a
 * path that is not a finding.
 */
export function findingScopeWords(doc, path, ui) {
  const found = /^findings\[(\d+)\]$/.exec(path);
  if (found === null) return [];
  return wordsIn(doc.findings[Number(found[1])].text, scopeWordsOf(ui));
}
