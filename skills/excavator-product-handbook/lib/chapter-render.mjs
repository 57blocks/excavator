/**
 * Renders a chapter with some of its items removed (openspec change
 * handbook-free-chapter D6). The ids are those of the parse of the full text, so
 * removing items never renumbers. By kind of block: a sentence leaves its
 * paragraph or list item, a row leaves its table, an arrow leaves its diagram (the
 * participants no arrow uses any more go with it), a heading is dropped so its
 * content joins the section before it, a lead-in goes when everything after it
 * in its list, table or diagram is gone, and an empty table or diagram is dropped.
 * With nothing removed the text comes back as it was written (blank lines inside
 * a diagram and runs of blank lines excepted).
 */

import { parseChapter } from './chapter-parse.mjs';

/** The kept text of a paragraph or list item, or null when none of its sentences is kept. */
function keptText(block, removed) {
  if (block.segs.length === 0) return block.text;
  const kept = block.segs.filter((seg) => !removed.has(seg.itemId));
  if (kept.length === 0) return null;
  if (kept.length === block.segs.length) return block.text;
  let text = kept.map((seg) => block.text.slice(seg.start, seg.end)).join('');
  if (kept[kept.length - 1].end === block.segs[block.segs.length - 1].end) text += block.text.slice(block.remainderStart);
  return text.trim();
}

function tableLines(block, removed) {
  const rows = block.rows.filter((_, index) => !removed.has(block.rowItems[index]));
  if (rows.length === 0) return null;
  return [block.header.raw, block.separator.raw, ...rows.map((row) => row.raw)];
}

function diagramLines(block, removed) {
  const arrows = block.entries.filter((entry) => entry.kind === 'arrow');
  const keptArrows = arrows.filter((entry) => !removed.has(entry.itemId));
  if (keptArrows.length === 0) return null;
  const pruned = keptArrows.length < arrows.length;
  const used = new Set(keptArrows.flatMap((entry) => [entry.from, entry.to]));
  const lines = ['```mermaid'];
  for (const entry of block.entries) {
    if (entry.kind === 'header') lines.push(...entry.raw);
    else if (entry.kind === 'participant' && (!pruned || used.has(entry.name))) lines.push(...entry.raw);
    else if (entry.kind === 'arrow' && !removed.has(entry.itemId)) lines.push(...entry.raw);
  }
  lines.push('```');
  return lines;
}

/** `source` with the items `removedIds` (a list or set of `chapter.<n>` ids) removed. */
export function renderChapter(source, removedIds = []) {
  const removed = new Set(removedIds);
  const { blocks } = parseChapter(source);
  const out = blocks.map((block) => {
    switch (block.kind) {
      case 'heading': return removed.has(block.itemId) ? null : [`${'#'.repeat(block.level)} ${block.text}`];
      case 'paragraph':
      case 'list': {
        if (block.leadIn) return [`${block.prefix}${block.text}`];
        const text = keptText(block, removed);
        return text === null ? null : [`${block.prefix}${text}`];
      }
      case 'table': return tableLines(block, removed);
      case 'diagram': return diagramLines(block, removed);
      default: return [block.raw];
    }
  });
  // A lead-in stays only when something of the list, table or diagram after it stays.
  blocks.forEach((block, index) => {
    if (!block.leadIn) return;
    let end = index + 1;
    if (blocks[end]?.kind === 'list') {
      while (blocks[end + 1]?.kind === 'list' && !blocks[end + 1].leadIn) end += 1;
    }
    if (out.slice(index + 1, end + 1).every((lines) => lines === null)) out[index] = null;
  });
  let text = '';
  let pendingBlank = false;
  blocks.forEach((block, index) => {
    if (out[index] === null) {
      pendingBlank ||= block.blankBefore;
      return;
    }
    if (text !== '') text += block.blankBefore || pendingBlank ? '\n\n' : '\n';
    text += out[index].join('\n');
    pendingBlank = false;
  });
  return text === '' ? '' : `${text}\n`;
}
