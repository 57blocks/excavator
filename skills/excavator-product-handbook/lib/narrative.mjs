/**
 * The text test of the language check (design D12, language-check.mjs holds
 * the mode): in a run in a language with its own script, a narrative text a
 * model wrote must hold at least one letter outside ASCII. Text with no ASCII
 * letter left once the verified labels are taken out (only digits,
 * punctuation, spaces) is exempt: it says nothing that has a language.
 */

import { withoutLabels } from './banned-words.mjs';

const ASCII_LETTER = /[A-Za-z]/;
export const NON_ASCII_LETTER = /(?![\x00-\x7F])\p{L}/u;

/** The problem of one narrative text (without its path), or null. */
export function narrativeProblem(text, labels, language) {
  const rest = withoutLabels(text, labels);
  if (!ASCII_LETTER.test(rest) || NON_ASCII_LETTER.test(rest)) return null;
  return `written only in ASCII letters; the run's language is ${language}; write it in that language (labels quoted from the source stay as they are)`;
}
