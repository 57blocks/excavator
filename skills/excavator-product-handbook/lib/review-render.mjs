/**
 * `review render <out> [<batch>...]` (openspec change handbook-design-review, D3): the items a writer wrote
 * to entries/review/<batch>.json are checked against the chapters they cite, and the chapter
 * chapters/review.md is generated from them. A writer names its own batch to validate it and nothing else is
 * written; with no batch named every batch of the facts file is validated and, when all pass, the chapter is
 * written. Every refusal is one line naming the batch, the item (counted from 0) and the rule.
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { memberDirectories } from './banned-words.mjs';
import { citationGroups, specKey } from './chapter-cites.mjs';
import { readerTextReasons } from './chapter-lint.mjs';
import { sentencesOf } from './chapter-sentences.mjs';
import { isObject, readJson, writeTextAtomic } from './json-file.mjs';
import { CROSS_BATCH, FACTS_FILE } from './review-batches.mjs';
import { loadUi } from './ui.mjs';
import { adviceWordsOf } from './word-lists.mjs';

export const REVIEW_DIR = 'entries/review';
export const DIMENSIONS = Object.freeze(['duplication', 'contradiction', 'complexity', 'redundancy', 'dead-end', 'inconsistency', 'manual', 'access', 'traceability', 'other']);
export const IMPACTS = Object.freeze(['high', 'medium', 'low']);
const TWO_PLACE = new Set(['duplication', 'contradiction', 'inconsistency', 'access']);
const ITEM_KEYS = ['dimension', 'impact', 'features', 'title', 'situation', 'consequence', 'cites'];
const WIDE_STOPS = String.fromCharCode(0x3002, 0xff01, 0xff1f);
const LIST_MARKER = /^\s*(?:[-*]|\d+\.)\s+/;
const STOP_END = new RegExp(`[.!?${WIDE_STOPS}]+$`);
const range = (from, to) => `${String.fromCharCode(from)}-${String.fromCharCode(to)}`;
const CJK = new RegExp(`[${range(0x3000, 0x303f)}${range(0x3040, 0x30ff)}${range(0x4e00, 0x9fff)}${range(0xff00, 0xffef)}]`);
const CJK_END = new RegExp(`${CJK.source}$`);

export const batchFile = (batch) => `${REVIEW_DIR}/${batch}.json`;

const isStrings = (value) => Array.isArray(value) && value.every((entry) => typeof entry === 'string');
const digitRuns = (text) => text.match(/\d+/g) ?? [];

/** The facts file, the map, the fixed text and the chapters a render reads; `{ ok: false, lines }` when one is missing. */
export function reviewContext(outDir, root) {
  const factsRead = readJson(join(outDir, FACTS_FILE));
  if (!factsRead.ok) return { ok: false, lines: [`${FACTS_FILE} ${factsRead.reason}; run review facts first`] };
  const mapRead = readJson(join(outDir, 'map.json'));
  if (!mapRead.ok) return { ok: false, lines: [`map.json ${mapRead.reason}`] };
  const ui = loadUi(outDir);
  if (!ui.ok) return { ok: false, lines: ui.lines };
  const facts = factsRead.value;
  const chapters = new Map();
  const chapterOf = (id) => {
    if (!chapters.has(id)) {
      const path = join(outDir, 'chapters', `${id}.md`);
      const lines = existsSync(path) ? readFileSync(path, 'utf-8').replace(/\r\n?/g, '\n').split('\n') : null;
      const index = new Map();
      (lines ?? []).forEach((line, at) => {
        for (const group of citationGroups(line)) {
          for (const spec of group.specs) {
            const key = specKey(spec);
            if (!index.has(key)) index.set(key, []);
            if (!index.get(key).includes(at)) index.get(key).push(at);
          }
        }
      });
      chapters.set(id, { lines, index });
    }
    return chapters.get(id);
  };
  return {
    ok: true,
    outDir,
    facts,
    map: mapRead.value,
    strings: ui.strings,
    advice: adviceWordsOf(ui.strings),
    memberDirs: memberDirectories(root),
    ids: mapRead.value.features.map((feature) => feature.id),
    chapterOf,
  };
}

/** The numbers of the counts of one feature in the facts file. */
function factNumbers(entry) {
  if (entry === undefined || entry.chapter !== true) return [];
  return [entry.operations, ...entry.steps, entry.states, entry.transitions, entry.serverSteps, entry.handovers].map(String);
}

/** The reasons item `item` of `batch` is refused; empty when it holds. */
function itemReasons(ctx, batch, item) {
  const reasons = [];
  const add = (reason) => reasons.push(reason);
  if (!isObject(item) || Object.keys(item).length !== ITEM_KEYS.length || !ITEM_KEYS.every((key) => Object.hasOwn(item, key))) {
    return [`the item must be an object with exactly the keys ${ITEM_KEYS.join(', ')}`];
  }
  if (!DIMENSIONS.includes(item.dimension)) add(`dimension ${JSON.stringify(item.dimension)} is not one of ${DIMENSIONS.join(', ')}`);
  if (!IMPACTS.includes(item.impact)) add(`impact ${JSON.stringify(item.impact)} is not one of ${IMPACTS.join(', ')}`);
  for (const key of ['title', 'situation', 'consequence']) {
    if (typeof item[key] !== 'string' || item[key].trim() === '') add(`${key} must be a non-empty text`);
  }
  if (!isStrings(item.features) || item.features.length === 0) add('features must be a non-empty list of feature ids');
  if (!isStrings(item.cites) || item.cites.length === 0) add('cites must be a non-empty list of citations');
  if (reasons.length > 0) return reasons;

  const unknown = item.features.filter((id) => !ctx.ids.includes(id));
  if (unknown.length > 0) add(`features ${unknown.join(', ')} are not in the map`);
  if (new Set(item.features).size !== item.features.length) add('features lists a feature more than once');
  const known = item.features.filter((id) => ctx.ids.includes(id));
  const batchOf = (id) => ctx.facts.features[id]?.batch ?? null;
  if (batch.id === CROSS_BATCH) {
    const spanned = new Set(known.map(batchOf));
    if (spanned.size < 2) add(`a cross item lists features of ${spanned.size} batch${spanned.size === 1 ? ` (${[...spanned][0]})` : 'es'}; it needs features of 2 or more batches`);
  } else {
    const outside = known.filter((id) => !batch.features.includes(id));
    if (outside.length > 0) add(`features ${outside.join(', ')} are not in batch ${batch.id}; an item across batches belongs to the ${CROSS_BATCH} batch`);
  }

  // Where each cite occurs: a chapter line of one of the listed features.
  const lines = new Set();
  const citedText = [];
  for (const cite of item.cites) {
    const key = specKey(cite.trim());
    let found = false;
    for (const id of known) {
      const chapter = ctx.chapterOf(id);
      for (const at of chapter.index.get(key) ?? []) {
        found = true;
        lines.add(`${id}:${at}`);
        citedText.push(chapter.lines[at]);
      }
    }
    if (!found) add(`cite ${JSON.stringify(cite)} does not occur in a chapter of the features it lists (${known.join(', ')}); copy it from a chapter line`);
  }
  if (TWO_PLACE.has(item.dimension) && lines.size < 2) add(`a ${item.dimension} item needs citations from 2 different chapter lines; its citations are on ${lines.size}`);

  const allowed = new Set([
    ...citedText.flatMap((line) => digitRuns(citationGroups(line).reduceRight((text, group) => `${text.slice(0, group.start)} ${text.slice(group.end)}`, line).replace(LIST_MARKER, ''))),
    ...known.flatMap((id) => factNumbers(ctx.facts.features[id])),
  ]);
  const idToken = new RegExp(`\\b(?:${ctx.ids.map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'g');
  for (const key of ['title', 'situation', 'consequence']) {
    const text = item[key];
    if (text.includes('`') || citationGroups(text).length > 0) add(`${key} holds a backtick or a citation group; write plain reader text, the citations are added by the script`);
    if (/\n/.test(text)) add(`${key} holds a line break; write one line`);
    if (key !== 'title' && sentencesOf(text).filter((sentence) => sentence.words).length > 1) add(`${key} holds more than one sentence; write one`);
    for (const reason of readerTextReasons(text, { advice: ctx.advice, memberDirs: ctx.memberDirs })) add(`${key}: ${reason}`);
    for (const run of new Set(digitRuns(text.replace(idToken, ' ')))) {
      if (!allowed.has(run)) add(`the number ${run} in ${key} is in no cited chapter line and in no fact of the features it lists`);
    }
  }
  return reasons;
}

/** `{ reasons, items }` of one batch file; `items` are the items as written when none is refused. */
export function validateBatch(ctx, batch) {
  const read = readJson(join(ctx.outDir, batchFile(batch.id)));
  if (!read.ok) return { reasons: [`${batch.id}: ${batchFile(batch.id)} ${read.reason}`], items: [] };
  if (!isObject(read.value) || Object.keys(read.value).length !== 1 || !Array.isArray(read.value.items)) {
    return { reasons: [`${batch.id}: ${batchFile(batch.id)} must be an object with exactly the key "items", a list`], items: [] };
  }
  const reasons = [];
  read.value.items.forEach((item, at) => {
    for (const reason of itemReasons(ctx, batch, item)) reasons.push(`${batch.id} item ${at}: ${reason}`);
  });
  return { reasons, items: read.value.items };
}

/** The citation group of `cites` after `text`: full-width brackets and full stop when the run's text, or the text before the group, is in a script without spaces. */
function cited(text, cites, wide) {
  const body = text.trim().replace(STOP_END, '');
  const list = [...new Set(cites.map((cite) => `\`${specKey(cite.trim())}\``))].join('; ');
  return wide || CJK_END.test(body)
    ? `${body}${String.fromCharCode(0xff08)}${list}${String.fromCharCode(0xff09, 0x3002)}`
    : `${body} (${list}).`;
}

/** The text of chapters/review.md for `batches` (`[{ batch, items }]` in batch order). */
export function reviewChapterText(ctx, batches) {
  const t = (key) => ctx.strings[`chapter.review.${key}`];
  // A run whose fixed text is in a script without spaces (Chinese, Japanese) gets full-width punctuation on every line.
  const wide = CJK.test(t('title'));
  const colon = wide ? String.fromCharCode(0xff1a) : ': ';
  const semicolon = wide ? String.fromCharCode(0xff1b) : '; ';
  const flat = batches.flatMap(({ items }, position) => items.map((item, at) => ({ item, position, at })));
  const rank = (list, value) => list.indexOf(value);
  flat.sort((x, y) => rank(DIMENSIONS, x.item.dimension) - rank(DIMENSIONS, y.item.dimension)
    || rank(IMPACTS, x.item.impact) - rank(IMPACTS, y.item.impact) || x.position - y.position || x.at - y.at);
  const nameOf = (id) => `${ctx.map.features.find((feature) => feature.id === id)?.name ?? id} (${id})`;
  const out = [`# ${t('title')}`, '', `## ${t('counts')}`, ''];
  out.push(`| ${[t('field.dimension'), ...IMPACTS.map((impact) => t(`impact.${impact}`))].join(' | ')} |`);
  out.push(`| ${['---', ...IMPACTS.map(() => '---')].join(' | ')} |`);
  for (const dimension of DIMENSIONS) {
    const counts = IMPACTS.map((impact) => flat.filter(({ item }) => item.dimension === dimension && item.impact === impact).length);
    out.push(`| ${[t(`dimension.${dimension}`), ...counts].join(' | ')} |`);
  }
  out.push('');
  if (flat.length === 0) out.push(ctx.strings['chapter.none'], '');
  let current = null;
  for (const { item } of flat) {
    if (item.dimension !== current) {
      current = item.dimension;
      out.push(`## ${t(`dimension.${current}`)}`, '');
    }
    const features = item.features.map(nameOf).join(wide ? String.fromCharCode(0x3001) : ', ');
    out.push(`### ${item.title.trim()}`, '');
    out.push(cited(`${t('field.impact')}${colon}${t(`impact.${item.impact}`)}${semicolon}${t('field.features')}${colon}${features}`, item.cites, wide), '');
    out.push(cited(`${t('field.situation')}${colon}${item.situation}`, item.cites, wide), '');
    out.push(cited(`${t('field.consequence')}${colon}${item.consequence}`, item.cites, wide), '');
  }
  return `${out.join('\n').trimEnd()}\n`;
}

/** `review render <out> [<batch>...]`. Returns { status, lines }. */
export function renderReview(outDir, root, named) {
  const ctx = reviewContext(outDir, root);
  if (!ctx.ok) return { status: 1, lines: ctx.lines };
  const all = ctx.facts.batches;
  const unknown = named.filter((id) => !all.some((batch) => batch.id === id));
  if (unknown.length > 0) return { status: 1, lines: [`${unknown.join(', ')} ${unknown.length === 1 ? 'is' : 'are'} not a batch; the batches are ${all.map((batch) => batch.id).join(', ')}`] };
  const wanted = named.length > 0 ? all.filter((batch) => named.includes(batch.id)) : all;
  const lines = [];
  const reasons = [];
  const valid = [];
  for (const batch of wanted) {
    const result = validateBatch(ctx, batch);
    reasons.push(...result.reasons);
    if (result.reasons.length === 0) {
      lines.push(`${batch.id}: ok (${result.items.length} items)`);
      valid.push({ batch, items: result.items });
    }
  }
  if (reasons.length > 0) return { status: 1, lines: [...reasons, 'Next: fix the items named above in their batch file and run review render again'] };
  if (named.length > 0) return { status: 0, lines };
  mkdirSync(join(outDir, 'chapters'), { recursive: true });
  const path = join(outDir, 'chapters', 'review.md');
  writeTextAtomic(path, reviewChapterText(ctx, valid));
  return { status: 0, lines: [...lines, `Chapter: ${path} (${valid.reduce((sum, entry) => sum + entry.items.length, 0)} items)`, 'Next: check the review chapter'] };
}
