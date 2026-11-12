/**
 * The outline of the handbook (openspec change handbook-outline): the parts and chapters the orchestrator
 * writes for this project in `<out>/outline.json`, each chapter holding one block the script computes or one
 * list of entity pages. The blocks and how each is shown are fixed; where each goes and what it is called are
 * not. `check-outline` checks that every block is placed exactly once or left out with a reason, and the reader
 * text of the titles; the outputs fall back to the default outline, and say so, when the file is missing or
 * fails.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { memberDirectories } from './banned-words.mjs';
import { loadCheckedMap } from './check-map.mjs';
import { UsageError } from './errors.mjs';
import { readJson } from './json-file.mjs';
import { languageGate } from './language-check.mjs';
import { projectFiles } from './project-files.mjs';
import { reviewItems } from './review.mjs';
import { arrayOf, literal, nonEmptyString, objectOf, shapeProblems } from './schema.mjs';
import { loadUi } from './ui.mjs';

export const OUTLINE_FORMAT = 'excavator-product-handbook-outline/1';
export const OUTLINE_FILE = 'outline.json';

/**
 * The blocks, in the order of the default outline: `id` (also the page route of the block), `group` (its part in the
 * default outline), `title` (the fixed-text key of its default title) and `technical` (only the technical view has it).
 * `list` blocks expand into one page per entity: the business domains, the applications and the external systems.
 */
export const BLOCKS = Object.freeze([
  { id: 'overview', group: 'system', title: 'page.nav.overview' },
  { id: 'business', group: 'system', title: 'page.nav.business' },
  { id: 'architecture', group: 'system', title: 'page.nav.architecture', technical: true },
  { id: 'data', group: 'system', title: 'md.data.heading', technical: true },
  { id: 'roles-matrix', group: 'system', title: 'md.matrix.roleFeature.heading' },
  { id: 'applications-matrix', group: 'system', title: 'md.matrix.applicationDomain.heading', technical: true },
  { id: 'dictionaries', group: 'system', title: 'md.dict.heading', technical: true },
  { id: 'applications', group: 'applications', title: 'page.nav.group.applications', technical: true, list: true },
  { id: 'domains', group: 'domains', title: 'page.nav.group.domains', list: true },
  { id: 'systems', group: 'systems', title: 'page.nav.group.systems', technical: true, list: true },
  { id: 'notifications', group: 'topics', title: 'page.nav.notifications' },
  { id: 'jobs', group: 'topics', title: 'page.nav.jobs' },
  { id: 'topics', group: 'topics', title: 'page.nav.topics' },
  { id: 'history', group: 'health', title: 'md.history.heading' },
  { id: 'findings', group: 'health', title: 'page.nav.findings' },
  { id: 'recommendations', group: 'health', title: 'page.nav.recommendations' },
  { id: 'open-questions', group: 'health', title: 'md.appendix.openHeading' },
  { id: 'glossary', group: 'appendix', title: 'md.appendix.glossaryHeading' },
  { id: 'sources', group: 'appendix', title: 'md.appendix.sourcesHeading' },
].map((block) => Object.freeze({ technical: false, list: false, ...block })));

const BLOCK_OF = new Map(BLOCKS.map((block) => [block.id, block]));
export const blockOf = (id) => BLOCK_OF.get(id);
const GROUPS = ['system', 'applications', 'domains', 'systems', 'topics', 'health', 'appendix'];

const OUTLINE_SCHEMA = objectOf({
  format: literal(OUTLINE_FORMAT),
  language: nonEmptyString,
  parts: arrayOf(objectOf({
    title: nonEmptyString,
    chapters: arrayOf(objectOf({ title: nonEmptyString }, { block: nonEmptyString, list: nonEmptyString })),
  })),
  unplaced: arrayOf(objectOf({ block: nonEmptyString, reason: nonEmptyString })),
});

/** Shape problems of a parsed outline.json. */
export const outlineShapeProblems = (doc) => shapeProblems(doc, OUTLINE_SCHEMA);

/** The block id of a chapter: its block, or its list. */
export const chapterBlock = (chapter) => chapter.block ?? chapter.list;

/** Every place the outline puts a block, with the path of the place. */
function placements(doc) {
  const out = [];
  doc.parts.forEach((part, i) => part.chapters.forEach((chapter, j) => {
    if ((chapter.block === undefined) === (chapter.list === undefined)) out.push({ path: `parts[${i}].chapters[${j}]`, kindless: true });
    else out.push({ id: chapterBlock(chapter), path: `parts[${i}].chapters[${j}]`, list: chapter.list !== undefined });
  }));
  doc.unplaced.forEach((item, i) => out.push({ id: item.block, path: `unplaced[${i}]`, unplaced: true }));
  return out;
}

/** Each block placed twice, missing, unknown, or in the wrong kind of chapter; each empty part. */
function conservationProblems(doc) {
  const problems = [];
  const seen = new Map();
  for (const place of placements(doc)) {
    if (place.kindless) {
      problems.push(`${place.path}: a chapter has exactly one of "block" and "list"`);
      continue;
    }
    const block = blockOf(place.id);
    if (block === undefined) {
      problems.push(`${place.path}: ${JSON.stringify(place.id)} is not a block; run outline-facts for the blocks`);
      continue;
    }
    if (!place.unplaced && place.list !== block.list) problems.push(`${place.path}: ${place.id} is ${block.list ? 'a list; write it as "list"' : 'a block; write it as "block"'}`);
    seen.set(place.id, [...(seen.get(place.id) ?? []), place.path]);
  }
  for (const block of BLOCKS) {
    const at = seen.get(block.id);
    if (at === undefined) problems.push(`${block.id}: not placed; put it in a chapter or in unplaced with a reason`);
    else if (at.length > 1) problems.push(`${block.id}: placed more than once: ${at.join(' and ')}`);
  }
  doc.parts.forEach((part, i) => {
    if (part.chapters.length === 0) problems.push(`parts[${i}]: has no chapters; remove the part or give it chapters`);
  });
  return problems;
}

/** The titles and reasons as reader text without evidence, for the same checks a domain name gets. */
function outlineItems(doc) {
  const items = [];
  const text = (path, value) => ({ path, text: value, label: false, numbers: true, narrative: true });
  doc.parts.forEach((part, i) => {
    items.push({ path: `parts[${i}]`, strings: [text(`parts[${i}].title`, part.title)], evidence: [], passages: [] });
    part.chapters.forEach((chapter, j) => items.push({ path: `parts[${i}].chapters[${j}]`, strings: [text(`parts[${i}].chapters[${j}].title`, chapter.title)], evidence: [], passages: [] }));
  });
  doc.unplaced.forEach((item, i) => items.push({ path: `unplaced[${i}]`, strings: [text(`unplaced[${i}].reason`, item.reason)], evidence: [], passages: [] }));
  return items;
}

/** All problems of an outline document. A shape problem stops the rest. */
export function outlineProblems(doc, { map, files, memberDirs, languageCheck = null }) {
  const shape = outlineShapeProblems(doc);
  if (shape.length > 0) return shape;
  const problems = [];
  if (doc.language !== map.language) problems.push(`language: ${JSON.stringify(doc.language)} differs from the map's language ${JSON.stringify(map.language)}`);
  problems.push(...conservationProblems(doc));
  problems.push(...reviewItems(outlineItems(doc), { files, memberDirs, languageCheck }).problems);
  return problems;
}

/** Read `<out>/outline.json`: a missing file is `{ ok: false, missing: true }`. */
function readOutline(outDir) {
  const read = readJson(join(outDir, OUTLINE_FILE));
  if (read.missing) return { ok: false, missing: true, line: `${OUTLINE_FILE} ${read.reason}` };
  return read.ok ? read : { ok: false, line: `${OUTLINE_FILE} ${read.reason}` };
}

/** The default title of a block in the run's fixed text; the domains are named areas when the handbook has no domains file. */
const defaultTitle = (block, t, domainBasis) => t(block.id === 'domains' && domainBasis === 'areas' ? 'page.nav.group.areas' : block.title);

/**
 * The default outline: the blocks in their fixed order, one part per group, with fixed titles from `t`; the part of the
 * domains is named for areas when the handbook has no domains file. Each chapter carries `technical`, as the resolved outline's do.
 */
export function defaultOutline(t, domainBasis) {
  const parts = GROUPS.map((group) => ({
    title: t(group === 'domains' && domainBasis === 'areas' ? 'page.nav.group.areas' : `page.nav.group.${group}`),
    chapters: BLOCKS.filter((block) => block.group === group).map((block) => (block.list
      ? { title: defaultTitle(block, t, domainBasis), list: block.id, technical: block.technical }
      : { title: t(block.title), block: block.id, technical: block.technical })),
  }));
  return { parts, unplaced: [] };
}

/**
 * The outline both outputs use: `{ source, problems, parts, unplaced }`, `source` `outline` when `<out>/outline.json`
 * passes every check, `default` otherwise, with the lines of why in `problems` (none for a missing file). Each chapter
 * carries `technical`, so a view without the technical blocks can skip them; each left-out block carries its default
 * `title` in the run's fixed text. `check` is the run's `{ files, memberDirs, languageCheck }` (load-run.mjs).
 */
export function resolveOutline(outDir, { map, check, t, domainBasis }) {
  const read = readOutline(outDir);
  let doc = null;
  let problems = [];
  if (read.ok) {
    problems = outlineProblems(read.value, { map, ...check });
    if (problems.length === 0) doc = read.value;
  } else if (!read.missing) problems = [read.line];
  const chosen = doc ?? defaultOutline(t, domainBasis);
  return {
    source: doc === null ? 'default' : 'outline',
    problems,
    parts: chosen.parts.map((part) => ({ title: part.title, chapters: part.chapters.map((chapter) => ({ ...chapter, technical: blockOf(chapterBlock(chapter)).technical })) })),
    unplaced: chosen.unplaced.map((item) => ({ block: item.block, title: defaultTitle(blockOf(item.block), t, domainBasis), reason: item.reason })),
  };
}

/** `handbook.mjs outline-facts <out> --project <root>`: one line per block, `<id>  <kind>  <views>  <default title>`. */
export function outlineFacts(outDir, root) {
  if (!existsSync(outDir)) throw new UsageError(`out directory ${outDir} does not exist`);
  const loaded = loadCheckedMap(outDir, root);
  if (!loaded.ok) return { status: 1, lines: [...loaded.lines, 'Next: the map must pass check-map before the outline can be written'] };
  const ui = loadUi(outDir);
  if (!ui.ok) return { status: 1, lines: ui.lines };
  const t = (key) => ui.strings[key] ?? key;
  return {
    status: 0,
    lines: BLOCKS.map((block) => `${block.id}\t${block.list ? 'list' : 'block'}\t${block.technical ? 'technical' : 'both'}\t${t(block.title)}`),
  };
}

/** `handbook.mjs check-outline <out> --project <root>`: returns { status, lines }. Changes no file. */
export function checkOutline(outDir, root) {
  if (!existsSync(outDir)) throw new UsageError(`out directory ${outDir} does not exist`);
  const loaded = loadCheckedMap(outDir, root);
  if (!loaded.ok) return { status: 1, lines: [...loaded.lines, 'Next: the map must pass check-map before the outline can be checked'] };
  const read = readOutline(outDir);
  if (read.missing) throw new UsageError(`${join(outDir, OUTLINE_FILE)} does not exist`);
  if (!read.ok) return { status: 1, lines: [read.line] };
  const gate = languageGate(outDir, loaded.map);
  if (!gate.ok) return { status: 1, lines: gate.lines };
  const problems = outlineProblems(read.value, { map: loaded.map, files: projectFiles(root), memberDirs: memberDirectories(root), languageCheck: gate.check });
  if (problems.length > 0) return { status: 1, lines: problems };
  const chapters = read.value.parts.reduce((sum, part) => sum + part.chapters.length, 0);
  return { status: 0, lines: [`outline ok: ${read.value.parts.length} parts, ${chapters} chapters, ${read.value.unplaced.length} blocks left out`] };
}
