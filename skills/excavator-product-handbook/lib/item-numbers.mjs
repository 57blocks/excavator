/**
 * The numbers of the items of the defects chapter (`D<n>`), of the design-problems chapter (`R<n>`) and of the
 * business-processes chapter (`P<n>`, the level-2 headings in order), computed in one place (openspec change
 * handbook-process-review, design D2). `check`, `remedies-inputs`, the coverage sections and the page's problem rows all
 * read their items from `itemNumbers`, so a number means the same item everywhere.
 *
 * A source is `{ state, items }`; `state` is `ok`, `missing` (no chapter), `failed` (no passed record of the chapter's
 * present bytes) or `changed` (the design problems chapter no longer equals what its batch files render to), and a
 * source that is not `ok` has no items.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { citationGroups, specKey } from './chapter-cites.mjs';
import { parseDefects } from './defects-items.mjs';
import { readJson } from './json-file.mjs';
import { productText } from './md-views.mjs';
import { parseProcesses } from './processes-parse.mjs';
import { FACTS_FILE, reviewBatches } from './review-batches.mjs';
import { compareBatches } from './review-compare.mjs';
import { processBatches } from './review-processes.mjs';
import { batchFile, reviewChapterText, sortedReviewItems } from './review-render.mjs';

const WIDE_SEMICOLON = String.fromCharCode(0xff1b);
const WIDE_STOP = String.fromCharCode(0x3002);
const ELLIPSIS = String.fromCharCode(0x2026);
const SUMMARY_LIMIT = 120;
const LEADING_BOLD = /^\*\*[^*]+\*\*\s*/;

/** The reason a source is not available, as a phrase after the chapter's file name. */
export const UNAVAILABLE = Object.freeze({
  missing: 'is missing',
  failed: 'did not pass the check, or changed after it',
  changed: 'changed after it was rendered from its batch files',
});

/** One line of product text: cut at the first sentence end within the limit, else the first 120 characters and an ellipsis. */
export function summaryOf(text) {
  const flat = text.replace(/\s+/g, ' ').trim();
  const ends = [WIDE_SEMICOLON, WIDE_STOP, '; ', '. '].map((end) => flat.indexOf(end)).filter((at) => at !== -1);
  if (/\.$/.test(flat)) ends.push(flat.length - 1);
  const cut = ends.length === 0 ? -1 : Math.min(...ends);
  if (cut !== -1 && cut <= SUMMARY_LIMIT) return flat.slice(0, cut).trim();
  return flat.length > SUMMARY_LIMIT ? `${flat.slice(0, SUMMARY_LIMIT)}${ELLIPSIS}` : flat;
}

const specsOf = (text) => [...new Set(citationGroups(text).flatMap((group) => group.specs.map(specKey)))];

/** `ok`, `missing` (no such chapter) or `failed` (its record is not passed) for chapter `name` of `chapters` (a Map of name -> { text, record }). */
function chapterState(chapters, name) {
  const chapter = chapters.get(name);
  if (chapter === undefined) return 'missing';
  return chapter.record.status === 'passed' ? 'ok' : 'failed';
}

function defectNumbers(chapters, strings) {
  const state = chapterState(chapters, 'defects');
  if (state !== 'ok') return { state, items: [] };
  const { items, problems } = parseDefects(chapters.get('defects').text, { none: strings['chapter.none'] });
  if (problems.length > 0) return { state: 'failed', items: [] };
  return {
    state: 'ok',
    items: items.map((item, at) => {
      const rest = item.text.replace(LEADING_BOLD, '');
      const body = item.title === null ? rest : rest.replace(LEADING_BOLD, '');
      return {
        id: `D${at + 1}`,
        n: at + 1,
        level: item.level,
        category: item.category,
        features: [...item.features],
        // The writer's short title when the item has one; an older chapter without titles falls back to the first clause.
        title: item.title ?? summaryOf(productText(body)),
        body,
        cites: specsOf(item.text),
        line: item.line,
        item,
      };
    }),
  };
}

/** The domain batch ids followed by the comparison and process batches, the order of `reviewContext`'s batch list. */
const withLaterBatches = (outDir, ids) => [...ids, ...compareBatches(outDir).map((batch) => batch.id), ...processBatches(outDir).map((batch) => batch.id)];

/** The batches the review chapter was rendered from, in order: the facts file's, else the ones the run's map and domains give. */
function batchIds(outDir) {
  const facts = readJson(join(outDir, FACTS_FILE));
  if (facts.ok && Array.isArray(facts.value?.batches) && facts.value.batches.every((batch) => typeof batch?.id === 'string')) {
    return withLaterBatches(outDir, facts.value.batches.map((batch) => batch.id));
  }
  const listed = reviewBatches(outDir);
  return listed.ok ? withLaterBatches(outDir, listed.batches.map((batch) => batch.id)) : null;
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

function designNumbers(outDir, map, chapters, strings) {
  const state = chapterState(chapters, 'review');
  if (state !== 'ok') return { state, items: [] };
  const batches = map === null ? null : loadBatches(outDir);
  const text = chapters.get('review').text;
  if (batches === null || reviewChapterText({ strings, map, outDir }, batches) !== text) return { state: 'changed', items: [] };
  const lines = text.split('\n');
  let from = 0;
  const items = sortedReviewItems(batches).map(({ item }, at) => {
    const heading = lines.indexOf(`### R${at + 1} ${item.title.trim()}`, from);
    if (heading !== -1) from = heading + 1;
    return {
      id: `R${at + 1}`,
      n: at + 1,
      impact: item.impact,
      dimension: item.dimension,
      features: [...item.features],
      process: typeof item.process === 'string' ? item.process : null,
      title: item.title.trim(),
      cites: [...new Set(item.cites.map((cite) => specKey(cite.trim())))],
      line: heading === -1 ? 1 : heading + 1,
      item,
    };
  });
  return { state: 'ok', items };
}

function processNumbers(chapters) {
  const state = chapterState(chapters, 'processes');
  if (state !== 'ok') return { state, items: [] };
  const text = chapters.get('processes').text;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const processes = parseProcesses(text);
  const items = processes.map((process, at) => {
    const end = at + 1 < processes.length ? processes[at + 1].line - 1 : lines.length;
    const steps = process.steps.filter((step) => step.feature !== null && step.operation !== null)
      .map((step) => ({ feature: step.feature, operation: step.operation, line: step.line }));
    return {
      id: `P${at + 1}`,
      n: at + 1,
      title: process.name,
      line: process.line,
      steps,
      features: [...new Set(steps.map((step) => step.feature))],
      cites: specsOf(lines.slice(process.line - 1, end).join('\n')),
    };
  });
  return { state: 'ok', items };
}

/**
 * `{ defects, design, processes }` of a run. `chapters`: a Map of chapter name -> `{ text, record }` (the loaded run's, or `diskChapters`);
 * `map`: the parsed map.json or null; `strings`: the run's fixed text.
 */
export function itemNumbers({ outDir, map, chapters, strings }) {
  return { defects: defectNumbers(chapters, strings), design: designNumbers(outDir, map, chapters, strings), processes: processNumbers(chapters) };
}

const memo = new WeakMap();

/** `itemNumbers` of a loaded Markdown run (md-run.mjs), computed once per run. */
export function runNumbers(run) {
  if (!memo.has(run)) memo.set(run, itemNumbers({ outDir: run.outDir, map: run.map, chapters: run.chapters, strings: run.ui }));
  return memo.get(run);
}

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * The chapters `names` that exist under `<outDir>/chapters`, as `itemNumbers` takes them, for a caller that has no loaded run
 * (`check`, `remedies-inputs`): `state` is the parsed state.json (or null); a chapter whose bytes are not the ones its record
 * names gets a failed record, so an unchecked or edited chapter is "failed", never read as passed.
 */
export function diskChapters(outDir, names, state) {
  const out = new Map();
  for (const name of names) {
    const path = join(outDir, 'chapters', `${name}.md`);
    if (!existsSync(path)) continue;
    const bytes = readFileSync(path);
    const record = state?.chapters?.[name];
    out.set(name, { text: bytes.toString('utf-8'), record: record !== undefined && record.sha256 === sha(bytes) ? record : { status: 'failed' } });
  }
  return out;
}

/** The map.json of `outDir` as a value, or null when it is missing or unreadable. */
export function readMapOrNull(outDir) {
  const read = readJson(join(outDir, 'map.json'));
  return read.ok && Array.isArray(read.value?.features) ? read.value : null;
}
