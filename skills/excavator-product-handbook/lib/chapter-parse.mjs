/**
 * Cuts a chapter (chapters/<id>.md, openspec change handbook-free-chapter D2,
 * D7) into blocks and items. Pure text work: nothing is read from the project.
 *
 * Blocks: ATX headings (# to ####), paragraphs, list items, pipe tables, fenced
 * mermaid sequence diagrams, one optional `<!-- no-diagram: reason -->` line.
 * Items, numbered chapter.1, chapter.2, ... in document order:
 *   sentence  the text after the previous citation group up to and including the next one
 *   row       a data row of a table, its citations in any cell
 *   arrow     an arrow of a sequence diagram with the citation group on the %% line after it
 *   heading   no citation of its own; the first 5 distinct citations of the items under it
 * A lead-in (one line ending in a colon, followed by a list, a table or a diagram)
 * is no item. Everything the parse cannot place is a problem line with the item id.
 * `items` carry `own` (the checked text) and `raw` (the citation specs); the
 * checker resolves them. `blocks` hold what chapter-render.mjs needs.
 */

import { citationGroups, specKey } from './chapter-cites.mjs';

export const MAX_HEADING_LEVEL = 4;
const HEADING_CITATIONS = 5;
const NON_TEXT = /^[\s\p{P}\p{S}]*$/u;
const HEADING = /^(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const NO_DIAGRAM = /^<!--\s*no-diagram:\s*(.*?)\s*-->$/;
const LIST = /^(\s*(?:[-*]|\d+\.)\s+)(.*)$/;
const FENCE = /^\s*```\s*(\S*)\s*$/;
const PARTICIPANT = /^\s*participant\s+(\w+)\s+as\s+(.+?)\s*$/;
const ARROW = /^\s*(\w+)\s*(-->>|->>)\s*(\w+)\s*:\s*(.+?)\s*$/;
const CITE_LINE = /^\s*%%\s*(.*?)\s*$/;
const SEPARATOR_ROW = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

const squash = (text) => text.replace(/\s+/g, ' ').trim();
const cellsOf = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());

/** The text with the spans of `groups` taken out, the punctuation that ended each group kept, spaces squashed. */
function withoutGroups(text, groups) {
  let out = '';
  let at = 0;
  for (const group of groups) {
    out = (out + text.slice(at, group.start)).trimEnd();
    out += /[.\u3002!\uff01?\uff1f]*$/.exec(text.slice(group.start, group.end))[0];
    at = group.end;
  }
  return squash(out + text.slice(at));
}

/** Split `lines` into raw blocks; problems are collected by the caller. */
function readBlocks(lines, problems) {
  const blocks = [];
  let open = null;
  let blank = false;
  const push = (block) => {
    blocks.push({ ...block, blankBefore: blank && blocks.length > 0 });
    blank = false;
  };
  const startsBlock = (line) => HEADING.test(line) || FENCE.test(line) || NO_DIAGRAM.test(line.trim()) || LIST.test(line) || /^\s*\|/.test(line);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const number = i + 1;
    if (line.trim() === '') {
      open = null;
      blank = true;
      continue;
    }
    if (open !== null && !startsBlock(line)) {
      open.text += `\n${line.trim()}`;
      continue;
    }
    open = null;
    const heading = HEADING.exec(line);
    const fence = FENCE.exec(line);
    const noDiagram = NO_DIAGRAM.exec(line.trim());
    if (heading !== null) {
      if (heading[1].length > MAX_HEADING_LEVEL) problems.push(`line ${number}: a heading is # to ${'#'.repeat(MAX_HEADING_LEVEL)}; "${heading[1]}" is too deep`);
      else push({ kind: 'heading', level: heading[1].length, text: heading[2], line: number });
    } else if (fence !== null) {
      const body = [];
      let closed = false;
      for (i += 1; i < lines.length; i += 1) {
        if (/^\s*```\s*$/.test(lines[i])) {
          closed = true;
          break;
        }
        body.push({ raw: lines[i], number: i + 1 });
      }
      if (!closed) problems.push(`line ${number}: the fenced block is never closed`);
      else if (fence[1] !== 'mermaid') problems.push(`line ${number}: a fenced block must be mermaid (a sequence diagram); found ${JSON.stringify(fence[1] || 'no language')}`);
      else push({ kind: 'diagram', body, line: number });
    } else if (noDiagram !== null) {
      push({ kind: 'nodiagram', reason: noDiagram[1], raw: line.trim(), line: number });
    } else if (/^\s*\|/.test(line)) {
      const rows = [{ raw: line, number }];
      while (i + 1 < lines.length && /^\s*\|/.test(lines[i + 1])) {
        i += 1;
        rows.push({ raw: lines[i], number: i + 1 });
      }
      if (rows.length < 2 || !SEPARATOR_ROW.test(rows[1].raw)) problems.push(`line ${number}: a table needs a header row and a separator row`);
      else push({ kind: 'table', header: rows[0], separator: rows[1], rows: rows.slice(2), line: number });
    } else {
      const list = LIST.exec(line);
      const block = list === null ? { kind: 'paragraph', prefix: '', text: line.trim(), line: number } : { kind: 'list', prefix: list[1], text: list[2].trim(), line: number };
      push(block);
      open = blocks[blocks.length - 1];
    }
  }
  return blocks;
}

/** Whether a block is a lead-in: one line ending in a colon with a list, table or diagram after it. */
const isLeadIn = (block, next) => ['paragraph', 'list'].includes(block.kind) && !block.text.includes('\n') && /[:\uff1a]$/.test(block.text.trim())
  && next !== undefined && ['list', 'table', 'diagram'].includes(next.kind) && citationGroups(block.text).length === 0;

export function parseChapter(source) {
  const problems = [];
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks = readBlocks(lines, problems);
  const items = [];
  const stack = [];
  const diagrams = { count: 0, arrows: 0 };
  let noDiagram = null;
  const newItem = (kind, fields) => {
    const item = { id: `chapter.${items.length + 1}`, kind, raw: [], ...fields };
    items.push(item);
    return item;
  };
  const context = () => stack.map((entry) => entry.text).join(' > ');
  const claimOf = (own) => (stack.length === 0 ? own : `${context()}: ${own}`);

  blocks.forEach((block, index) => {
    if (block.kind === 'heading') {
      while (stack.length > 0 && stack[stack.length - 1].level >= block.level) stack.pop();
      stack.push({ level: block.level, text: block.text });
      if (block.text.includes('`')) problems.push(`line ${block.line}: a heading carries no citation; its citations are those of the items under it`);
      block.itemId = newItem('heading', { text: `${'#'.repeat(block.level)} ${block.text}`, own: block.text, claim: context(), line: block.line, level: block.level }).id;
    } else if (block.kind === 'paragraph' || block.kind === 'list') {
      block.leadIn = isLeadIn(block, blocks[index + 1]);
      block.segs = [];
      if (block.leadIn) return;
      const groups = citationGroups(block.text);
      let at = 0;
      for (const group of groups) {
        const own = withoutGroups(block.text.slice(at, group.end), [{ start: group.start - at, end: group.end - at }]);
        const item = newItem('sentence', { text: block.text.slice(at, group.end).trim(), own, claim: claimOf(own), line: block.line });
        item.raw = group.specs;
        if (!/[\p{L}\p{N}]/u.test(own)) problems.push(`${item.id} (line ${block.line}): a citation group with no text of its own`);
        block.segs.push({ start: at, end: group.end, itemId: item.id });
        at = group.end;
      }
      const rest = block.text.slice(at);
      block.remainderStart = at;
      if (!NON_TEXT.test(rest)) {
        const shown = squash(rest);
        problems.push(`line ${block.line}: uncited sentence ${JSON.stringify(shown.length > 60 ? `${shown.slice(0, 57)}...` : shown)}; every sentence ends with a citation group`);
      }
    } else if (block.kind === 'table') {
      const header = cellsOf(block.header.raw);
      block.rowItems = block.rows.map((row) => {
        const cells = cellsOf(row.raw);
        const raw = [];
        const parts = cells.map((cell, column) => {
          const groups = citationGroups(cell);
          groups.forEach((group) => raw.push(...group.specs));
          return { label: header[column] ?? '', text: withoutGroups(cell, groups) };
        });
        const own = parts.map((part) => part.text).filter((text) => text !== '').join(' | ');
        const described = parts.filter((part) => part.text !== '').map((part) => (part.label === '' ? part.text : `${part.label}: ${part.text}`)).join('; ');
        const item = newItem('row', { text: row.raw.trim(), own, claim: claimOf(described), line: row.number });
        item.raw = raw;
        if (raw.length === 0) problems.push(`${item.id} (line ${row.number}): a table row without a citation`);
        return item.id;
      });
    } else if (block.kind === 'diagram') {
      parseDiagram(block, { problems, newItem, claimOf });
      diagrams.count += 1;
      diagrams.arrows += block.entries.filter((entry) => entry.kind === 'arrow').length;
    } else if (block.kind === 'nodiagram') {
      if (noDiagram !== null) problems.push(`line ${block.line}: only one no-diagram line is allowed`);
      else if (block.reason === '') problems.push(`line ${block.line}: the no-diagram line needs a reason`);
      else noDiagram = block.reason;
    }
  });

  settleHeadings(items, problems);
  return { blocks, items, problems, diagrams, noDiagram };
}

/** The entries of one diagram block: the header, participants and arrows with their citation lines. */
function parseDiagram(block, { problems, newItem, claimOf }) {
  const rows = block.body.filter((row) => row.raw.trim() !== '');
  block.entries = [];
  if (rows.length === 0 || rows[0].raw.trim() !== 'sequenceDiagram') {
    problems.push(`line ${block.line}: a mermaid block must be a sequence diagram whose first line is sequenceDiagram`);
    block.entries.push({ kind: 'bad' });
    return;
  }
  block.entries.push({ kind: 'header', raw: [rows[0].raw] });
  const display = new Map();
  for (let i = 1; i < rows.length; i += 1) {
    const { raw, number } = rows[i];
    const participant = PARTICIPANT.exec(raw);
    const arrow = ARROW.exec(raw);
    if (participant !== null) {
      display.set(participant[1], participant[2]);
      block.entries.push({ kind: 'participant', raw: [raw], name: participant[1] });
    } else if (arrow !== null) {
      const next = rows[i + 1];
      const cite = next === undefined ? null : CITE_LINE.exec(next.raw);
      const [, from, , to, said] = arrow;
      const shown = `${display.get(from) ?? from} -> ${display.get(to) ?? to}: ${said}`;
      const item = newItem('arrow', { text: cite === null ? raw.trim() : `${raw.trim()}\n${next.raw.trim()}`, own: said, claim: claimOf(shown), line: number });
      item.display = shown;
      if (said.includes('`')) problems.push(`${item.id} (line ${number}): the text of an arrow carries no citation; put it on the %% line below`);
      if (cite === null || next.number !== number + 1) {
        problems.push(`${item.id} (line ${number}): an arrow needs its citation on the next line, as %% followed by a citation group`);
        block.entries.push({ kind: 'arrow', raw: [raw], from, to, itemId: item.id });
        continue;
      }
      const groups = citationGroups(cite[1]);
      if (groups.length !== 1 || groups[0].start !== 0 || groups[0].end !== cite[1].length) problems.push(`${item.id} (line ${next.number}): the %% line holds one citation group and nothing else`);
      groups.forEach((group) => item.raw.push(...group.specs));
      i += 1;
      block.entries.push({ kind: 'arrow', raw: [raw, next.raw], from, to, itemId: item.id });
    } else {
      problems.push(`line ${number}: ${JSON.stringify(raw.trim())} is not allowed in a sequence diagram; only participant <Name> as <Display>, <A>->><B>: <text> and <A>-->><B>: <text>, each arrow followed by a %% citation line`);
      block.entries.push({ kind: 'bad' });
    }
  }
  if (!block.entries.some((entry) => entry.kind === 'arrow')) problems.push(`line ${block.line}: a sequence diagram needs at least one arrow`);
}

/** Give each heading the first 5 distinct citations of the items under it; a heading with none is a problem. */
function settleHeadings(items, problems) {
  items.forEach((item, index) => {
    if (item.kind !== 'heading') return;
    const seen = new Map();
    for (let j = index + 1; j < items.length; j += 1) {
      const next = items[j];
      if (next.kind === 'heading' && next.level <= item.level) break;
      if (next.kind === 'heading') continue;
      for (const spec of next.raw) if (!seen.has(specKey(spec))) seen.set(specKey(spec), spec);
    }
    item.raw = [...seen.values()].slice(0, HEADING_CITATIONS);
    if (seen.size === 0) problems.push(`${item.id} (line ${item.line}): the heading ${JSON.stringify(item.own)} has no cited item under it`);
  });
}
