/**
 * The Recommendations chapter of handbook.md and the remedies part of the
 * coverage section (openspec change handbook-remedies, design D6). Written from
 * the remedies the judges kept (remedies-model.mjs); every fixed text is a ui
 * key. Each recommendation has its number, title and text, then the groups of
 * findings it rests on (level and representative statement; the technical view
 * adds the file and lines of the statement) and the facts it rests on, each fact
 * written in words from the row the script computed. Pure and deterministic.
 */

import { categoryKey } from './findings-shape.mjs';
import { inline, table } from './markdown.mjs';
import { levelText, placeText, priorityCountsText } from './render-findings.mjs';
import { fill } from './ui.mjs';
import { NONE, UNRANKED } from './remedies-facts.mjs';

/** A level as the reader sees it: P0 to P2, or the word for none. */
export const levelName = (level, t) => (level === UNRANKED ? t('md.priority.unranked') : levelText(level, t));

/** One fact (a row of remedies-facts.mjs that is not a group) in words. */
export function factText(row, t) {
  switch (row.kind) {
    case 'app': {
      const values = { name: row.name, language: row.language === NONE ? t('md.remedies.noLanguage') : row.language, files: row.files, lines: row.lines };
      return row.commits === NONE
        ? fill(t('md.remedies.factAppNoHistory'), values)
        : fill(t('md.remedies.factApp'), { ...values, commits: row.commits, authors: row.authors });
    }
    case 'tables': {
      if (row.count === null) return t('md.remedies.factTablesUnknown');
      if (row.count === 0) return fill(t('md.remedies.factTables'), { count: 0 });
      const tables = row.tables.map((one) => fill(t('md.remedies.factTable'), { table: one.name, applications: one.apps.join(', ') })).join('; ');
      return fill(t('md.remedies.factTablesNamed'), { count: row.count, tables });
    }
    case 'counts':
      return fill(t('md.remedies.factCounts'), {
        groups: row.groups,
        levels: priorityCountsText(row.levels, t),
        categories: row.categories.map((entry) => fill(t('md.findings.categoryCount'), { category: t(categoryKey(entry.category)), count: entry.count })).join('; '),
      });
    default:
      throw new Error(`${row.id} is not a fact that is written in words`);
  }
}

/** The line of a cited group: its level, its category, its statement and, in the technical view, where the statement's passages are. */
function groupLine(group, { locations, view, t }) {
  const values = { level: levelName(group.level, t), category: t(categoryKey(group.category)), statement: group.text };
  const places = view === 'technical' ? (locations?.get(group.item.id) ?? []) : [];
  if (places.length === 0) return fill(t('md.remedies.groupLine'), values);
  return fill(t('md.remedies.groupLineTechnical'), { ...values, places: places.map((place) => placeText(place, t)).join('; ') });
}

/** The Recommendations chapter: the note, the counts line, then each recommendation with what it rests on. Nothing when the handbook has no verified finding. */
export function recommendationsChapter({ findings, remedies, view, t }) {
  if (!remedies.hasGroups) return [];
  const { recommendations } = remedies;
  const out = [`## ${t('md.remedies.heading')}`, '', t('md.remedies.note'), ''];
  if (recommendations.length === 0) return [...out, t('md.remedies.none'), ''];
  out.push(fill(t('md.remedies.counts'), { count: recommendations.length, groups: remedies.groupsCited, total: findings.groups.length }), '');
  for (const recommendation of recommendations) {
    out.push(`### ${inline(fill(t('md.remedies.itemHeading'), { number: recommendation.number, title: recommendation.title }))}`, '', inline(recommendation.text), '');
    if (recommendation.groups.length > 0) {
      out.push(`${t('md.remedies.groupsHeading')}:`, '');
      for (const group of recommendation.groups) out.push(`- ${inline(groupLine(group, { locations: findings.locations, view, t }))}`);
      out.push('');
    }
    if (recommendation.facts.length > 0) {
      out.push(`${t('md.remedies.factsHeading')}:`, '');
      for (const fact of recommendation.facts) out.push(`- ${inline(factText(fact, t))}`);
      out.push('');
    }
  }
  return out;
}

/** The part of the coverage section about the remedies: what the judges left out with their reasons, or that they did not finish. */
export function remediesCoverage({ remedies, t }) {
  const out = [`### ${t('md.coverage.remediesHeading')}`, ''];
  if (!remedies.hasGroups) return [...out, t('md.none'), ''];
  if (!remedies.finished) return [...out, t(remedies.stale ? 'md.coverage.remediesStale' : 'md.coverage.remediesNotFinished'), ''];
  if (remedies.dropped.length === 0) return [...out, t('md.coverage.remediesAllKept'), ''];
  const rows = remedies.dropped.map((paragraph) => [
    paragraph.kind === 'category'
      ? fill(t('md.remedies.droppedCategory'), { category: t(categoryKey(paragraph.category)), cause: paragraph.cause })
      : fill(t('md.remedies.droppedRecommendation'), { title: paragraph.title, text: paragraph.text }),
    paragraph.reasons.length === 0 ? NONE : paragraph.reasons.join('; '),
  ]);
  return [...out, fill(t('md.coverage.remediesDropped'), { count: remedies.dropped.length }), '', table([t('md.remedies.tableText'), t('md.table.reason')], rows), ''];
}
