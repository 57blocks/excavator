/** Markdown text helpers for handbook.md: single-line text and tables whose cells cannot break the row. */

/** Collapse every run of white space to one space, ends trimmed: safe inside a heading, a list item or a cell. */
export const inline = (text) => text.replace(/\s+/g, ' ').trim();

/** A table cell: one line, `|` escaped. */
export const cell = (text) => inline(text).replace(/\|/g, '\\|');

/** A pipe table; `rows` are arrays of cell texts. */
export function table(headers, rows) {
  const line = (cells) => `| ${cells.map(cell).join(' | ')} |`;
  return [line(headers), `| ${headers.map(() => '---').join(' | ')} |`, ...rows.map(line)].join('\n');
}
