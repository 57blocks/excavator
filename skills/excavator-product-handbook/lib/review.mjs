/**
 * Runs the checks of design D6 to D8 over a map's or an entry's items:
 * citations, labels, numbers and the banned-words gate. Returns the problem
 * lines in item order (an item's citation, label and number problems first,
 * then its banned fragments) and the set of verified labels: a label that
 * occurs in its item's passages whose item's citations all resolve.
 * `exemptLabels` are labels verified elsewhere (the whole map's, when an
 * entry is reviewed); the banned-words gate exempts hits inside the item's
 * own document's verified labels and those. `languageCheck` (`{ language }`
 * or null, from `languageGate`) turns on the narrative language check, which
 * exempts the same labels.
 */

import { bannedFragments, outsideLabels } from './banned-words.mjs';
import { citationProblems } from './citations.mjs';
import { narrativeProblem } from './narrative.mjs';
import { labelOccurs, missingNumbers } from './values.mjs';

/** The files an item cites, for a problem line. */
const filesOf = (item) => [...new Set(item.evidence.map((entry) => entry.file))];
const where = (item) => item.source ?? (filesOf(item).length === 0 ? 'no evidence' : filesOf(item).join(', '));

export function reviewItems(items, { files, memberDirs, exemptLabels = new Set(), languageCheck = null }) {
  const verified = new Set();
  const lines = items.map(() => []);
  items.forEach((item, index) => {
    const citation = item.evidence.flatMap((entry) => citationProblems(files, entry));
    lines[index].push(...citation);
    for (const string of item.strings) {
      if (string.label) {
        if (!labelOccurs(string.text, item.passages)) {
          lines[index].push(`${string.path}: label ${JSON.stringify(string.text)} does not occur in this item's passages (${where(item)})`);
        } else if (citation.length === 0) {
          verified.add(string.text);
        }
      }
      if (string.numbers) {
        for (const number of missingNumbers(string.text, item.passages)) {
          lines[index].push(`${string.path}: number ${number} does not occur in this item's passages (${where(item)})`);
        }
      }
    }
  });
  const labels = new Set([...verified, ...exemptLabels]);
  items.forEach((item, index) => {
    for (const string of item.strings) {
      for (const hit of outsideLabels(bannedFragments(string.text, { memberDirs }), string.text, labels)) {
        lines[index].push(`${string.path}: ${JSON.stringify(hit.fragment)} is not allowed in reader text (${hit.category}); write it in plain words`);
      }
      const wrongLanguage = languageCheck !== null && string.narrative ? narrativeProblem(string.text, labels, languageCheck.language) : null;
      if (wrongLanguage !== null) lines[index].push(`${string.path}: ${wrongLanguage}`);
    }
  });
  return { problems: lines.flat(), verified };
}
