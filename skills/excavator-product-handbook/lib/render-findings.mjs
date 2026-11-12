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
 * path. Each group also carries its priority and the reason (openspec change
 * handbook-findings-priority, priority-model.mjs): the line starts with the level
 * (or the word for no level), the groups of a category are in the order of the
 * model (P0, P1, P2, unranked), and the counts line and each category heading
 * say how many groups have which level. Under each category heading, the common cause and the measure the remedies
 * hold for it (openspec change handbook-remedies, render-remedy-category.mjs) come before its groups. Pure and deterministic.
 */

import { FINDING_CATEGORIES, categoryKey, findingsId } from './findings-shape.mjs';
import { findingsStatus } from './findings-model.mjs';
import { inline, table } from './markdown.mjs';
import { EMPTY_PRIORITY } from './priority-model.mjs';
import { LEVELS } from './priority-shape.mjs';
import { categoryRemedyLines } from './render-remedy-category.mjs';
import { unverifiedCounts } from './unverified.mjs';
import { fill } from './ui.mjs';

const NONE_ROW = '-';

/** An owner as the reader sees it: a feature with its id, or an application by its name. */
export const ownerText = (owner, t) => (owner.kind === 'feature' ? fill(t('md.summary.feature'), { id: owner.id, name: owner.name }) : fill(t('md.findings.applicationOwner'), { name: owner.name }));

/** One citation's place as the other chapters of the technical view write it. */
export function placeText({ file, startLine, endLine }, t) {
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

/** The level as the reader sees it: `P0` is rank 0. */
export const levelText = (level, t) => fill(t('md.priority.level'), { rank: level.slice(1) });

/** The counts of groups by level and without one, as the counts line writes them. */
export const priorityCountsText = (counts, t) => [...LEVELS.map((level) => fill(t('md.priority.count'), { level: levelText(level, t), count: counts[level] })), fill(t('md.priority.count'), { level: t('md.priority.unranked'), count: counts.unranked })].join('; ');

/** The line of a group: its level (or the word for none), the statement of its first finding with the owners and, for a group with a priority, the reason. */
function groupLine(group, first, context) {
  const statement = statementText(first, group.owners, true, context);
  const { t } = context;
  if (group.priority === null || group.priority === undefined) return fill(t('md.priority.lineUnranked'), { level: t('md.priority.unranked'), statement });
  return fill(t('md.priority.line'), { level: levelText(group.priority.level, t), statement, reason: group.priority.reason });
}

/** The Findings chapter: the counts line, then one list per category that has a group. */
export function findingsChapter({ map, state, findings, remedies = null, unverified = new Set(), view, t }) {
  const { list, groups, locations, applications } = findings;
  // Written units: verified ones and checked ones (openspec change handbook-light-scheme); the checked ones are also counted as not verified.
  const marks = unverifiedCounts(unverified);
  const verified = map.features.filter((feature) => findingsStatus(state, feature.id) === 'verified' || unverified.has(findingsId(feature.id))).length;
  const counts = categoryCounts(groups);
  const out = [`## ${t('md.findings.heading')}`, '', t('md.findings.note'), ''];
  // A part written and not verified (openspec change handbook-light-scheme) says so at the head of the chapter, each with its own sentence.
  if (marks.findings > 0) out.push(inline(t('md.findings.unverifiedFeature')), '');
  if (marks.systemFindings > 0) out.push(inline(t('md.findings.unverifiedSystem')), '');
  if (findings.priority?.unverified === true && groups.length > 0) out.push(inline(t('md.priority.unverified')), '');
  if (remedies?.unverified === true && remedies.categories.length > 0) out.push(inline(t('md.remedies.unverified')), '');
  out.push(fill(t('md.findings.counts'), {
    total: groups.length,
    statements: list.length,
    merged: groups.filter((group) => group.items.length > 1).length,
    verified,
    featureTotal: map.features.length,
    unverified: marks.findings,
    systemVerified: applications.filter((application) => application.status === 'verified' || unverified.has(`${application.id}.system`)).length,
    systemUnverified: marks.systemFindings,
    systemTotal: applications.length,
    categories: counts.map(({ category, count }) => fill(t('md.findings.categoryCount'), { category: t(categoryKey(category)), count })).join('; '),
    priority: priorityCountsText((findings.priority ?? EMPTY_PRIORITY).counts, t),
  }), '');
  if (groups.length === 0) return [...out, t('md.findings.none'), ''];
  for (const { category } of counts.filter(({ count }) => count > 0)) {
    const own = groups.filter((one) => one.category === category);
    out.push(`### ${fill(t('md.priority.categoryHeading'), { category: t(categoryKey(category)), count: own.length, p0: own.filter((one) => one.priority?.level === 'P0').length })}`, '');
    out.push(...categoryRemedyLines(category, remedies, t));
    for (const group of own) {
      const [first, ...others] = group.items;
      out.push(`- ${inline(groupLine(group, first, { locations, view, t }))}`);
      for (const other of others) out.push(`  - ${inline(statementText(other, group.owners, false, { locations, view, t }))}`);
    }
    out.push('');
  }
  return out;
}

/**
 * The findings list at the end of a feature's section: its own findings with
 * their category, or the fixed none text when its unit is verified with none;
 * a checked unit (written, not verified) has its own not-verified sentence first;
 * nothing when the unit is neither (the coverage section says where it stopped).
 */
export function featureFindingsLines(featureId, { state, findings, unverified = new Set(), t }) {
  const light = unverified.has(findingsId(featureId));
  if (findingsStatus(state, featureId) !== 'verified' && !light) return [];
  const own = findings.list.filter((finding) => finding.owner.kind === 'feature' && finding.owner.id === featureId);
  const out = [`#### ${t('md.findings.heading')}`, ''];
  if (light) out.push(inline(t('md.findings.unverifiedFeature')), '');
  if (own.length === 0) out.push(t('md.none'), '');
  else out.push(...own.map((finding) => `- ${inline(fill(t('md.findings.featureItem'), { category: t(categoryKey(finding.category)), text: finding.text }))}`), '');
  return out;
}

/** The two parts of the coverage section about findings: the units not verified (features, then application roots) and the findings removed. */
export function findingsCoverage({ map, state, findings, unverified = new Set(), t, areaName }) {
  const label = (key, feature, extra = {}) => fill(t(key), { id: feature.id, name: feature.name, area: areaName.get(feature.area), ...extra });
  const { applications } = findings;
  const out = [`### ${t('md.coverage.findingsUnfinishedHeading')}`, ''];
  // A unit that is checked is written, not unfinished (openspec change handbook-light-scheme): it is counted on its own line.
  const light = (feature) => unverified.has(findingsId(feature.id));
  const notVerified = map.features.filter((feature) => findingsStatus(state, feature.id) !== 'verified' && !light(feature));
  const featuresUnverified = map.features.filter(light).length;
  // Units never written (planned) are one line with their count; every other unit not verified has its own row.
  const unfinished = notVerified.filter((feature) => findingsStatus(state, feature.id) !== 'planned');
  const planned = notVerified.length - unfinished.length;
  if (notVerified.length === 0 && featuresUnverified === 0) out.push(t('md.coverage.findingsAllVerified'));
  if (featuresUnverified > 0) out.push(fill(t('md.coverage.findingsUnverified'), { count: featuresUnverified, total: map.features.length }), '');
  if (planned > 0) out.push(fill(t('md.coverage.findingsNotWritten'), { count: planned }), '');
  if (unfinished.length > 0) out.push(table([t('md.table.feature'), t('md.table.status')], unfinished.map((feature) => [label('md.coverage.findingsUnfinishedItem', feature), t(`md.status.${findingsStatus(state, feature.id)}`)])));
  // The same for the system findings of the application roots: one count line for the units never written, a row for each other unit not verified.
  const systemLight = (application) => unverified.has(`${application.id}.system`);
  const systemNotVerified = applications.filter((application) => application.status !== 'verified' && !systemLight(application));
  const systemUnverified = applications.filter(systemLight).length;
  const systemUnfinished = systemNotVerified.filter((application) => application.status !== 'planned');
  const systemPlanned = systemNotVerified.length - systemUnfinished.length;
  out.push('');
  if (applications.length > 0 && systemNotVerified.length === 0 && systemUnverified === 0) out.push(t('md.coverage.systemFindingsAllVerified'), '');
  if (systemUnverified > 0) out.push(fill(t('md.coverage.systemFindingsUnverified'), { count: systemUnverified, total: applications.length }), '');
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
  out.push(...priorityCoverage({ findings, t }));
  return out;
}

/**
 * The part of the coverage section about the ranking: the groups without a priority with the reasons of the judges, or the
 * statement that the ranking did not finish (the unit is not verified, so every group is without one), or that every group has one.
 */
export function priorityCoverage({ findings, t }) {
  const { finished, unranked, unverified } = findings.priority ?? EMPTY_PRIORITY;
  const out = [`### ${t('md.coverage.priorityHeading')}`, ''];
  if (findings.groups.length === 0) return [...out, t('md.none'), ''];
  // A checked ranking is written, not verified (openspec change handbook-light-scheme): the coverage counts it as written.
  if (unverified === true) out.push(t('md.coverage.priorityUnverified'), '');
  if (!finished) return [...out, fill(t('md.coverage.priorityNotFinished'), { count: findings.groups.length }), ''];
  if (unranked.length === 0) return [...out, t('md.coverage.priorityAllRanked'), ''];
  const rows = unranked.map(({ group, reasons }) => [fill(t('md.findings.featureItem'), { category: t(categoryKey(group.category)), text: group.items[0].text }), reasons.length === 0 ? t('md.priority.notJudged') : reasons.join('; ')]);
  return [...out, fill(t('md.coverage.priorityUnranked'), { count: unranked.length }), '', table([t('md.findings.claimLabel'), t('md.table.reason')], rows), ''];
}
