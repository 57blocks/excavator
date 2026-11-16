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
const CATEGORY = /^\*\*([^*]+)\*\*/;
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
    if (missing.length === 0) items.push({ level, category: word, features, text: body, line });
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

/** The number of list items (the fixed none text excluded) in the section of `text` headed exactly `title`, level 2 or 3. */
function sectionItemCount(text, title, none) {
  let depth = 0;
  let count = 0;
  for (const { raw } of proseLines(text)) {
    const heading = HEADING.exec(raw);
    if (heading !== null) {
      const own = heading[1].length;
      if (depth > 0 && own <= depth) depth = 0;
      if (depth === 0 && (own === 2 || own === 3) && heading[2].trim() === title) depth = own;
    } else if (depth > 0) {
      const bullet = LIST_ITEM.exec(raw);
      if (bullet !== null && bullet[1].trim() !== none) count += 1;
    }
  }
  return count;
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
