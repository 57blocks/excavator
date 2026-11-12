/**
 * The shape of a chapter's open items section (openspec change
 * prd-report-dedupe, design D3): one Markdown table of three columns and
 * nothing else but blank lines around it.
 */

/** The cells of one table row: split on unescaped `|`, the leading and trailing pipe ignored. */
export function tableCells(line) {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1);
  const cells = [];
  let cell = '';
  for (let k = 0; k < text.length; k += 1) {
    if (text[k] === '\\' && k + 1 < text.length) {
      cell += text[k] + text[k + 1];
      k += 1;
    } else if (text[k] === '|') {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += text[k];
    }
  }
  cells.push(cell.trim());
  return cells;
}

/** A cell of a table's delimiter row: dashes with an optional colon at either end. */
export const DELIMITER_CELL = /^:?-+:?$/;

/**
 * Whether `section` is a header row, a delimiter row and at least one data row,
 * each of exactly `columns` cells, with no other line (a blank line inside the
 * table ends it, so it counts as other content).
 */
export function isTableOf(section, columns) {
  if (typeof section !== 'string') return false;
  const lines = section.replace(/\r\n/g, '\n').replace(/^\s*\n/, '').replace(/\s+$/, '').split('\n');
  if (lines.length < 3) return false;
  const rows = lines.map((line) => (line.trim() === '' ? null : tableCells(line)));
  if (rows.some((cells) => cells === null || cells.length !== columns)) return false;
  return rows[1].every((cell) => DELIMITER_CELL.test(cell));
}
