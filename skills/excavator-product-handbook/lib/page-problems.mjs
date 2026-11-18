/**
 * The `problems` key of the page data (openspec change handbook-page-structure): one table of rows for the three kinds
 * of problems, built once here so the overview, the feature pages and the problems page show the same rows (D1).
 * Defects come from the shared parser (D2), design problems from the checked batch files, open questions from the
 * fixed section of each chapter (D3). Each source has its own state and a source that is not `ok` gives no rows (D5);
 * a row's remedy anchor is the level-2 heading of the remedies item that names the row's number (D4, handbook-process-review D11),
 * or, for a remedies chapter that names no number, the one heading that names its category or dimension.
 */

import { citationGroups } from './chapter-cites.mjs';
import { afterOpenQuestionTitle, openQuestionTitle, sectionItems } from './defects-items.mjs';
import { runNumbers, summaryOf } from './item-numbers.mjs';
import { productText } from './md-views.mjs';
import { pageHeadings, viewTexts } from './page-domains.mjs';
import { namedIds, parseRemedies } from './remedies-parse.mjs';

export { summaryOf };

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const specsOf = (text) => citationGroups(text).flatMap((group) => group.specs);

/** The remedies chapter as the rows read it: its level-2 headings (page index) and its list items, or null without the chapter. */
function remedyIndex(run) {
  const chapter = run.chapters.get('remedies');
  if (chapter === undefined) return null;
  const headings = pageHeadings(productText(chapter.text)).map((heading, index) => ({ ...heading, index })).filter((heading) => heading.level === 2);
  const parsed = parseRemedies(chapter.text);
  return { headings, parsed, numbered: namedIds(parsed).size > 0 };
}

/**
 * `{ chapter: 'remedies', heading }` for a row. When the remedies chapter names ids, the level-2 heading of the first list
 * item whose id group names `id` (null when no item does); an older chapter that names none keeps the match by name: exactly
 * one level-2 heading that `matches`.
 */
function remedyOf(index, id, matches) {
  if (index === null) return null;
  if (index.numbered) {
    const item = index.parsed.items.find((entry) => entry.ids.includes(id) && entry.section !== null);
    return item === undefined ? null : { chapter: 'remedies', heading: item.section.page };
  }
  const found = index.headings.filter((heading) => matches(heading.title));
  return found.length === 1 ? { chapter: 'remedies', heading: found[0].index } : null;
}

/** The defect rows; a source that is not `ok` (item-numbers.mjs) gives none. */
function defectRows(run, views, index) {
  const { state, items } = runNumbers(run).defects;
  if (state !== 'ok') return { state, rows: [] };
  const technical = views.includes('technical');
  const rows = items.map((entry) => {
    const word = new RegExp(`\\b${escapeRegExp(entry.category)}\\b`);
    return {
      id: `d${entry.n}`,
      type: 'defect',
      level: entry.level,
      group: entry.category,
      features: [...entry.features],
      summary: entry.title,
      texts: viewTexts(entry.body, views),
      ...(technical ? { cites: specsOf(entry.item.text) } : {}),
      source: { chapter: 'defects', line: entry.line },
      remedy: remedyOf(index, entry.id, (title) => word.test(title)),
    };
  });
  return { state: 'ok', rows };
}

function designRows(run, views, index) {
  const { state, items } = runNumbers(run).design;
  if (state !== 'ok') return { state, rows: [] };
  const technical = views.includes('technical');
  const rows = items.map((entry) => {
    const { item } = entry;
    const label = run.ui[`chapter.review.dimension.${item.dimension}`];
    return {
      id: `r${entry.n}`,
      type: 'design',
      level: item.impact,
      group: item.dimension,
      features: [...item.features],
      summary: item.title,
      texts: Object.fromEntries(views.map((view) => [view, view === 'product'
        ? { situation: productText(item.situation), consequence: productText(item.consequence) }
        : { situation: item.situation, consequence: item.consequence }])),
      ...(technical ? { cites: [...item.cites] } : {}),
      source: { chapter: 'review', line: entry.line },
      remedy: remedyOf(index, entry.id, (title) => title.includes(label)),
    };
  });
  return { state: 'ok', rows };
}

function openRows(run, views) {
  const technical = views.includes('technical');
  const none = run.ui['chapter.none'];
  const rows = [];
  const unmatched = [];
  for (const stem of ['system', ...run.map.features.map((feature) => feature.id)]) {
    const chapter = run.chapters.get(stem);
    if (chapter === undefined) continue;
    const items = sectionItems(chapter.text, run.ui['chapter.openQuestions'], none);
    if (items === null) unmatched.push(stem);
    for (const item of items ?? []) {
      // A short bold title is the label and the text starts after it (design D21); an item without one keeps its whole text.
      const title = openQuestionTitle(item.text);
      const text = title === null ? item.text : afterOpenQuestionTitle(item.text);
      rows.push({
        id: `q${rows.length + 1}`,
        type: 'open',
        level: null,
        group: null,
        features: [stem],
        summary: title ?? summaryOf(productText(item.text)),
        texts: viewTexts(text, views),
        ...(technical ? { cites: specsOf(item.text) } : {}),
        source: { chapter: stem, line: item.line },
        remedy: null,
      });
    }
  }
  return { state: 'ok', rows, unmatched };
}

/** The `problems` key: the state and count of each source, the rows (defects, design problems, open questions) and the remedies chapter id. */
export function problemsData(run, views) {
  const index = remedyIndex(run);
  const defects = defectRows(run, views, index);
  const design = designRows(run, views, index);
  const open = openRows(run, views);
  const source = ({ state, rows }) => ({ state, count: state === 'ok' ? rows.length : null });
  // `unmatched`: the chapters with no heading equal to the fixed text, so no question was taken from them.
  return {
    sources: { defects: source(defects), design: source(design), open: { ...source(open), unmatched: open.unmatched } },
    rows: [...defects.rows, ...design.rows, ...open.rows],
    remedies: index === null ? null : 'remedies',
  };
}
