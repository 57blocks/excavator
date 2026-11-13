/**
 * The text of one chapter in each view. The technical view is the chapter as written. The
 * product view has every citation group taken out (the sentence punctuation the group carried
 * stays, the space before it goes, table cells stay, a table column the removal emptied goes),
 * outside fenced blocks only. Both views get
 * the fixed sentences after the chapter's first level-1 heading (or on top when it has none).
 */

import { citationGroups } from './chapter-cites.mjs';
import { fill } from './ui.mjs';

const FENCE = /^\s*```/;
const TRAILING = new RegExp(`[.!?${String.fromCharCode(0x3002, 0xff01, 0xff1f)}]*$`);

/** `text` (no fenced block inside) with its citation groups removed. */
function withoutCitations(text) {
  let out = '';
  let at = 0;
  for (const group of citationGroups(text)) {
    out = (out + text.slice(at, group.start)).replace(/[ \t]+$/, '');
    out += TRAILING.exec(text.slice(group.start, group.end))[0];
    at = group.end;
  }
  return out + text.slice(at);
}

const SEPARATOR_CELL = /^\s*:?-+:?\s*$/;
const TABLE_LINE = /^\s*\|/;

/** The cells of a table row: split on unescaped pipes, the outer pipes dropped, each cell trimmed. */
function splitCells(line) {
  const cells = [];
  let cell = '';
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === '\\' && i + 1 < line.length) {
      cell += line[i] + line[i + 1];
      i += 1;
    } else if (line[i] === '|') {
      cells.push(cell);
      cell = '';
    } else cell += line[i];
  }
  cells.push(cell);
  if (cells[0].trim() === '') cells.shift();
  if (cells.length > 0 && cells[cells.length - 1].trim() === '') cells.pop();
  return cells.map((c) => c.trim());
}

/** The indexes of the columns of one table (original and cleaned rows) the citation removal emptied. */
function emptiedColumns(original, cleaned) {
  const width = cleaned[0].length;
  const body = cleaned.slice(2);
  const drop = [];
  for (let c = 0; c < width; c += 1) {
    const hadCitation = original.slice(2).some((row) => c < row.length && citationGroups(row[c]).length > 0);
    if (hadCitation && body.every((row) => (row[c] ?? '') === '')) drop.push(c);
  }
  return drop.length >= width ? drop.slice(1) : drop;
}

/** `cleaned` lines (citations removed) with the emptied columns of every table taken out; `original` has the same lines before removal. */
function withoutEmptiedColumns(original, cleaned) {
  const out = [...cleaned];
  let i = 0;
  while (i < cleaned.length) {
    if (!TABLE_LINE.test(cleaned[i]) || i + 1 >= cleaned.length || !TABLE_LINE.test(cleaned[i + 1])) {
      i += 1;
      continue;
    }
    const separator = splitCells(cleaned[i + 1]);
    if (separator.length === 0 || !separator.every((cell) => SEPARATOR_CELL.test(cell))) {
      i += 1;
      continue;
    }
    let end = i + 2;
    while (end < cleaned.length && TABLE_LINE.test(cleaned[end])) end += 1;
    const before = original.slice(i, end).map(splitCells);
    const after = cleaned.slice(i, end).map(splitCells);
    if (before.every((row, k) => row.length === after[k].length)) {
      const drop = emptiedColumns(before, after);
      if (drop.length > 0) {
        for (let k = 0; k < after.length; k += 1) {
          out[i + k] = `|${after[k].filter((_, c) => !drop.includes(c)).map((cell) => (cell === '' ? ' ' : ` ${cell} `)).join('|')}|`;
        }
      }
    }
    i = end;
  }
  return out;
}

/** The product view of `text`: citation groups removed outside fences, fences byte for byte. */
export function productText(text) {
  const lines = text.split('\n');
  const out = [];
  let run = [];
  let fenced = false;
  const flush = () => {
    if (run.length > 0) {
      const cleaned = withoutCitations(run.join('\n')).split('\n');
      out.push((cleaned.length === run.length ? withoutEmptiedColumns(run, cleaned) : cleaned).join('\n'));
    }
    run = [];
  };
  for (const line of lines) {
    if (FENCE.test(line)) {
      if (!fenced) flush();
      fenced = !fenced;
      out.push(line);
    } else if (fenced) out.push(line);
    else run.push(line);
  }
  flush();
  return out.join('\n');
}

/** `text` with `sentences` (own paragraphs) inserted after the first level-1 heading outside fences, or on top. */
export function withSentences(text, sentences) {
  if (sentences.length === 0) return text;
  const lines = text.split('\n');
  let fenced = false;
  let at = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (FENCE.test(lines[i])) fenced = !fenced;
    else if (!fenced && /^#\s/.test(lines[i])) {
      at = i + 1;
      break;
    }
  }
  const block = sentences.flatMap((sentence) => ['', sentence]);
  if (at === 0) return [...sentences.flatMap((sentence, index) => (index === 0 ? [sentence] : ['', sentence])), '', ...lines].join('\n');
  return [...lines.slice(0, at), ...block, ...(lines[at] === '' ? [] : ['']), ...lines.slice(at)].join('\n');
}

/** The sentences a chapter carries: not verified always, not passed when its record failed twice. */
export function noticeSentences(record, strings) {
  const out = [strings['chapter.notVerified']];
  if (record.status === 'failed' && record.attempts >= 2) out.push(fill(strings['chapter.notPassed'], { count: record.reasons.length }));
  return out;
}

/** One chapter as one view shows it, headings as written: the view's text of the file, then the fixed sentences. Assemble shifts the headings; the page shows it as is. */
export function chapterMarkdown(chapter, view, strings) {
  const body = view === 'product' ? productText(chapter.text) : chapter.text;
  return withSentences(body.replace(/\s+$/, ''), noticeSentences(chapter.record, strings)).replace(/\s+$/, '');
}

/** The text of the first level-1 heading outside fences, or `name` when the chapter has none. */
export function chapterTitle(text, name) {
  let fenced = false;
  for (const line of text.split('\n')) {
    if (FENCE.test(line)) fenced = !fenced;
    else if (!fenced) {
      const found = /^#\s+(.*?)\s*#*\s*$/.exec(line);
      if (found !== null && found[1] !== '') return found[1];
    }
  }
  return name;
}
