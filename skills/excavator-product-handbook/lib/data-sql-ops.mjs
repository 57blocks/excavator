/**
 * The SQL statements the data section recognizes (openspec change
 * handbook-data-tables, design D2): create, drop, rename and alter of a table,
 * create of an index, insert, update, delete and truncate. A table name may be
 * quoted with a backtick or a double quote and may carry a database prefix; the
 * last segment is the name, as in core's SQL parser. A `${...}` placeholder in
 * the name position is an operation whose table name is not a literal. Nothing
 * here runs SQL.
 */

/** The SQL operations, named the way a migration call of the same meaning is named. */
export const SQL_OPERATIONS = Object.freeze(['create-table', 'drop-table', 'rename-table', 'alter-table', 'create-index', 'insert', 'update', 'delete', 'truncate']);

const STATEMENT = /\b(CREATE\s+TABLE|DROP\s+TABLE|ALTER\s+TABLE|RENAME\s+TABLE|CREATE\s+(?:UNIQUE\s+)?INDEX|INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?)\b/gi;
const PLACEHOLDER = /\$\{[^}]*\}/y;
const SEGMENT = /(?:\\?[`"])?([A-Za-z_][\w$]*)(?:\\?[`"])?/y;
const MODIFIER = {
  'create-table': /\s+(?:IF\s+NOT\s+EXISTS\s+)?/iy,
  'drop-table': /\s+(?:IF\s+EXISTS\s+)?/iy,
  'alter-table': /\s+(?:IF\s+EXISTS\s+|ONLY\s+)?/iy,
};

/** Keep a string literal's backslash escapes from hiding a space: `\n`, `\r` and `\t` become two spaces. */
export const neutralizeEscapes = (raw) => raw.replace(/\\[nrt]/g, '  ');

/** `{ name, end }` for the table name that starts at `from` (`name` null for a placeholder), or null when none does. */
function readName(text, from) {
  PLACEHOLDER.lastIndex = from;
  if (PLACEHOLDER.test(text)) return { name: null, end: PLACEHOLDER.lastIndex };
  let pos = from;
  let last = null;
  for (;;) {
    SEGMENT.lastIndex = pos;
    const found = SEGMENT.exec(text);
    if (found === null) break;
    last = found[1];
    pos = SEGMENT.lastIndex;
    if (text[pos] !== '.') break;
    pos += 1;
  }
  return last === null ? null : { name: last, end: pos };
}

/** Skip whitespace from `from`. */
function skipSpace(text, from) {
  let i = from;
  while (i < text.length && /\s/.test(text[i])) i += 1;
  return i;
}

/** The names of a comma-separated list that starts at `from`, and where it ends. */
function readList(text, from) {
  const names = [];
  let pos = from;
  for (;;) {
    const item = readName(text, pos);
    if (item === null) break;
    names.push(item.name);
    pos = item.end;
    const after = skipSpace(text, pos);
    if (text[after] !== ',') break;
    pos = skipSpace(text, after + 1);
  }
  return { names, end: pos };
}

const TO = /\s+TO\s+/iy;

/** The end of the statement that holds `from`: the next `;`, or the end of the text. */
function statementEnd(text, from) {
  const semi = text.indexOf(';', from);
  return semi < 0 ? text.length : semi;
}

/**
 * The operations in `text`, in the order they are written:
 * `{ index, op, name, to? }`, where `name` is null when the table name is a
 * placeholder. `index` is the offset of the keyword. A statement that names
 * several tables gives one operation for each.
 */
export function sqlOperations(text) {
  const found = [];
  STATEMENT.lastIndex = 0;
  let match;
  while ((match = STATEMENT.exec(text)) !== null) {
    const index = match.index;
    const keyword = match[1].toUpperCase().replace(/\s+/g, ' ');
    const after = index + match[0].length;
    let op;
    if (keyword === 'CREATE TABLE') op = 'create-table';
    else if (keyword === 'DROP TABLE') op = 'drop-table';
    else if (keyword === 'ALTER TABLE') op = 'alter-table';
    else if (keyword === 'RENAME TABLE') op = 'rename-table';
    else if (keyword.startsWith('CREATE ')) op = 'create-index';
    else if (keyword === 'INSERT INTO') op = 'insert';
    else if (keyword === 'UPDATE') op = 'update';
    else if (keyword === 'DELETE FROM') op = 'delete';
    else op = 'truncate';

    if (op === 'rename-table') {
      let pos = skipSpace(text, after);
      for (;;) {
        const from = readName(text, pos);
        if (from === null) break;
        TO.lastIndex = from.end;
        if (!TO.test(text)) break;
        const to = readName(text, skipSpace(text, TO.lastIndex));
        if (to === null) break;
        found.push({ index, op, name: from.name === null || to.name === null ? null : to.name, from: from.name });
        pos = skipSpace(text, to.end);
        if (text[pos] !== ',') break;
        pos = skipSpace(text, pos + 1);
      }
      STATEMENT.lastIndex = Math.max(STATEMENT.lastIndex, pos);
      continue;
    }

    if (op === 'create-index') {
      const end = statementEnd(text, after);
      const on = /\bON\s+(?:ONLY\s+)?/i.exec(text.slice(after, end));
      if (on === null) continue;
      const name = readName(text, after + on.index + on[0].length);
      if (name !== null) found.push({ index, op, name: name.name });
      continue;
    }

    let start;
    if (MODIFIER[op]) {
      MODIFIER[op].lastIndex = after;
      if (!MODIFIER[op].test(text)) continue;
      start = MODIFIER[op].lastIndex;
    } else {
      start = skipSpace(text, after);
    }

    if (op === 'drop-table') {
      const list = readList(text, start);
      for (const name of list.names) found.push({ index, op, name });
      STATEMENT.lastIndex = Math.max(STATEMENT.lastIndex, list.end);
      continue;
    }

    const name = readName(text, start);
    if (name === null) continue;
    if (op === 'update') {
      const tail = /\s+SET\b/iy;
      tail.lastIndex = name.end;
      if (!tail.test(text)) continue;
    }
    if (op === 'alter-table') {
      const end = statementEnd(text, name.end);
      const rename = /\bRENAME\s+TO\s+/i.exec(text.slice(name.end, end));
      if (rename !== null) {
        const to = readName(text, name.end + rename.index + rename[0].length);
        if (to !== null) {
          found.push({ index, op: 'rename-table', name: name.name === null || to.name === null ? null : to.name, from: name.name });
          continue;
        }
      }
    }
    found.push({ index, op, name: name.name });
  }
  return found;
}

/** The text of an SQL file with its `--` and block comments replaced by spaces (newlines kept), quoted text left alone. */
export function stripSqlComments(text) {
  const parts = [];
  const n = text.length;
  let last = 0;
  let i = 0;
  while (i < n) {
    const ch = text[i];
    if (ch === '-' && text[i + 1] === '-') {
      let end = text.indexOf('\n', i);
      if (end < 0) end = n;
      parts.push(text.slice(last, i), text.slice(i, end).replace(/[^\n]/g, ' '));
      last = end;
      i = end;
    } else if (ch === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      const end = close < 0 ? n : close + 2;
      parts.push(text.slice(last, i), text.slice(i, end).replace(/[^\n]/g, ' '));
      last = end;
      i = end;
    } else if (ch === "'" || ch === '"' || ch === '`') {
      let k = i + 1;
      while (k < n && text[k] !== ch) k += text[k] === '\\' ? 2 : 1;
      i = Math.min(k, n) + 1;
    } else {
      i += 1;
    }
  }
  parts.push(text.slice(last));
  return parts.join('');
}
