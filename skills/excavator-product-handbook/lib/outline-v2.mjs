/**
 * The order of the handbook (outline format /2): `outline.json` lists parts of chapter blocks and
 * what it leaves out. Conservation is by block: every block that exists (a chapter file, or the
 * data, dictionaries and history the scripts wrote) appears exactly once, in a part or unplaced.
 * An outline that breaks it is not used: the default order is, and each break is one line that
 * starts `Outline: `. Pure; reads only outline.json.
 */

import { join } from 'node:path';

import { CROSS_CHAPTERS } from './chapter-lint.mjs';
import { isObject, readJson } from './json-file.mjs';

export const OUTLINE_FORMAT_V2 = 'excavator-product-handbook-outline/2';
export const OUTLINE_FILE = 'outline.json';
export const SCRIPT_BLOCKS = Object.freeze(['data', 'dictionaries', 'history']);

/** The default parts (titles are ui keys `md.part.*`) over the blocks that exist; an empty part is dropped. */
export function defaultParts({ blocks, featureIds, t }) {
  const has = (name) => blocks.includes(name);
  const take = (...names) => names.filter(has);
  const parts = [
    ['md.part.system', take('system')],
    ['md.part.people', take('domains', 'roles')],
    ['md.part.features', featureIds.filter(has)],
    ['md.part.notifications', take('notifications', 'topics')],
    ['md.part.data', take('data', 'dictionaries', 'history')],
    ['md.part.defects', take('defects', 'review', 'remedies')],
  ];
  return parts.filter(([, chapters]) => chapters.length > 0).map(([key, chapters]) => ({ title: t(key), chapters }));
}

function shapeProblems(doc, blocks) {
  const problems = [];
  if (!isObject(doc) || doc.format !== OUTLINE_FORMAT_V2) return [`${OUTLINE_FILE}: format must be ${OUTLINE_FORMAT_V2}`];
  if (!Array.isArray(doc.parts)) return [`${OUTLINE_FILE}: parts must be an array`];
  const placed = new Map();
  doc.parts.forEach((part, at) => {
    if (!isObject(part) || typeof part.title !== 'string' || part.title.trim() === '' || !Array.isArray(part.chapters)) {
      problems.push(`${OUTLINE_FILE}: parts[${at}] needs a title and a chapters array`);
      return;
    }
    if (part.chapters.length === 0) problems.push(`${OUTLINE_FILE}: part ${JSON.stringify(part.title)} is empty`);
    for (const block of part.chapters) placed.set(block, (placed.get(block) ?? 0) + 1);
  });
  const unplaced = doc.unplaced ?? [];
  if (!Array.isArray(unplaced)) problems.push(`${OUTLINE_FILE}: unplaced must be an array`);
  else {
    unplaced.forEach((item, at) => {
      if (!isObject(item) || typeof item.block !== 'string' || typeof item.reason !== 'string' || item.reason.trim() === '') {
        problems.push(`${OUTLINE_FILE}: unplaced[${at}] needs a block and a reason`);
        return;
      }
      placed.set(item.block, (placed.get(item.block) ?? 0) + 1);
    });
  }
  for (const [block, count] of placed) {
    if (!blocks.includes(block)) problems.push(`${OUTLINE_FILE}: ${JSON.stringify(block)} is not a block of this run`);
    else if (count > 1) problems.push(`${OUTLINE_FILE}: ${JSON.stringify(block)} is placed ${count} times`);
  }
  for (const block of blocks) if (!placed.has(block)) problems.push(`${OUTLINE_FILE}: block ${JSON.stringify(block)} is neither in a part nor unplaced`);
  return problems;
}

/**
 * `{ source: 'outline' | 'default', problems, parts: [{ title, chapters }], unplaced: [{ block, reason }] }`.
 * `blocks`: every block that exists; `featureIds`: the map's features in order; `t`: the fixed text.
 */
export function resolveOutlineV2(outDir, { blocks, featureIds, t }) {
  const fallback = (problems) => ({ source: 'default', problems, parts: defaultParts({ blocks, featureIds, t }), unplaced: [] });
  const read = readJson(join(outDir, OUTLINE_FILE));
  if (read.missing) return fallback([]);
  if (!read.ok) return fallback([`${OUTLINE_FILE} ${read.reason}`].map((line) => `Outline: ${line}`));
  const problems = shapeProblems(read.value, blocks);
  if (problems.length > 0) return fallback(problems.map((line) => `Outline: ${line}`));
  return { source: 'outline', problems: [], parts: read.value.parts.map((part) => ({ title: part.title.trim(), chapters: [...part.chapters] })), unplaced: (read.value.unplaced ?? []).map((item) => ({ block: item.block, reason: item.reason.trim() })) };
}

export { CROSS_CHAPTERS };
