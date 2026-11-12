/**
 * What the outputs make of a checked chapter (openspec change handbook-free-chapter,
 * D0, D7, D12). Pure text work on the chapter file and the notes the check recorded:
 * the text without its citations for the product view, the blocks the page draws
 * (sentences without citations, tables, and each sequence diagram as participants,
 * arrows and the texts of the arrows), and the count of each kind of content note.
 */

import { citationGroups } from './chapter-cites.mjs';
import { parseChapter } from './chapter-parse.mjs';
import { renderChapter } from './chapter-render.mjs';

/** The kinds of content note the chapter check records, in the order the outputs list them. */
export const NOTE_KINDS = Object.freeze(['number', 'quote', 'code', 'advice', 'language']);

const LIST_PREFIX = /^(\s*(?:[-*]|\d+\.)\s+)?(.*)$/;
const TRAILING_PUNCTUATION = /[.\u3002!\uff01?\uff1f]*$/;
const squash = (text) => text.replace(/\s+/g, ' ').trim();

/** `text` with every citation group taken out, the punctuation that ended each group kept, spaces squashed. */
export function withoutCitations(text) {
  const groups = citationGroups(text);
  let out = '';
  let at = 0;
  for (const group of groups) {
    out = (out + text.slice(at, group.start)).trimEnd();
    out += TRAILING_PUNCTUATION.exec(text.slice(group.start, group.end))[0];
    at = group.end;
  }
  return squash(out + text.slice(at));
}

/** One line outside a diagram without its citations; a list prefix and the cells of a table row keep their form. */
function productLine(line) {
  if (citationGroups(line).length === 0) return line;
  if (/^\s*\|/.test(line)) return `| ${line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(withoutCitations).join(' | ')} |`;
  const [, prefix = '', rest] = LIST_PREFIX.exec(line);
  return `${prefix}${withoutCitations(rest)}`;
}

/**
 * The chapter as the product view shows it: the text of `renderChapter` with no removal, with no citation group and no `%%`
 * line of a diagram. A line that held nothing but a citation is dropped.
 */
export function productChapter(source) {
  const out = [];
  let fenced = false;
  let run = [];
  const flush = () => {
    if (run.length > 0) out.push(...pruneTable(run));
    run = [];
  };
  for (const line of renderChapter(source, []).split('\n')) {
    if (!fenced && /^\s*\|/.test(line)) {
      run.push(productLine(line));
      continue;
    }
    flush();
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      out.push(line);
    } else if (fenced) {
      if (!/^\s*%%/.test(line)) out.push(line);
    } else {
      const shown = productLine(line);
      if (shown.trim() !== '' || line.trim() === '') out.push(shown);
    }
  }
  flush();
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

/** The indexes of the columns of a table (`rows`: the data rows as lists of cells) that have a cell with text; every column when there is no row. */
const keptColumns = (width, rows) => Array.from({ length: width }, (_, at) => at).filter((at) => rows.length === 0 || rows.some((row) => (row[at] ?? '').trim() !== ''));

/**
 * The lines of a table run of the product view without the columns whose every data cell is empty (a column that held nothing but
 * citations); the technical view keeps them. `run` is the lines of one table: header, separator, rows.
 */
function pruneTable(run) {
  const split = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
  const [header, separator, ...rows] = run.map(split);
  if (separator === undefined) return run;
  const keep = keptColumns(header.length, rows);
  if (keep.length === header.length || keep.length === 0) return run;
  const join = (cells) => `| ${keep.map((at) => cells[at] ?? '').join(' | ')} |`;
  return [join(header), `| ${keep.map((at) => separator[at] ?? '---').join(' | ')} |`, ...rows.map(join)];
}

const cellsOf = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => withoutCitations(cell));

/** The participants and the arrows of one diagram block of `parseChapter`: `{ kind: 'diagram', sequence, arrows }`. */
function diagramBlock(block, ownOf) {
  const participants = [];
  const display = new Map();
  const indexOf = (name) => {
    let at = participants.findIndex((one) => one.name === name);
    if (at === -1) {
      participants.push({ name, shown: display.get(name) ?? name });
      at = participants.length - 1;
    }
    return at;
  };
  for (const entry of block.entries) {
    if (entry.kind !== 'participant') continue;
    const shown = /participant\s+\w+\s+as\s+(.+?)\s*$/.exec(entry.raw[0])?.[1];
    display.set(entry.name, shown ?? entry.name);
    indexOf(entry.name);
  }
  const arrows = block.entries.filter((entry) => entry.kind === 'arrow');
  const steps = arrows.map((arrow) => ({ from: indexOf(arrow.from), to: indexOf(arrow.to) }));
  return { kind: 'diagram', sequence: { participants: participants.map((one) => one.shown), steps }, arrows: arrows.map((arrow) => ownOf(arrow.itemId)) };
}

/**
 * The blocks of the chapter as the page draws them, with no citation: `{ kind: 'heading', level, text }`, `{ kind: 'paragraph', text }`,
 * `{ kind: 'list', ordered, text }` (one block per list item), `{ kind: 'table', header, rows }` and `{ kind: 'diagram', sequence, arrows }`.
 */
export function chapterPageBlocks(source) {
  const { blocks, items } = parseChapter(source);
  const ownOf = (id) => items.find((item) => item.id === id)?.own ?? '';
  const out = [];
  for (const block of blocks) {
    if (block.kind === 'heading') out.push({ kind: 'heading', level: block.level, text: block.text });
    else if (block.kind === 'paragraph') out.push({ kind: 'paragraph', text: withoutCitations(block.text) });
    else if (block.kind === 'list') out.push({ kind: 'list', ordered: /\d\./.test(block.prefix), text: withoutCitations(block.text) });
    else if (block.kind === 'table') {
      // The page has no citation in either view, so a column that held nothing else is not drawn.
      const header = cellsOf(block.header.raw);
      const rows = block.rows.map((row) => cellsOf(row.raw));
      const keep = keptColumns(header.length, rows);
      out.push({ kind: 'table', header: keep.map((at) => header[at]), rows: rows.map((row) => keep.map((at) => row[at] ?? '')) });
    }
    else if (block.kind === 'diagram') out.push(diagramBlock(block, ownOf));
  }
  return out;
}

/** The count of each kind of note: `{ number, quote, code, advice, language }`, zeros included. */
export const noteCounts = (notes) => Object.fromEntries(NOTE_KINDS.map((kind) => [kind, notes.filter((note) => note.kind === kind).length]));
