/**
 * The findings of handbook.md (openspec change handbook-feature-findings): the
 * Findings chapter, the list inside a feature's section and the two parts of
 * the coverage section. Written from the verified findings (findings-model.mjs)
 * and the state; every fixed text is a ui key. The chapter is in both views;
 * the technical view adds the file and lines of each finding's passages, the
 * product view never writes a path. Pure and deterministic.
 */

import { FINDING_CATEGORIES, categoryKey } from './findings-shape.mjs';
import { findingsStatus } from './findings-model.mjs';
import { inline, table } from './markdown.mjs';
import { fill } from './ui.mjs';

const NONE_ROW = '-';

const featureText = (feature, t) => fill(t('md.summary.feature'), { id: feature.id, name: feature.name });

/** One citation's place as the other chapters of the technical view write it. */
function placeText({ file, startLine, endLine }, t) {
  if (startLine === null || endLine === null) return fill(t('md.locations.unlocated'), { file });
  if (startLine === endLine) return fill(t('md.locations.placeOne'), { file, line: startLine });
  return fill(t('md.locations.place'), { file, start: startLine, end: endLine });
}

/** The count of verified findings of each category, in the fixed order, zeros included. */
export const categoryCounts = (list) => FINDING_CATEGORIES.map((category) => ({ category, count: list.filter((finding) => finding.category === category).length }));

/** The Findings chapter: the counts line, then one list per category that has a finding. */
export function findingsChapter({ map, state, findings, view, t }) {
  const featureOf = new Map(map.features.map((feature) => [feature.id, feature]));
  const { list, locations } = findings;
  const verified = map.features.filter((feature) => findingsStatus(state, feature.id) === 'verified').length;
  const counts = categoryCounts(list);
  const out = [`## ${t('md.findings.heading')}`, '', t('md.findings.note'), ''];
  out.push(fill(t('md.findings.counts'), {
    total: list.length,
    verified,
    featureTotal: map.features.length,
    categories: counts.map(({ category, count }) => fill(t('md.findings.categoryCount'), { category: t(categoryKey(category)), count })).join('; '),
  }), '');
  if (list.length === 0) return [...out, t('md.findings.none'), ''];
  for (const { category } of counts.filter(({ count }) => count > 0)) {
    out.push(`### ${t(categoryKey(category))}`, '');
    for (const finding of list.filter((item) => item.category === category)) {
      const feature = featureText(featureOf.get(finding.feature), t);
      const places = view === 'technical' ? (locations?.get(finding.id) ?? []) : [];
      out.push(`- ${inline(places.length === 0
        ? fill(t('md.findings.item'), { feature, text: finding.text })
        : fill(t('md.findings.itemTechnical'), { feature, text: finding.text, places: places.map((place) => placeText(place, t)).join('; ') }))}`);
    }
    out.push('');
  }
  return out;
}

/**
 * The findings list at the end of a feature's section: its own findings with
 * their category, or the fixed none text when its unit is verified with none;
 * nothing when the unit is not verified (the coverage section says where it stopped).
 */
export function featureFindingsLines(featureId, { state, findings, t }) {
  if (findingsStatus(state, featureId) !== 'verified') return [];
  const own = findings.list.filter((finding) => finding.feature === featureId);
  const out = [`#### ${t('md.findings.heading')}`, ''];
  if (own.length === 0) out.push(t('md.none'), '');
  else out.push(...own.map((finding) => `- ${inline(fill(t('md.findings.featureItem'), { category: t(categoryKey(finding.category)), text: finding.text }))}`), '');
  return out;
}

/** The two parts of the coverage section about findings: the units not verified and the findings removed. */
export function findingsCoverage({ map, state, t, areaName }) {
  const label = (key, feature, extra = {}) => fill(t(key), { id: feature.id, name: feature.name, area: areaName.get(feature.area), ...extra });
  const out = [`### ${t('md.coverage.findingsUnfinishedHeading')}`, ''];
  const notVerified = map.features.filter((feature) => findingsStatus(state, feature.id) !== 'verified');
  // Units never written (planned) are one line with their count; every other unit not verified has its own row.
  const unfinished = notVerified.filter((feature) => findingsStatus(state, feature.id) !== 'planned');
  const planned = notVerified.length - unfinished.length;
  if (notVerified.length === 0) out.push(t('md.coverage.findingsAllVerified'));
  if (planned > 0) out.push(fill(t('md.coverage.findingsNotWritten'), { count: planned }), '');
  if (unfinished.length > 0) out.push(table([t('md.table.feature'), t('md.table.status')], unfinished.map((feature) => [label('md.coverage.findingsUnfinishedItem', feature), t(`md.status.${findingsStatus(state, feature.id)}`)])));
  out.push('', `### ${t('md.coverage.findingsRemovedHeading')}`, '');
  const withRemoved = map.features.filter((feature) => (state.findings?.[feature.id]?.removed ?? []).length > 0);
  if (withRemoved.length === 0) out.push(t('md.none'), '');
  for (const feature of withRemoved) {
    const removed = state.findings[feature.id].removed;
    out.push(`#### ${inline(label('md.coverage.findingsRemovedFeature', feature, { count: removed.length }))}`, '');
    out.push(table([t('md.table.item'), t('md.table.result'), t('md.table.reason')], removed.map((item) => [item.claim, t(`md.verdict.${item.verdict}`), item.reason === '' ? NONE_ROW : item.reason])), '');
  }
  return out;
}
