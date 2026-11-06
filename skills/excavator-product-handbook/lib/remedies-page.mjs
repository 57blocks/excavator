/**
 * The remedies as the page data holds them (openspec change handbook-remedies,
 * design D6): `{ categories, recommendations }`, written from the same model as
 * the handbook (remedies-model.mjs). A category is `{ category, cause, measure }`;
 * a recommendation is `{ title, text, groups, facts }`, `groups` the cited groups
 * (`{ id, category, level, text }`, `id` the first finding's id and `level` P0 to P2
 * or null for a group without a level) and `facts` the cited facts that are not
 * groups, each with its `kind` (`app`, `tables` or `counts`) and the values the
 * script computed, so the page writes them in words from the run's fixed text.
 * No path is in it; the places of a statement are the technical part's.
 */

import { UNRANKED } from './remedies-facts.mjs';

/** One cited fact without its id, in the page's shape. */
function pageFact(row) {
  switch (row.kind) {
    case 'app': return { kind: 'app', name: row.name, language: row.language === '-' ? null : row.language, files: row.files, lines: row.lines, commits: row.commits === '-' ? null : Number(row.commits), authors: row.authors === '-' ? null : Number(row.authors) };
    case 'tables': return { kind: 'tables', count: row.count, tables: row.tables.map((table) => ({ name: table.name, applications: [...table.apps] })) };
    case 'counts': return { kind: 'counts', groups: row.groups, levels: { ...row.levels }, categories: row.categories.map((entry) => ({ category: entry.category, count: entry.count })) };
    default: throw new Error(`${row.id} is not a fact the page shows`);
  }
}

/** The page's `remedies` of a model built by `withRemedies`. */
export function remediesPageSection(remedies) {
  return {
    categories: remedies.categories.map((entry) => ({ category: entry.category, cause: entry.cause, measure: entry.measure })),
    recommendations: remedies.recommendations.map((entry) => ({
      title: entry.title,
      text: entry.text,
      groups: entry.groups.map((group) => ({ id: group.item.id, category: group.category, level: group.level === UNRANKED ? null : group.level, text: group.text })),
      facts: entry.facts.map(pageFact),
    })),
  };
}
