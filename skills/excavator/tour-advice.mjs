/**
 * tour-advice.mjs
 *
 * The advisory-wording check of a tour's prose (openspec: changes/tour-product,
 * capability `learning-tour`, requirement "tour structure", design D3/D4). A tour
 * says what the code does; it does not say what to change. `check` runs this on
 * the draft before any verification, and `report` runs it again on the product and
 * prints the number of lines it hits.
 *
 * Words come per language. The English list always applies, matched as whole words
 * or whole phrases, case-insensitively, so "shoulder" is not a hit. The Chinese list
 * applies when the content language is `zh` (or `zh-...`); Chinese has no word
 * boundaries, so its entries match as substrings. Its entries are written as code
 * points, so this file holds no Chinese character. Text inside backticks is code
 * and is not checked: a function named `recommend` is not advice.
 *
 * A "line" is one unit of text: a title, or one sentence of a description or a
 * language lesson, with the id `<order>.d<n>` / `<order>.l<n>` the verifier uses.
 */

import { splitSentences } from './tour-sentences.mjs';

const text = (...codePoints) => String.fromCharCode(...codePoints);

const ENGLISH = [
  'should', 'recommend', 'recommends', 'recommended', 'consider', 'better to', 'ought to', 'needs to be improved',
  'we suggest', 'you may want', 'it is advisable', 'best practice', 'best practices',
];
const CHINESE = [
  text(0x5efa, 0x8bae),
  text(0x5e94, 0x8be5),
  text(0x5e94, 0x5f53),
  text(0x6700, 0x597d),
  text(0x63a8, 0x8350),
  text(0x9700, 0x8981, 0x6539, 0x8fdb),
  text(0x4e0d, 0x59a8),
  text(0x53ef, 0x4ee5, 0x8003, 0x8651),
];
const ENGLISH_PATTERN = new RegExp(`\\b(?:${ENGLISH.map((term) => term.replace(/ /g, '\\s+')).join('|')})\\b`, 'i');

/** The advisory terms found in `value`, outside backtick spans; `language` is the draft's contentLanguage. */
export function adviceTerms(value, language) {
  const prose = String(value ?? '').replace(/`[^`]*`/g, ' ');
  const found = [];
  const english = ENGLISH_PATTERN.exec(prose);
  if (english) found.push(english[0].toLowerCase().replace(/\s+/g, ' '));
  if (typeof language === 'string' && /^zh(?:$|[-_])/i.test(language)) {
    for (const term of CHINESE) if (prose.includes(term)) found.push(term);
  }
  return found;
}

/**
 * Every line of `steps` that uses advisory wording: [{ step, id, terms }], with `id` the sentence id or `title`.
 * @param {{ order: number, title?: string, description?: string, languageLesson?: string }[]} steps
 */
export function findAdvice(steps, language) {
  const hits = [];
  for (const step of steps) {
    const units = [['title', step.title]];
    if (typeof step.description === 'string') splitSentences(step.description).forEach((sentence, i) => units.push([`${step.order}.d${i + 1}`, sentence]));
    if (typeof step.languageLesson === 'string') splitSentences(step.languageLesson).forEach((sentence, i) => units.push([`${step.order}.l${i + 1}`, sentence]));
    for (const [id, value] of units) {
      const terms = adviceTerms(value, language);
      if (terms.length > 0) hits.push({ step: step.order, id, terms });
    }
  }
  return hits;
}
