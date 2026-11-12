/**
 * The common cause and the measure of a category in the Findings chapter
 * (openspec change handbook-remedies, design D6): two paragraphs under the
 * category's heading, before its groups, when the remedies hold them for it
 * (remedies-model.mjs). Nothing for a category without them. Pure.
 */

import { inline } from './markdown.mjs';
import { fill } from './ui.mjs';

/** The lines to write under the heading of `category`: its cause and its measure, each a paragraph, or nothing. */
export function categoryRemedyLines(category, remedies, t) {
  const own = remedies?.categories.find((entry) => entry.category === category);
  if (own === undefined) return [];
  return [fill(t('md.remedies.cause'), { text: inline(own.cause) }), '', fill(t('md.remedies.measure'), { text: inline(own.measure) }), ''];
}
