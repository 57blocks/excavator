/**
 * The open items of a PRD run (openspec change prd-report-dedupe, design D5).
 * `openItemSources` lists the items of every written chapter's open items
 * section, numbered, with a digest of the list; a merge subagent writes
 * `open-items/merged.json` (groups of items that ask the same question, with
 * the one to keep), `mergeProblems` checks it against the list, a check
 * subagent writes `open-items/checked.json` (for each merged item, whether
 * answering the kept item answers it too; design D9), `checkedProblems`
 * checks that against the merge, and `mergedRows` gives the rows of the open
 * items table. All of it is
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
export const CHECKED_FILE = `${OPEN_ITEMS_DIR}/checked.json`;
/** Joins the cells of a row that is not three cells wide into one item. */
const CELL_JOINER = ' — ';
const LIST_ITEM = /^(?:[-*]|\d+\.)[ \t]+(.*)$/;

const isTableLine = (line) => line.trim().startsWith('|');
const textItem = (item) => ({ item, known: '', searched: '' });

/** The items of the data rows of the `|` lines `run`: none unless its second line is a delimiter row (the header and delimiter rows are no items). */
function tableRowItems(run) {
  if (run.length < 2 || !tableCells(run[1]).every((cell) => DELIMITER_CELL.test(cell))) return null;
  return run.slice(2).map((line) => {
    const cells = tableCells(line);
    return cells.length === 3
      ? { item: cells[0], known: cells[1], searched: cells[2] }
      : textItem(cells.join(CELL_JOINER));
  });
}

/**
 * The items of one open items section, in document order and with no text
 * left out: each data row of a delimited table; each top-level list item (a
 * line indented under it, or following it without a blank line, continues
 * it); and any other text, each run of it between those, joined into one item.
 */
function sectionItems(section) {
  const lines = section.replace(/\r\n/g, '\n').split('\n');
  const items = [];
  let list = null;
  let blank = false;
  let prose = [];
  const flushProse = () => {
    if (prose.length > 0) items.push(textItem(prose.join(' ')));
    prose = [];
  };
  const takeLine = (line) => {
    const start = LIST_ITEM.exec(line);
    if (start) {
      flushProse();
      list = textItem(start[1].trim());
      items.push(list);
      blank = false;
    } else if (line.trim() === '') {
      blank = true;
    } else if (list !== null && (/^\s/.test(line) || !blank)) {
      list.item = `${list.item} ${line.trim()}`.trim();
      blank = false;
    } else {
      list = null;
      prose.push(line.trim());
    }
  };
  for (let at = 0; at < lines.length;) {
    if (!isTableLine(lines[at])) {
      takeLine(lines[at]);
      at += 1;
      continue;
    }
    let end = at;
    while (end < lines.length && isTableLine(lines[end])) end += 1;
    const run = lines.slice(at, end);
    const rows = tableRowItems(run);
    if (rows === null) {
      run.forEach(takeLine);
    } else {
      flushProse();
      list = null;
      blank = false;
      items.push(...rows);
    }
    at = end;
  }
  flushProse();
  return items;
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

/** The `{ keep, id }` pairs of the merge, one for each member of an also list, in file order. */
const mergedPairs = (merged) => merged.groups.flatMap((group) => group.also.map((id) => ({ keep: group.keep, id })));
const pairKey = (keep, id) => JSON.stringify([keep, id]);

/**
 * The problems of the parsed `checked.json` `checked` against `merged` (a
 * merge that passes `mergeProblems`), one line each, none when the check
 * passes. The shape is `{ digest, members: [ { keep, id, same } ] }` and
 * nothing else; the digest is the merge's; there is exactly one member for
 * each (keep, also id) pair of the merge, and `same` is true or false.
 * @returns {string[]}
 */
export function checkedProblems(checked, merged) {
  if (!isObject(checked) || typeof checked.digest !== 'string' || !Array.isArray(checked.members)) {
    return [`${CHECKED_FILE} is not an object with digest and members`];
  }
  const unread = new Set();
  const noteKeys = (value, allowed) => {
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) unread.add(key);
    }
  };
  noteKeys(checked, ['digest', 'members']);
  const problems = [];
  const shaped = checked.members.map((member, at) => {
    if (isObject(member)) noteKeys(member, ['keep', 'id', 'same']);
    if (!isObject(member) || !isString(member.keep) || !isString(member.id)) {
      problems.push(`member ${at + 1}: keep and id must be ids`);
      return null;
    }
    if (typeof member.same !== 'boolean') problems.push(`member ${at + 1}: same must be true or false`);
    return member;
  });
  problems.unshift(...[...unread].map((key) => `${CHECKED_FILE} has the key ${key}, which is not read`));
  if (checked.digest !== merged.digest) {
    problems.push(`${CHECKED_FILE} was written for other open items; check them again`);
    return problems;
  }

  const wanted = new Set(mergedPairs(merged).map(({ keep, id }) => pairKey(keep, id)));
  const seen = new Set();
  const repeated = new Set();
  for (const member of shaped) {
    if (member === null) continue;
    const key = pairKey(member.keep, member.id);
    if (!wanted.has(key)) {
      if (!repeated.has(key)) problems.push(`${CHECKED_FILE} has a member for ${member.id} under ${member.keep}, which is not a pair of the merge`);
      repeated.add(key);
    } else if (seen.has(key)) {
      if (!repeated.has(key)) problems.push(`${CHECKED_FILE} has more than one member for ${member.id} under ${member.keep}`);
      repeated.add(key);
    } else {
      seen.add(key);
    }
  }
  for (const { keep, id } of mergedPairs(merged)) {
    if (!seen.has(pairKey(keep, id))) problems.push(`${CHECKED_FILE} has no member for ${id} under ${keep}`);
  }
  return problems;
}

/**
 * The rows of the open items table: one for each item when `merged` is null or
 * has problems, or when the merge has an also member and `checked` is null or
 * has problems; else one for each group, with the text of its keep item, at
 * the place of the group's earliest member in the sources, and one for each
 * item in no group. A member the check judged `same: false` is in no group
 * (it has its own row at its own place); a group whose also members are all
 * rejected is no group. `features` are the distinct features of a row's items,
 * in source order. `also` lists the other members of a merged row (every
 * member but keep, in source order) as `{ feature, item }`, so a wrongly
 * merged item stays visible (design D8); it is empty for a row of one item.
 * @returns {{ item: string, known: string, searched: string, features: string[], also: { feature: string, item: string }[] }[]}
 */
export function mergedRows(sources, merged, checked) {
  if (merged === null || mergeProblems(merged, sources).length > 0) return sources.items.map(unmergedRow);
  const pairs = mergedPairs(merged);
  if (pairs.length > 0 && (checked === null || checkedProblems(checked, merged).length > 0)) return sources.items.map(unmergedRow);
  const same = new Set(pairs.length === 0 ? [] : checked.members.filter((member) => member.same).map((member) => pairKey(member.keep, member.id)));
  const groups = merged.groups
    .map((group) => ({ keep: group.keep, also: group.also.filter((id) => same.has(pairKey(group.keep, id))) }))
    .filter((group) => group.also.length > 0);
  const at = new Map(sources.items.map((item, position) => [item.id, position]));
  const groupOf = new Map();
  for (const group of groups) {
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

/** `{ value }` for the parsed JSON file `file` of `outDir`, or `{ problems }` with the line for a missing or unparseable file. */
function readJsonFile(outDir, file) {
  let text;
  try {
    text = readFileSync(join(outDir, file), 'utf-8');
  } catch (error) {
    if (error.code === 'ENOENT') return { problems: [`${file} is missing`] };
    throw error;
  }
  try {
    return { value: JSON.parse(text) };
  } catch (error) {
    return { problems: [`${file} is not valid JSON: ${error.message}`] };
  }
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
  const read = readJsonFile(outDir, MERGED_FILE);
  if (read.problems) return { merged: null, problems: read.problems, passing: false };
  const problems = mergeProblems(read.value, sources);
  return { merged: problems.length === 0 ? read.value : null, problems, passing: problems.length === 0 };
}

/**
 * The state of `open-items/checked.json` for `merge` (a `readMerge` result):
 * `{ checked, problems, passing }`. It is read only when the merge passes and
 * has an also member; otherwise nothing needs checking, the file is not read,
 * and the state passes when the merge does. A missing or unparseable file and
 * every `checkedProblems` line are problems; `checked` is the parsed file only
 * when it passes.
 */
export function readCheck(outDir, merge) {
  if (!merge.passing || merge.merged === null || mergedPairs(merge.merged).length === 0) return { checked: null, problems: [], passing: merge.passing };
  const read = readJsonFile(outDir, CHECKED_FILE);
  if (read.problems) return { checked: null, problems: read.problems, passing: false };
  const problems = checkedProblems(read.value, merge.merged);
  return { checked: problems.length === 0 ? read.value : null, problems, passing: problems.length === 0 };
}

/**
 * Everything `aggregate` and `check-open-items` say about the open items of
 * the run, from one computation: the sources, the merge and check states, the
 * table rows, whether the merge and the check both pass, and the status line
 * for the coverage section. The line says how many merged items the check put
 * back when it put back any (design D9).
 */
export function openItemsOutcome(outDir, index) {
  const sources = openItemSources(outDir, index);
  const merge = readMerge(outDir, sources);
  const check = readCheck(outDir, merge);
  const rows = mergedRows(sources, merge.merged, check.checked);
  const passing = merge.passing && check.passing;
  const written = sources.items.length;
  let line = `Open items: ${written} written in the chapters, not merged`;
  if (written === 0) {
    line = 'Open items: none written in the chapters';
  } else if (passing) {
    line = `Open items: ${written} written in the chapters, ${rows.length} after merging`;
    const total = merge.merged === null ? 0 : mergedPairs(merge.merged).length;
    const putBack = check.checked === null ? 0 : check.checked.members.filter((member) => !member.same).length;
    if (putBack > 0) line += `; the check put back ${putBack} of ${total} merged items`;
  }
  return { sources, merge, check, passing, rows, line };
}
