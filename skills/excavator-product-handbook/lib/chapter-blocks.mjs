/**
 * Splits the Markdown text of a chapter into blocks for the final check: headings,
 * paragraphs, list items, table rows and fenced blocks, each with its line
 * numbers. Pure text; no file is read.
 */

const FENCE = /^\s*```(.*)$/;
const HEADING = /^(#{1,4})\s+(.*?)\s*#*\s*$/;
const LIST_ITEM = /^(\s*)([-*]|\d+\.)\s+(.*)$/;

const splitRow = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
const isSeparatorRow = (line) => {
  const cells = splitRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{1,}:?$/.test(cell));
};

/**
 * The blocks of `text`, in order. Each block has `type` (heading, paragraph, item, row,
 * separator, fence) and `line` (1-based first line). Heading: `level`, `text`. Paragraph and
 * item: `lines` (the text of each line, a paragraph without a leading `> `) and `text` (joined
 * by a space). Row: `text`, `header` (true for the first row of a table). Fence: `info`,
 * `body` (`{ line, text }` per line).
 */
export function chapterBlocks(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let paragraph = null;
  let item = null;
  let inTable = false;
  const flush = () => {
    if (paragraph !== null) blocks.push({ ...paragraph, text: paragraph.lines.join(' ') });
    if (item !== null) blocks.push({ ...item, text: item.lines.join(' ') });
    paragraph = null;
    item = null;
  };
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const no = i + 1;
    const fence = FENCE.exec(raw);
    if (fence !== null) {
      flush();
      inTable = false;
      const body = [];
      let j = i + 1;
      while (j < lines.length && !FENCE.test(lines[j])) {
        body.push({ line: j + 1, text: lines[j] });
        j += 1;
      }
      blocks.push({ type: 'fence', line: no, info: fence[1].trim().toLowerCase(), body });
      i = j;
      continue;
    }
    if (raw.trim() === '') {
      flush();
      inTable = false;
      continue;
    }
    const heading = HEADING.exec(raw);
    if (heading !== null) {
      flush();
      inTable = false;
      blocks.push({ type: 'heading', line: no, level: heading[1].length, text: heading[2].trim() });
      continue;
    }
    if (raw.trimStart().startsWith('|')) {
      flush();
      if (isSeparatorRow(raw)) blocks.push({ type: 'separator', line: no, text: raw });
      else {
        blocks.push({ type: 'row', line: no, text: raw.trim(), header: !inTable });
        inTable = true;
      }
      continue;
    }
    inTable = false;
    const entry = LIST_ITEM.exec(raw);
    if (entry !== null) {
      flush();
      item = { type: 'item', line: no, lines: [entry[3]] };
      continue;
    }
    if (item !== null && /^\s/.test(raw)) {
      item.lines.push(raw.trim());
      continue;
    }
    if (item !== null) flush();
    const content = raw.replace(/^\s*>\s?/, '');
    if (paragraph === null) paragraph = { type: 'paragraph', line: no, lines: [content.trim()], starts: [no] };
    else {
      paragraph.lines.push(content.trim());
      paragraph.starts.push(no);
    }
  }
  flush();
  return blocks;
}

export { splitRow };
