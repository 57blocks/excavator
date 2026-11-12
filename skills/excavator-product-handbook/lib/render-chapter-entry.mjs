/**
 * The body of a checked /3 entry in handbook.md (openspec change handbook-free-chapter, D0, D7, D12): the fixed not-verified mark, the
 * chapter as the writer wrote it (the product view without its citations and `%%` lines, the technical view as written), and the
 * quick reference of the fact sheet: purpose, who, where, screens by name, hand-overs, states, notifications, automatic behaviour
 * and what is undetermined. The feature heading and its facts lines are the caller's.
 */

import { noteCounts, productChapter } from './chapter-output.mjs';
import { renderChapter } from './chapter-render.mjs';
import { inline } from './markdown.mjs';
import { automaticLines, notificationsLines, statesLines, unknownsLines, whereLines, whoLines } from './render-sheet.mjs';
import { shiftHeadings } from './render-outline.mjs';
import { fill } from './ui.mjs';

/** The quick reference: the sections the fact sheet has, one level below the chapter's own headings. */
function quickReference(entry, names, t) {
  const out = [`#### ${t('md.section.factSheet')}`, ''];
  const sections = [];
  if (entry.purpose !== undefined) sections.push([`#### ${t('md.section.purpose')}`, '', inline(entry.purpose.text), '']);
  sections.push(whoLines(entry, t), whereLines(entry, t));
  sections.push([`#### ${t('md.section.screens')}`, '', ...(entry.screens.length === 0 ? [t('md.none')] : entry.screens.map((screen) => `- ${inline(fill(t('md.screen.heading'), { name: screen.name }))}`)), '']);
  sections.push([`#### ${t('md.operation.handoffs')}`, '', ...(entry.handoffs.length === 0 ? [t('md.none')] : entry.handoffs.map((handoff) => `- ${inline(fill(t('md.handoff.item'), { feature: names.get(handoff.feature) ?? handoff.feature, text: handoff.text }))}`)), '']);
  sections.push(statesLines(entry, t), notificationsLines(entry, t), automaticLines(entry, t), unknownsLines(entry, t));
  for (const lines of sections) out.push(...shiftHeadings(lines, 1));
  return out;
}

/** The lines after the heading of a /3 feature's section; `chapter` is `{ text }`, `names` the feature names by id. */
export function chapterBody({ entry, chapter, names, t, technical }) {
  const text = technical ? renderChapter(chapter.text, []) : productChapter(chapter.text);
  return [inline(t('md.feature.unverified')), '', ...shiftHeadings(text.trimEnd().split('\n'), 3), '', ...quickReference(entry, names, t)];
}

/** The part of the coverage section for the features written but not verified: their number, and for each the count of every kind of content note. Nothing when there is none. */
export function unverifiedCoverage(map, chapters, t) {
  const features = map.features.filter((feature) => chapters.has(feature.id));
  if (features.length === 0) return [];
  const out = [`### ${t('md.coverage.unverifiedHeading')}`, '', fill(t('md.coverage.unverifiedCount'), { count: features.length, total: map.features.length }), ''];
  for (const feature of features) {
    out.push(`- ${inline(fill(t('md.coverage.unverifiedItem'), { id: feature.id, name: feature.name, ...noteCounts(chapters.get(feature.id).notes) }))}`);
  }
  out.push('');
  return out;
}
