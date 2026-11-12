/**
 * The chapters of handbook.md in the order of the outline (openspec change handbook-outline, design D6): each block
 * the renderer computed is a list of lines whose first line is its own heading; the chapter replaces that heading with
 * the chapter's title as a second-level heading and moves the headings below it by the same number of levels. Parts
 * are navigation only: handbook.md has no part level. A block the outline leaves out is not written (the coverage
 * section lists it with its reason), a block the technical view alone has is not written in the product view, and
 * a block with no lines at all (the topics and the recommendations of a run with nothing verified to write them from; the coverage
 * section says so) is not written either, as before the outline. Pure and deterministic.
 */

import { blockOf, chapterBlock } from './outline.mjs';
import { inline } from './markdown.mjs';
import { fill } from './ui.mjs';

const HEADING = /^(#{1,6}) /;

/** The lines with every heading outside a fenced block moved by `by` levels (at most six deep, at least two). */
export function shiftHeadings(lines, by) {
  let fenced = false;
  return lines.map((line) => {
    if (line.startsWith('```')) fenced = !fenced;
    const match = fenced ? null : HEADING.exec(line);
    if (match === null) return line;
    return `${'#'.repeat(Math.min(6, Math.max(2, match[1].length + by)))} ${line.slice(match[0].length)}`;
  });
}

/** One chapter: `lines` (a block, first line its heading) under the title; nothing for a block with no lines. */
export function chapterLines(lines, title) {
  if (lines.length === 0) return [];
  const heading = `## ${inline(title)}`;
  const first = HEADING.exec(lines[0]);
  if (first === null) throw new Error('a block starts with its heading');
  return [heading, ...shiftHeadings(lines.slice(1), 2 - first[1].length)];
}

/** The chapters of the outline for a view, in order: `blocks` maps a block id to its lines. */
export function outlineChapters({ outline, blocks, view }) {
  const out = [];
  for (const part of outline.parts) {
    for (const chapter of part.chapters) {
      if (chapter.technical && view !== 'technical') continue;
      out.push(...chapterLines(blocks.get(chapterBlock(chapter)) ?? [], chapter.title));
    }
  }
  return out;
}

/** The part of the coverage section about the outline: which one was used, why not the written one, and the blocks left out. */
export function outlineCoverage({ outline, view, t }) {
  const out = [`### ${t('md.coverage.outlineHeading')}`, ''];
  if (outline.source === 'outline') out.push(t('md.coverage.outlineUsed'), '');
  else if (outline.problems.length === 0) out.push(t('md.coverage.outlineDefault'), '');
  else out.push(t('md.coverage.outlineFailed'), '', ...outline.problems.map((line) => `- ${inline(line)}`), '');
  const left = outline.unplaced.filter((item) => view === 'technical' || !blockOf(item.block)?.technical);
  if (left.length > 0) out.push(`#### ${t('md.coverage.outlineUnplacedHeading')}`, '', ...left.map((item) => `- ${inline(fill(t('md.coverage.outlineUnplacedItem'), { block: item.title, reason: item.reason }))}`), '');
  return out;
}
