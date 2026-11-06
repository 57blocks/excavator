/**
 * The checks of a findings file (openspec change handbook-feature-findings):
 * the shape, the id, and the checks an entry gets (review.mjs: citations,
 * numbers, banned words, narrative language), plus one more, the advice-word
 * check: a statement says what the code does and when, never what to change,
 * so it may not hold a word of the list in the run's fixed-text table
 * (`md.findings.adviceWords`, comma-separated, translated with the rest of the
 * table). A word written only in ASCII is matched as a whole word ignoring
 * case; a word with a letter outside ASCII (a language with its own script) is
 * matched as a substring ignoring case, since such text has no spaces to split on.
 */

import { findingsItems } from './findings-items.mjs';
import { findingsShapeProblems } from './findings-shape.mjs';
import { reviewItems } from './review.mjs';

const ASCII_ONLY = /^[\x20-\x7e]+$/;
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The advice words of the run's table, as a list. */
export function adviceWordsOf(ui) {
  const raw = Object.hasOwn(ui, 'md.findings.adviceWords') ? ui['md.findings.adviceWords'] : '';
  return raw.split(',').map((word) => word.trim()).filter((word) => word !== '');
}

/** The first advice word `text` holds, in the order of the list, or null. */
export function adviceWordIn(text, words) {
  const lower = text.toLowerCase();
  for (const word of words) {
    const needle = word.toLowerCase();
    const found = ASCII_ONLY.test(word)
      ? new RegExp(`(?<![A-Za-z])${escapeRegex(needle)}(?![A-Za-z])`).test(lower)
      : lower.includes(needle);
    if (found) return word;
  }
  return null;
}

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
