/**
 * The defect items of chapters/defects.md (openspec change handbook-page-structure, design D2):
 * one parser shared by `check defects` and the page, so a chapter that passes the check can be split.
 * `defectsReasons` is what `check defects` adds to the chapter's own reasons.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const DEFECT_LEVELS = Object.freeze(['P0', 'P1', 'P2']);
export const DEFECT_CATEGORIES = Object.freeze([
  'authorization', 'error-handling', 'notification', 'consistency', 'calculation', 'hard-coded', 'contract', 'security', 'display', 'time', 'other',
]);

const FENCE = /^\s*```/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const LIST_ITEM = /^ {0,3}[-*+]\s+(.*)$/;
/** An item of a section list: a bullet or a numbered item (`1.` or `1)`); writers number open questions as often as they bullet them. */
const SECTION_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])\s+(.*)$/;
const CATEGORY = /^\*\*([^*]+)\*\*/;
/** The bold short title right after the bold category (design D20): `- **category** **title** text`. */
const TITLE = /^\*\*[^*]+\*\*\s*\*\*([^*]+)\*\*/;
/** The longest title `check defects` accepts, in characters (code points): 20 CJK characters or 8 words fit with room to spare. */
export const DEFECT_TITLE_LIMIT = 40;
const OPEN = `[(${String.fromCharCode(0xff08)}]`;
const CLOSE = `[)${String.fromCharCode(0xff09)}]`;
const FEATURE_ID = new RegExp(`${OPEN}\\s*(F\\d+|system)\\s*${CLOSE}`, 'g');

/** Lines of `text` outside fences and table rows: `{ raw, line }` (1-based line number). */
function proseLines(text) {
  const out = [];
  let fenced = false;
  text.split('\n').forEach((raw, index) => {
    if (FENCE.test(raw)) fenced = !fenced;
    else if (!fenced && !/^\s*\|/.test(raw)) out.push({ raw, line: index + 1 });
  });
  return out;
}

const featuresOf = (text) => [...new Set(Array.from(text.matchAll(FEATURE_ID), (found) => found[1]))];

/** `{ items, problems }` of a defects chapter; `none` is the run's fixed text of an empty level. */
export function parseDefects(text, { none = '' } = {}) {
  const items = [];
  const problems = [];
  let level = null;
  let current = null;
  let blankSince = false;
  const finish = () => {
    if (current === null) return;
    const { line, parts } = current;
    current = null;
    const body = parts.join(' ').trim();
    if (none !== '' && body === none) return;
    const found = CATEGORY.exec(body);
    if (level === null && found === null) return;
    const word = found === null ? null : found[1].trim();
    const known = word !== null && DEFECT_CATEGORIES.includes(word);
    const features = featuresOf(body);
    const missing = [];
    if (level === null) missing.push('level');
    if (!known) missing.push('category');
    if (features.length === 0) missing.push('feature');
    const titled = TITLE.exec(body);
    const title = titled === null ? null : titled[1].trim();
    if (missing.length === 0) items.push({ level, category: word, title: title === '' ? null : title, features, text: body, line });
    else problems.push({ line, missing, ...(word !== null && !known ? { category: word } : {}) });
  };
  for (const { raw, line } of proseLines(text)) {
    const heading = HEADING.exec(raw);
    const bullet = LIST_ITEM.exec(raw);
    if (heading !== null) {
      finish();
      if (heading[1].length <= 2) level = heading[1].length === 2 && DEFECT_LEVELS.includes(heading[2].trim()) ? heading[2].trim() : null;
      blankSince = false;
    } else if (bullet !== null) {
      finish();
      current = { line, parts: [bullet[1]] };
      blankSince = false;
    } else if (raw.trim() === '') {
      blankSince = current !== null;
    } else if (current !== null && (!blankSince || /^\s{2,}/.test(raw))) {
      current.parts.push(raw.trim());
      blankSince = false;
    } else {
      finish();
      blankSince = false;
    }
  }
  finish();
  return { items, problems };
}

/**
 * The list items, bulleted or numbered (the fixed none text excluded), of the section of `text` headed exactly `title`, level 2 or 3, as `{ text, line }` (1-based line), or null when no heading equals `title`.
 * A section ends at the next heading of the same or a higher level; an item continues on following lines like a defect item does.
 */
export function sectionItems(text, title, none) {
  let depth = 0;
  let found = false;
  const items = [];
  let current = null;
  let blankSince = false;
  const finish = () => {
    if (current === null) return;
    const body = current.parts.join(' ').trim();
    if (body !== none) items.push({ text: body, line: current.line });
    current = null;
  };
  for (const { raw, line } of proseLines(text)) {
    const heading = HEADING.exec(raw);
    if (heading !== null) {
      finish();
      blankSince = false;
      const own = heading[1].length;
      if (depth > 0 && own <= depth) depth = 0;
      if (depth === 0 && (own === 2 || own === 3) && heading[2].trim() === title) {
        depth = own;
        found = true;
      }
    } else if (depth > 0) {
      const bullet = SECTION_ITEM.exec(raw);
      if (bullet !== null) {
        finish();
        current = { line, parts: [bullet[1]] };
        blankSince = false;
      } else if (raw.trim() === '') {
        blankSince = current !== null;
      } else if (current !== null && (!blankSince || /^\s{2,}/.test(raw))) {
        current.parts.push(raw.trim());
        blankSince = false;
      } else {
        finish();
        blankSince = false;
      }
    }
  }
  finish();
  return found ? items : null;
}

const sectionItemCount = (text, title, none) => (sectionItems(text, title, none) ?? []).length;

/** The reasons of an item's title: none, too long, or the start of the sentence after it (a title names the defect; it does not repeat the sentence). */
/**
 * The reasons a short bold title fails (designs D20, D21): none, longer than `DEFECT_TITLE_LIMIT` code points, or the start of
 * the text after it. `what` and `noun` name the item in the reasons; `missing` is the reason when there is no title.
 */
function shortTitleReasons({ line, title, after, what, noun, missing }) {
  if (title === null) return [`line ${line}: ${missing}`];
  const reasons = [];
  const length = Array.from(title).length;
  if (length > DEFECT_TITLE_LIMIT) reasons.push(`line ${line}: the title of the ${what} has ${length} characters; at most ${DEFECT_TITLE_LIMIT}`);
  if (after.startsWith(title.replace(/[.\u3002]$/u, ''))) reasons.push(`line ${line}: the title of the ${what} is the start of its sentence; a title names the ${noun} in other words`);
  return reasons;
}

const titleReasons = ({ line, title, text }) => shortTitleReasons({ line, title, after: text.replace(TITLE, '').trim(), what: 'defect item', noun: 'defect', missing: 'defect item has no short bold title after its category, like **category** **title** text' });

const OPEN_TITLE = /^\*\*([^*]+)\*\*/;

/** The short bold title an open question starts with, or null (design D21). */
export const openQuestionTitle = (text) => OPEN_TITLE.exec(text)?.[1].trim() ?? null;

/** The text of an open question after its short bold title. */
export const afterOpenQuestionTitle = (text) => text.replace(OPEN_TITLE, '').trim();

/**
 * The reasons for the open questions of a feature or system chapter (design D21): every item under the heading `title`
 * starts with a short bold title. The items are taken as the problems page takes them; no heading, no reasons.
 */
export function openQuestionsReasons(text, title, none) {
  return (sectionItems(text, title, none) ?? []).flatMap((item) => shortTitleReasons({
    line: item.line, title: openQuestionTitle(item.text), after: afterOpenQuestionTitle(item.text), what: 'open question', noun: 'question', missing: 'open question has no short bold title at its start, like **title** text',
  }));
}

function problemReason({ line, missing, category }) {
  const parts = missing.map((what) => {
    if (what === 'level') return 'it is not under a P0, P1 or P2 heading';
    if (what === 'feature') return 'it names no feature id like (F7) or (system)';
    return category === undefined
      ? 'it does not start with a bold category word'
      : `the category "${category}" is not in the fixed list (${DEFECT_CATEGORIES.join(', ')})`;
  });
  return `line ${line}: defect item cannot be split: ${parts.join('; ')}`;
}

/** The reasons `check defects` adds: unsplittable items, ids not on the map, features whose problems section has items no defect mentions. */
export function defectsReasons(outDir, text, ids, strings) {
  const none = strings['chapter.none'];
  const { items, problems } = parseDefects(text, { none });
  const reasons = problems.map(problemReason);
  for (const item of items) {
    reasons.push(...titleReasons(item));
    for (const id of item.features) {
      if (id !== 'system' && !ids.includes(id)) reasons.push(`line ${item.line}: feature id ${id} is not a feature of map.json`);
    }
  }
  const mentioned = new Set(items.flatMap((item) => item.features));
  for (const id of ['system', ...ids]) {
    const path = join(outDir, 'chapters', `${id}.md`);
    if (!existsSync(path)) continue;
    const count = sectionItemCount(readFileSync(path, 'utf-8'), strings['chapter.problems'], none);
    if (count > 0 && !mentioned.has(id)) {
      reasons.push(`${id}: its "${strings['chapter.problems']}" section has ${count} item${count === 1 ? '' : 's'} but no defect item names ${id}`);
    }
  }
  return reasons;
}
