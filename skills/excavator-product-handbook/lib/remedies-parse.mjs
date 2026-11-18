/**
 * The blocks of the remedies chapter as the check, the coverage section and the page read them (openspec change
 * handbook-process-review, design D11): every paragraph and every list item, with its line, the id groups `[D3, R12]` it holds,
 * the citations it carries and the level-2 heading above it. The chapter's shape is a writing instruction, not parsed here.
 */

import { citationGroups, specKey } from './chapter-cites.mjs';

const FENCE = /^\s*```/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const LIST = /^ {0,3}(?:[-*+]|\d{1,9}[.)])\s+(.*)$/;
const ID = '[DRP]\\d+';
const COMMA = `[,${String.fromCharCode(0xff0c)}]`;
/** An id group: `[` + ids separated by a comma (ASCII or full-width) and optional spaces + `]`. */
const ID_GROUP = new RegExp(`\\[\\s*(${ID}(?:\\s*${COMMA}\\s*${ID})*)\\s*\\]`, 'g');
const ID_SPLIT = new RegExp(`\\s*${COMMA}\\s*`);

/** The id groups of `text`, each as the list of its ids. */
export const idGroupsOf = (text) => Array.from(text.matchAll(ID_GROUP), (match) => match[1].split(ID_SPLIT));

/**
 * `{ headings, items }` of `text`. A heading is `{ level, text, line, page }` (`page`: its index among the `##` and `###` headings,
 * the way the page counts them, else null). An item (a paragraph or a list item) is `{ line, text, groups, ids, cites, section }`
 * (`section`: the last level-2 heading above it, or null).
 */
export function parseRemedies(text) {
  const headings = [];
  const items = [];
  let section = null;
  let current = null;
  let fenced = false;
  let page = 0;
  const finish = () => {
    if (current === null) return;
    const body = current.parts.join(' ').trim();
    const groups = idGroupsOf(body);
    items.push({
      line: current.line,
      text: body,
      groups,
      ids: groups.flat(),
      cites: [...new Set(citationGroups(body).flatMap((group) => group.specs.map(specKey)))],
      section: current.section,
    });
    current = null;
  };
  text.replace(/\r\n?/g, '\n').split('\n').forEach((raw, index) => {
    const line = index + 1;
    if (FENCE.test(raw)) {
      finish();
      fenced = !fenced;
      return;
    }
    if (fenced) return;
    const heading = HEADING.exec(raw);
    const list = LIST.exec(raw);
    if (heading !== null) {
      finish();
      const level = heading[1].length;
      const entry = { level, text: heading[2].trim(), line, page: level === 2 || level === 3 ? page : null };
      if (level === 2 || level === 3) page += 1;
      headings.push(entry);
      if (level === 2) section = entry;
    } else if (list !== null) {
      finish();
      current = { line, parts: [list[1]], section };
    } else if (raw.trim() === '') {
      finish();
    } else if (current !== null) {
      current.parts.push(raw.trim());
    } else {
      current = { line, parts: [raw.trim()], section };
    }
  });
  finish();
  return { headings, items };
}

/** The ids that some block of the parsed chapter names. */
export const namedIds = (parsed) => new Set(parsed.items.flatMap((item) => item.ids));

const PROCESS_HEADING = /^(P\d+)(?:\s|$)/;

/** The process id (`P22`) a level-2 heading of the remedies chapter is the section of (`P22 <name>`), or null. */
export const processSectionId = (headingText) => PROCESS_HEADING.exec(headingText)?.[1] ?? null;
