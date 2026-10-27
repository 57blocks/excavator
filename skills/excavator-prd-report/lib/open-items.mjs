/**
 * The open items of a PRD run (openspec change prd-report-dedupe, design D5).
 * `openItemSources` lists the items of every written chapter's open items
 * section, numbered, with a digest of the list; a merge subagent writes
 * `open-items/merged.json` (groups of items that ask the same question, with
 * the one to keep), `mergeProblems` checks it against the list, and
 * `mergedRows` gives the rows of the open items table. All of it is
 * deterministic and reads only the run's files: the model never transcribes
 * an item, and the text of a row is always the text of a chapter.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { byChapter, splitChapter } from './chapter.mjs';
import { WRITTEN_STATUSES } from './index-check.mjs';
import { isObject, isString } from './json-file.mjs';
import { chapterPath } from './lane-check.mjs';
import { DELIMITER_CELL, tableCells } from './table-shape.mjs';

export const OPEN_ITEMS_DIR = 'open-items';
export const SOURCES_FILE = `${OPEN_ITEMS_DIR}/sources.json`;
export const MERGED_FILE = `${OPEN_ITEMS_DIR}/merged.json`;
/** Joins the cells of a row that is not three cells wide into one item. */
const CELL_JOINER = ' — ';
const LIST_ITEM = /^(?:[-*]|\d+\.)[ \t]+(.*)$/;

/** Item texts of the table rows in `lines` (header and delimiter rows left out); empty when no table has a delimiter row. */
function tableItems(lines) {
  const items = [];
  let run = [];
  const flush = () => {
    if (run.length >= 2 && tableCells(run[1]).every((cell) => DELIMITER_CELL.test(cell))) {
      for (const line of run.slice(2)) {
        const cells = tableCells(line);
        items.push(cells.length === 3
          ? { item: cells[0], known: cells[1], searched: cells[2] }
          : { item: cells.join(CELL_JOINER), known: '', searched: '' });
      }
    }
    run = [];
  };
  for (const line of lines) {
    if (line.trim().startsWith('|')) run.push(line);
    else flush();
  }
  flush();
  return items;
}

/** The top-level list items of `lines`; a line indented under an item, or following it without a blank line, continues it. */
function listItems(lines) {
  const items = [];
  let current = null;
  let blank = false;
  for (const line of lines) {
    const start = LIST_ITEM.exec(line);
    if (start) {
      current = { item: start[1].trim(), known: '', searched: '' };
      items.push(current);
      blank = false;
    } else if (line.trim() === '') {
      blank = true;
    } else if (current !== null && (/^\s/.test(line) || !blank)) {
      current.item = `${current.item} ${line.trim()}`.trim();
      blank = false;
    } else {
      current = null;
    }
  }
  return items;
}

/** The items of one open items section: table rows, else list items, else the whole section as one. */
function sectionItems(section) {
  const lines = section.replace(/\r\n/g, '\n').split('\n');
  const rows = tableItems(lines);
  if (rows.length > 0) return rows;
  const listed = listItems(lines);
  if (listed.length > 0) return listed;
  const text = lines.map((line) => line.trim()).filter((line) => line !== '').join(' ');
  return text === '' ? [] : [{ item: text, known: '', searched: '' }];
}

/**
 * The open items of the written features of `index` (status checked or
 * verified, in chapter order) whose chapter in `outDir` splits and has an open
 * items section, each as `{ id, feature, item, known, searched }` with the id
 * `<feature id>.<n>`, n counted from 1 in the feature.
 * @returns {{ digest: string, items: object[] }} `digest` is the sha256 of the items as JSON
 */
export function openItemSources(outDir, index) {
  const items = [];
  const written = index.features.filter((feature) => WRITTEN_STATUSES.includes(feature.status)).sort(byChapter);
  for (const feature of written) {
    const path = join(outDir, chapterPath(feature.id));
    if (!existsSync(path)) continue;
    const split = splitChapter(readFileSync(path, 'utf-8'));
    if (!split.ok || split.openItems === null) continue;
    sectionItems(split.openItems).forEach((entry, at) => {
      items.push({ id: `${feature.id}.${at + 1}`, feature: feature.id, item: entry.item, known: entry.known, searched: entry.searched });
    });
  }
  return { digest: createHash('sha256').update(JSON.stringify(items)).digest('hex'), items };
}

const GROUP_SHAPE = 'keep and also must be an id and a non-empty list of ids';

/**
 * The problems of the parsed `merged.json` `merged` against `sources` (the
 * result of `openItemSources`), one line each, none when the merge passes.
 * The shape is `{ digest, groups: [ { keep, also: [ ... ] } ] }` and nothing
 * else; the digest is the sources' digest; every id is an open item and is in
 * one group once, as keep or in also.
 * @returns {string[]}
 */
export function mergeProblems(merged, sources) {
  if (!isObject(merged) || typeof merged.digest !== 'string' || !Array.isArray(merged.groups)) {
    return [`${MERGED_FILE} is not an object with digest and groups`];
  }
  const unread = new Set();
  const noteKeys = (value, allowed) => {
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) unread.add(key);
    }
  };
  noteKeys(merged, ['digest', 'groups']);
  const shapeProblems = [];
  const shaped = merged.groups.map((group, at) => {
    if (isObject(group)) noteKeys(group, ['keep', 'also']);
    const ok = isObject(group) && isString(group.keep) && Array.isArray(group.also) && group.also.length > 0 && group.also.every(isString);
    if (!ok) shapeProblems.push(`group ${at + 1}: ${GROUP_SHAPE}`);
    return ok ? group : null;
  });
  const problems = [...[...unread].map((key) => `${MERGED_FILE} has the key ${key}, which is not read`), ...shapeProblems];
  if (merged.digest !== sources.digest) {
    problems.push(`${MERGED_FILE} was written for other open items; merge them again`);
    return problems;
  }

  const known = new Set(sources.items.map((item) => item.id));
  const seen = new Set();
  const repeated = new Set();
  shaped.forEach((group, at) => {
    if (group === null) return;
    const n = at + 1;
    for (const [role, id] of [['keep', group.keep], ...group.also.map((also) => ['also', also])]) {
      if (!known.has(id)) {
        problems.push(`group ${n}: ${id} is not an open item`);
      } else if (role === 'also' && id === group.keep) {
        if (!repeated.has(`${n} ${id}`)) problems.push(`group ${n}: ${id} is both keep and also`);
        repeated.add(`${n} ${id}`);
      } else if (seen.has(id)) {
        if (!repeated.has(id)) problems.push(`${id} is in more than one group`);
        repeated.add(id);
      } else {
        seen.add(id);
      }
    }
  });
  return problems;
}

const unmergedRow = (item) => ({ item: item.item, known: item.known, searched: item.searched, features: [item.feature], also: [] });

/**
 * The rows of the open items table: one for each item when `merged` is null or
 * has problems; else one for each group, with the text of its keep item, at the
 * place of the group's earliest member in the sources, and one for each item
 * in no group. `features` are the distinct features of a row's items, in
 * source order. `also` lists the other members of a merged row (every member
 * but keep, in source order) as `{ feature, item }`, so a wrongly merged item
 * stays visible (design D8); it is empty for a row of one item.
 * @returns {{ item: string, known: string, searched: string, features: string[], also: { feature: string, item: string }[] }[]}
 */
export function mergedRows(sources, merged) {
  if (merged === null || mergeProblems(merged, sources).length > 0) return sources.items.map(unmergedRow);
  const at = new Map(sources.items.map((item, position) => [item.id, position]));
  const groupOf = new Map();
  for (const group of merged.groups) {
    const members = [group.keep, ...group.also].map((id) => at.get(id)).sort((a, b) => a - b);
    const entry = { first: members[0], keep: sources.items[at.get(group.keep)], members };
    for (const member of members) groupOf.set(member, entry);
  }
  const rows = [];
  sources.items.forEach((item, position) => {
    const group = groupOf.get(position);
    if (group === undefined) {
      rows.push(unmergedRow(item));
    } else if (group.first === position) {
      const { keep } = group;
      const features = [...new Set(group.members.map((member) => sources.items[member].feature))];
      const also = group.members.filter((member) => sources.items[member] !== keep).map((member) => ({ feature: sources.items[member].feature, item: sources.items[member].item }));
      rows.push({ item: keep.item, known: keep.known, searched: keep.searched, features, also });
    }
  });
  return rows;
}

/**
 * The state of `open-items/merged.json` for `sources`: `{ merged, problems,
 * passing }`. Fewer than two items need no merge, so the file is not read and
 * the state passes. Otherwise a missing or unparseable file and every
 * `mergeProblems` line are problems; `merged` is the parsed file only when it
 * passes.
 */
export function readMerge(outDir, sources) {
  if (sources.items.length < 2) return { merged: null, problems: [], passing: true };
  let text;
  try {
    text = readFileSync(join(outDir, MERGED_FILE), 'utf-8');
  } catch (error) {
    if (error.code === 'ENOENT') return { merged: null, problems: [`${MERGED_FILE} is missing`], passing: false };
    throw error;
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { merged: null, problems: [`${MERGED_FILE} is not valid JSON: ${error.message}`], passing: false };
  }
  const problems = mergeProblems(value, sources);
  return { merged: problems.length === 0 ? value : null, problems, passing: problems.length === 0 };
}

/**
 * Everything `aggregate` and `check-open-items` say about the open items of
 * the run, from one computation: the sources, the merge state, the table rows
 * and the status line for the coverage section.
 */
export function openItemsOutcome(outDir, index) {
  const sources = openItemSources(outDir, index);
  const merge = readMerge(outDir, sources);
  const rows = mergedRows(sources, merge.merged);
  const written = sources.items.length;
  let line = `Open items: ${written} written in the chapters, not merged`;
  if (written === 0) line = 'Open items: none written in the chapters';
  else if (merge.passing) line = `Open items: ${written} written in the chapters, ${rows.length} after merging`;
  return { sources, merge, rows, line };
}
