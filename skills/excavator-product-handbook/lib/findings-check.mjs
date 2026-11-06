/**
 * The checks of a findings file (openspec change handbook-feature-findings):
 * the shape, the id, and the checks an entry gets (review.mjs: citations,
 * numbers, banned words, narrative language), plus one more, the advice-word
 * check: a statement says what the code does and when, never what to change,
 * so it may not hold a word of the list in the run's fixed-text table
 * (`md.findings.adviceWords`; the matching is in word-lists.mjs).
 */

import { findingsItems } from './findings-items.mjs';
import { findingsShapeProblems } from './findings-shape.mjs';
import { reviewItems } from './review.mjs';
import { wordsIn } from './word-lists.mjs';

export { adviceWordsOf, scopeWordsOf, wordsIn } from './word-lists.mjs';

/** The first advice word `text` holds, in the order of the list, or null. */
export const adviceWordIn = (text, words) => wordsIn(text, words)[0] ?? null;

/** Every way a parsed findings file fails when checked as the unit `id`; `adviceWords` is the list of the run's table. */
export function findingsProblems(doc, id, { files, memberDirs, mapLabels, languageCheck = null, adviceWords = [] }) {
  const shape = findingsShapeProblems(doc);
  if (shape.length > 0) return shape;
  const problems = [];
  if (doc.id !== id) problems.push(`id: ${JSON.stringify(doc.id)} is not ${JSON.stringify(id)}, the feature this entry is checked as`);
  problems.push(...reviewItems(findingsItems(doc), { files, memberDirs, exemptLabels: mapLabels, languageCheck }).problems);
  doc.findings.forEach((finding, i) => {
    const word = adviceWordIn(finding.text, adviceWords);
    if (word !== null) problems.push(`findings[${i}].text: ${JSON.stringify(word)} is a word of advice; write the defect and when it happens, not what to change`);
  });
  return problems;
}
