/**
 * The coverage section, last in the handbook, with fixed text only: the candidate counts, the
 * unassigned candidates, the features reached only by a link, the features without a chapter, the
 * chapters that did not pass, the chapters across the features that were not written and which
 * outline was used. Computed from the map, the candidates, state.json and the file list.
 */

import { EXPECTED_CROSS_CHAPTERS } from './chapter-lint.mjs';
import { inline, table } from './markdown.mjs';
import { fill } from './ui.mjs';

/** The lines of the section; `chapters`: Map of the written chapter names, `outline`: outline-v2's result. */
export function coverageLines({ map, candidates, chapters, outline, t }) {
  const areaName = new Map(map.areas.map((area) => [area.id, area.name]));
  const featureText = (key, feature) => `- ${inline(fill(t(key), { id: feature.id, name: feature.name, area: areaName.get(feature.area) ?? '' }))}`;
  const claimed = map.features.reduce((sum, feature) => sum + feature.candidates.length, 0);
  const out = [`## ${t('md.coverage.heading')}`, ''];
  out.push(fill(t('md.coverage.conserved'), { total: candidates.length, assigned: claimed, unassigned: map.unassigned.length }), '');

  out.push(`### ${t('md.coverage.unassignedHeading')}`, '');
  if (map.unassigned.length === 0) out.push(t('md.none'), '');
  else {
    const kind = new Map(candidates.map((candidate) => [candidate.id, candidate.kind]));
    out.push(table([t('md.table.candidate'), t('md.table.kind'), t('md.table.reason')], map.unassigned.map((entry) => [entry.candidate, t(`md.kind.${kind.get(entry.candidate)}`), entry.reason])), '');
  }

  out.push(`### ${t('md.coverage.linkHeading')}`, '');
  const links = map.features.filter((feature) => feature.reach === 'link');
  out.push(...(links.length === 0 ? [t('md.none')] : links.map((feature) => featureText('md.coverage.linkItem', feature))), '');

  out.push(`### ${t('md.coverage.noChapterHeading')}`, '');
  const without = map.features.filter((feature) => !chapters.has(feature.id));
  out.push(...(without.length === 0 ? [t('md.coverage.allChapters')] : without.map((feature) => featureText('md.coverage.unwrittenItem', feature))), '');

  out.push(`### ${t('md.coverage.failedHeading')}`, '');
  const failed = [...chapters].filter(([, chapter]) => chapter.record.status === 'failed');
  out.push(...(failed.length === 0 ? [t('md.none')] : failed.map(([name, chapter]) => `- ${inline(fill(t('md.coverage.failedItem'), { name, count: chapter.record.reasons.length }))}`)), '');

  const crossMissing = EXPECTED_CROSS_CHAPTERS.filter((name) => !chapters.has(name));
  out.push(`### ${t('md.coverage.crossHeading')}`, '');
  if (crossMissing.length === 0) out.push(t('md.coverage.crossAll'), '');
  else {
    out.push(...crossMissing.map((name) => `- ${inline(name)}`), '');
    if (without.length > 0) out.push(t('md.coverage.crossWaiting'), '');
  }

  out.push(`### ${t('md.coverage.outlineHeading')}`, '');
  if (outline.source === 'outline') out.push(t('md.coverage.outlineUsed'), '', ...outline.parts.map((part) => `- ${inline(fill(t('md.coverage.outlinePartItem'), { title: part.title, count: part.chapters.length }))}`), '');
  else if (outline.problems.length === 0) out.push(t('md.coverage.outlineDefault'), '');
  else out.push(t('md.coverage.outlineFailed'), '', ...outline.problems.map((line) => `- ${inline(line)}`), '');
  if (outline.unplaced.length > 0) out.push(`#### ${t('md.coverage.outlineUnplacedHeading')}`, '', ...outline.unplaced.map((item) => `- ${inline(fill(t('md.coverage.outlineUnplacedItem'), { block: item.block, title: item.block, reason: item.reason }))}`), '');
  return out;
}
