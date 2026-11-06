/**
 * The findings of handbook.md (openspec changes handbook-feature-findings and
 * handbook-system-findings): the Findings chapter, the list inside a feature's
 * section and the two parts of the coverage section. Written from the verified
 * findings (findings-model.mjs) and the state; every fixed text is a ui key. The
 * chapter lists the groups of findings at the same place (findings-groups.mjs):
 * a group is one bullet, the statement of its first finding with every owner (a
 * feature, or an application), and the other statements of the group under it,
 * each with its owner. The chapter is in both views; the technical view adds the
 * file and lines of each statement's passages, the product view never writes a
 * path. Pure and deterministic.
 */

import { FINDING_CATEGORIES, categoryKey } from './findings-shape.mjs';
import { findingsStatus } from './findings-model.mjs';
import { inline, table } from './markdown.mjs';
import { fill } from './ui.mjs';

const NONE_ROW = '-';

/** An owner as the reader sees it: a feature with its id, or an application by its name. */
export const ownerText = (owner, t) => (owner.kind === 'feature' ? fill(t('md.summary.feature'), { id: owner.id, name: owner.name }) : fill(t('md.findings.applicationOwner'), { name: owner.name }));

/** One citation's place as the other chapters of the technical view write it. */
function placeText({ file, startLine, endLine }, t) {
  if (startLine === null || endLine === null) return fill(t('md.locations.unlocated'), { file });
  if (startLine === endLine) return fill(t('md.locations.placeOne'), { file, line: startLine });
  return fill(t('md.locations.place'), { file, start: startLine, end: endLine });
}

/** The count of groups of each category, in the fixed order, zeros included. */
export const categoryCounts = (groups) => FINDING_CATEGORIES.map((category) => ({ category, count: groups.filter((group) => group.category === category).length }));

/** The statement of one finding of a group, as a bullet text: `first` is the group's own line, with every owner. */
function statementText(item, owners, first, { locations, view, t }) {
  const places = view === 'technical' ? (locations?.get(item.id) ?? []) : [];
  const key = first ? 'md.findings.item' : 'md.findings.otherItem';
  const values = first ? { owners: owners.map((owner) => ownerText(owner, t)).join('; '), text: item.text } : { owner: ownerText(item.owner, t), text: item.text };
  if (places.length === 0) return fill(t(key), values);
  return fill(t(`${key}Technical`), { ...values, places: places.map((place) => placeText(place, t)).join('; ') });
}

/** The Findings chapter: the counts line, then one list per category that has a group. */
export function findingsChapter({ map, state, findings, view, t }) {
  const { list, groups, locations, applications } = findings;
  const verified = map.features.filter((feature) => findingsStatus(state, feature.id) === 'verified').length;
  const counts = categoryCounts(groups);
  const out = [`## ${t('md.findings.heading')}`, '', t('md.findings.note'), ''];
  out.push(fill(t('md.findings.counts'), {
    total: groups.length,
    statements: list.length,
    merged: groups.filter((group) => group.items.length > 1).length,
    verified,
    featureTotal: map.features.length,
    systemVerified: applications.filter((application) => application.status === 'verified').length,
    systemTotal: applications.length,
    categories: counts.map(({ category, count }) => fill(t('md.findings.categoryCount'), { category: t(categoryKey(category)), count })).join('; '),
  }), '');
  if (groups.length === 0) return [...out, t('md.findings.none'), ''];
  for (const { category } of counts.filter(({ count }) => count > 0)) {
    out.push(`### ${t(categoryKey(category))}`, '');
    for (const group of groups.filter((one) => one.category === category)) {
      const [first, ...others] = group.items;
      out.push(`- ${inline(statementText(first, group.owners, true, { locations, view, t }))}`);
      for (const other of others) out.push(`  - ${inline(statementText(other, group.owners, false, { locations, view, t }))}`);
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
  const own = findings.list.filter((finding) => finding.owner.kind === 'feature' && finding.owner.id === featureId);
  const out = [`#### ${t('md.findings.heading')}`, ''];
  if (own.length === 0) out.push(t('md.none'), '');
  else out.push(...own.map((finding) => `- ${inline(fill(t('md.findings.featureItem'), { category: t(categoryKey(finding.category)), text: finding.text }))}`), '');
  return out;
}

/** The two parts of the coverage section about findings: the units not verified (features, then application roots) and the findings removed. */
export function findingsCoverage({ map, state, findings, t, areaName }) {
  const label = (key, feature, extra = {}) => fill(t(key), { id: feature.id, name: feature.name, area: areaName.get(feature.area), ...extra });
  const { applications } = findings;
  const out = [`### ${t('md.coverage.findingsUnfinishedHeading')}`, ''];
  const notVerified = map.features.filter((feature) => findingsStatus(state, feature.id) !== 'verified');
  // Units never written (planned) are one line with their count; every other unit not verified has its own row.
  const unfinished = notVerified.filter((feature) => findingsStatus(state, feature.id) !== 'planned');
  const planned = notVerified.length - unfinished.length;
  if (notVerified.length === 0) out.push(t('md.coverage.findingsAllVerified'));
  if (planned > 0) out.push(fill(t('md.coverage.findingsNotWritten'), { count: planned }), '');
  if (unfinished.length > 0) out.push(table([t('md.table.feature'), t('md.table.status')], unfinished.map((feature) => [label('md.coverage.findingsUnfinishedItem', feature), t(`md.status.${findingsStatus(state, feature.id)}`)])));
  // The same for the system findings of the application roots: one count line for the units never written, a row for each other unit not verified.
  const systemNotVerified = applications.filter((application) => application.status !== 'verified');
  const systemUnfinished = systemNotVerified.filter((application) => application.status !== 'planned');
  const systemPlanned = systemNotVerified.length - systemUnfinished.length;
  out.push('');
  if (applications.length > 0 && systemNotVerified.length === 0) out.push(t('md.coverage.systemFindingsAllVerified'), '');
  if (systemPlanned > 0) out.push(fill(t('md.coverage.systemFindingsNotWritten'), { count: systemPlanned }), '');
  if (systemUnfinished.length > 0) {
    out.push(table([t('md.table.application'), t('md.table.status')], systemUnfinished.map((application) => [fill(t('md.findings.applicationOwner'), { name: application.name }), t(`md.status.${application.status}`)])), '');
  }
  out.push(`### ${t('md.coverage.findingsRemovedHeading')}`, '');
  const withRemoved = map.features.filter((feature) => (state.findings?.[feature.id]?.removed ?? []).length > 0);
  const systemRemoved = applications.filter((application) => application.removed.length > 0);
  if (withRemoved.length === 0 && systemRemoved.length === 0) out.push(t('md.none'), '');
  const removedTable = (removed) => table([t('md.table.item'), t('md.table.result'), t('md.table.reason')], removed.map((item) => [item.claim, t(`md.verdict.${item.verdict}`), item.reason === '' ? NONE_ROW : item.reason]));
  for (const feature of withRemoved) {
    const removed = state.findings[feature.id].removed;
    out.push(`#### ${inline(label('md.coverage.findingsRemovedFeature', feature, { count: removed.length }))}`, '', removedTable(removed), '');
  }
  for (const application of systemRemoved) {
    out.push(`#### ${inline(fill(t('md.coverage.systemFindingsRemoved'), { owner: fill(t('md.findings.applicationOwner'), { name: application.name }), count: application.removed.length }))}`, '', removedTable(application.removed), '');
  }
  return out;
}
