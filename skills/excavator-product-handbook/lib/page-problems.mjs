/**
 * The `problems` key of the page data (openspec change handbook-page-structure): one table of rows for the three kinds
 * of problems, built once here so the overview, the feature pages and the problems page show the same rows (D1).
 * Defects come from the shared parser (D2), design problems from the checked batch files, open questions from the
 * fixed section of each chapter (D3). Each source has its own state and a source that is not `ok` gives no rows (D5);
 * a row's remedy anchor is the one remedies heading that names its category or dimension, else none (D4).
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { citationGroups } from './chapter-cites.mjs';
import { afterOpenQuestionTitle, openQuestionTitle, parseDefects, sectionItems } from './defects-items.mjs';
import { readJson } from './json-file.mjs';
import { productText } from './md-views.mjs';
import { pageHeadings, viewTexts } from './page-domains.mjs';
import { FACTS_FILE, reviewBatches } from './review-batches.mjs';
import { batchFile, reviewChapterText, sortedReviewItems } from './review-render.mjs';

const WIDE_SEMICOLON = String.fromCharCode(0xff1b);
const WIDE_STOP = String.fromCharCode(0x3002);
const ELLIPSIS = String.fromCharCode(0x2026);
const SUMMARY_LIMIT = 120;
/** The bold category at the start of a defect item, and the bold short title after it when the item has one (design D20). */
const LEADING_CATEGORY = /^\*\*[^*]+\*\*\s*/;
const LEADING_TITLE = /^\*\*[^*]+\*\*\s*/;

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const specsOf = (text) => citationGroups(text).flatMap((group) => group.specs);

/** One line of product text: cut at the first sentence end within the limit, else the first 120 characters and an ellipsis. */
export function summaryOf(text) {
  const flat = text.replace(/\s+/g, ' ').trim();
  const ends = [WIDE_SEMICOLON, WIDE_STOP, '; ', '. '].map((end) => flat.indexOf(end)).filter((at) => at !== -1);
  if (/\.$/.test(flat)) ends.push(flat.length - 1);
  const cut = ends.length === 0 ? -1 : Math.min(...ends);
  if (cut !== -1 && cut <= SUMMARY_LIMIT) return flat.slice(0, cut).trim();
  return flat.length > SUMMARY_LIMIT ? `${flat.slice(0, SUMMARY_LIMIT)}${ELLIPSIS}` : flat;
}

/** The source description for a chapter that is not usable: `missing` without the file, `failed` without a passed record. */
function chapterState(run, name) {
  const chapter = run.chapters.get(name);
  if (chapter === undefined) return 'missing';
  return chapter.record.status === 'passed' ? 'ok' : 'failed';
}

function remedyIndex(run) {
  const chapter = run.chapters.get('remedies');
  if (chapter === undefined) return null;
  return pageHeadings(productText(chapter.text)).map((heading, index) => ({ ...heading, index })).filter((heading) => heading.level === 2);
}

/** `{ chapter: 'remedies', heading }` when exactly one level-2 heading of the remedies chapter matches, else null. */
function remedyOf(headings, matches) {
  if (headings === null) return null;
  const found = headings.filter((heading) => matches(heading.title));
  return found.length === 1 ? { chapter: 'remedies', heading: found[0].index } : null;
}

function defectRows(run, views, headings) {
  const state = chapterState(run, 'defects');
  if (state !== 'ok') return { state, rows: [] };
  const chapter = run.chapters.get('defects');
  const { items, problems } = parseDefects(chapter.text, { none: run.ui['chapter.none'] });
  if (problems.length > 0) return { state: 'failed', rows: [] };
  const technical = views.includes('technical');
  const rows = items.map((item, at) => {
    const rest = item.text.replace(LEADING_CATEGORY, '');
    const body = item.title === null ? rest : rest.replace(LEADING_TITLE, '');
    const word = new RegExp(`\\b${escapeRegExp(item.category)}\\b`);
    return {
      id: `d${at + 1}`,
      type: 'defect',
      level: item.level,
      group: item.category,
      features: [...item.features],
      // The writer's short title when the item has one; an older chapter without titles falls back to the first clause.
      summary: item.title ?? summaryOf(productText(body)),
      texts: viewTexts(body, views),
      ...(technical ? { cites: specsOf(item.text) } : {}),
      source: { chapter: 'defects', line: item.line },
      remedy: remedyOf(headings, (title) => word.test(title)),
    };
  });
  return { state: 'ok', rows };
}

/** The batches the review chapter was rendered from, in order: the facts file's, else the ones the run's map and domains give. */
function batchIds(outDir) {
  const facts = readJson(join(outDir, FACTS_FILE));
  if (facts.ok && Array.isArray(facts.value?.batches) && facts.value.batches.every((batch) => typeof batch?.id === 'string')) {
    return facts.value.batches.map((batch) => batch.id);
  }
  const listed = reviewBatches(outDir);
  return listed.ok ? listed.batches.map((batch) => batch.id) : null;
}

/** The `[{ batch, items }]` the chapter was rendered from, or null when a batch file is missing or unreadable. */
function loadBatches(outDir) {
  const ids = batchIds(outDir);
  if (ids === null) return null;
  const batches = [];
  for (const id of ids) {
    if (!existsSync(join(outDir, batchFile(id)))) return null;
    const read = readJson(join(outDir, batchFile(id)));
    if (!read.ok || !Array.isArray(read.value?.items)) return null;
    batches.push({ batch: { id }, items: read.value.items });
  }
  return batches;
}

/** The 1-based line of each item's `### title` heading, in the order the chapter lists them. */
function itemLines(text, sorted) {
  const lines = text.split('\n');
  let from = 0;
  return sorted.map(({ item }) => {
    const at = lines.indexOf(`### ${item.title.trim()}`, from);
    if (at === -1) return 1;
    from = at + 1;
    return at + 1;
  });
}

function designRows(run, views, headings) {
  const state = chapterState(run, 'review');
  if (state !== 'ok') return { state, rows: [] };
  const batches = loadBatches(run.outDir);
  const text = run.chapters.get('review').text;
  if (batches === null || reviewChapterText({ strings: run.ui, map: run.map }, batches) !== text) return { state: 'changed', rows: [] };
  const technical = views.includes('technical');
  const sorted = sortedReviewItems(batches);
  const lines = itemLines(text, sorted);
  const rows = sorted.map(({ item }, at) => {
    const label = run.ui[`chapter.review.dimension.${item.dimension}`];
    return {
      id: `r${at + 1}`,
      type: 'design',
      level: item.impact,
      group: item.dimension,
      features: [...item.features],
      summary: item.title,
      texts: Object.fromEntries(views.map((view) => [view, view === 'product'
        ? { situation: productText(item.situation), consequence: productText(item.consequence) }
        : { situation: item.situation, consequence: item.consequence }])),
      ...(technical ? { cites: [...item.cites] } : {}),
      source: { chapter: 'review', line: lines[at] },
      remedy: remedyOf(headings, (title) => title.includes(label)),
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
  const headings = remedyIndex(run);
  const defects = defectRows(run, views, headings);
  const design = designRows(run, views, headings);
  const open = openRows(run, views);
  const source = ({ state, rows }) => ({ state, count: state === 'ok' ? rows.length : null });
  // `unmatched`: the chapters with no heading equal to the fixed text, so no question was taken from them.
  return {
    sources: { defects: source(defects), design: source(design), open: { ...source(open), unmatched: open.unmatched } },
    rows: [...defects.rows, ...design.rows, ...open.rows],
    remedies: headings === null ? null : 'remedies',
  };
}
