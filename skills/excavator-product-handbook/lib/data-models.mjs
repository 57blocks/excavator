/**
 * Declared tables (openspec change handbook-data-tables, design D3): the table
 * name a model declares, in files outside the migration directories. Go: the
 * first `return` of a `TableName() string` method; a literal is the name, an
 * identifier is looked up as a constant or variable of the same application,
 * and it must be found exactly once. JavaScript and TypeScript: a `tableName:`
 * followed by a string literal. SQL files: `CREATE TABLE`. A name that cannot
 * be read to a literal is not guessed: the declaration is reported with the
 * reason. Nothing is run.
 */

import { lineIndex, tokenizeJs } from './data-js-tokens.mjs';
import { sqlOperations, stripSqlComments } from './data-sql-ops.mjs';

export const JS_EXTENSIONS = Object.freeze(['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts']);

const GO_FUNC = /func\s*\([^)]*\)\s*TableName\s*\(\s*\)\s*string\s*\{/g;
const GO_CONST = /^[ \t]*(?:(?:const|var)[ \t]+)?([A-Za-z_]\w*)(?:[ \t]+[\w.*[\]]+)?[ \t]*=[ \t]*(?:"([^"\n]*)"|`([^`\n]*)`)/gm;

/** The index of the `}` that closes the block opened just before `from`, strings, runes and comments skipped; the text length when none. */
function endOfGoBlock(text, from) {
  let depth = 1;
  let i = from;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i);
      i = end < 0 ? text.length : end;
    } else if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 2;
    } else if (ch === '"' || ch === "'") {
      i += 1;
      while (i < text.length && text[i] !== ch && text[i] !== '\n') i += text[i] === '\\' ? 2 : 1;
      i += 1;
    } else if (ch === '`') {
      const end = text.indexOf('`', i + 1);
      i = end < 0 ? text.length : end + 1;
    } else {
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) return i;
      }
      i += 1;
    }
  }
  return text.length;
}

/** The `TableName()` methods of a Go file: `{ line, expression }`, `expression` null when the body has no `return`. */
export function goTableNames(text) {
  const lineAt = lineIndex(text);
  const found = [];
  GO_FUNC.lastIndex = 0;
  let match;
  while ((match = GO_FUNC.exec(text)) !== null) {
    const start = match.index + match[0].length;
    const body = text.slice(start, endOfGoBlock(text, start));
    const ret = /\breturn[ \t]+([^\n;]+)/.exec(body);
    found.push({ line: lineAt(match.index), expression: ret === null ? null : ret[1].replace(/\s*\/\/.*$/, '').trim() });
  }
  return found;
}

/** The constants and variables of a Go file that are set to a string literal: `{ ident, value, line }`. */
export function goStringDeclarations(text) {
  const lineAt = lineIndex(text);
  const found = [];
  GO_CONST.lastIndex = 0;
  let match;
  while ((match = GO_CONST.exec(text)) !== null) found.push({ ident: match[1], value: match[2] ?? match[3], line: lineAt(match.index) });
  return found;
}

/**
 * Resolve a Go `return` expression: `{ name }` with the literal, or
 * `{ name: null, matches }` where `matches` is the number of declarations found
 * for an identifier, or null for an expression of another form.
 */
export function resolveGoExpression(expression, declarations) {
  if (expression === null) return { name: null, matches: null };
  const literal = /^"([^"\n]*)"$|^`([^`\n]*)`$/.exec(expression);
  if (literal !== null) return { name: literal[1] ?? literal[2] };
  const bare = expression.replace(/\.String\(\)$/, '');
  const path = /^([A-Za-z_]\w*)(?:\.([A-Za-z_]\w*))?$/.exec(bare);
  if (path === null) return { name: null, matches: null };
  const matches = declarations.get(path[2] ?? path[1]) ?? [];
  if (matches.length === 1) return { name: matches[0] };
  return { name: null, matches: matches.length };
}

/** The `tableName:` entries of a JavaScript or TypeScript file: `{ line, name, expression }`, `name` null when the value is not a plain literal. */
export function jsTableNames(text) {
  if (!text.includes('tableName')) return [];
  const { code, strings } = tokenizeJs(text);
  const lineAt = lineIndex(text);
  const found = [];
  const re = /\btableName\s*:\s*/g;
  let match;
  while ((match = re.exec(code)) !== null) {
    const at = match.index + match[0].length;
    const token = strings.get(at);
    let after = token === undefined ? -1 : token.end + 1;
    while (after >= 0 && (code[after] === ' ' || code[after] === '\t')) after += 1;
    const plain = token !== undefined && !token.interpolated && (after >= code.length || [',', '}', ';', '\n', '\r'].includes(code[after]));
    if (plain) {
      found.push({ line: lineAt(match.index), name: token.raw, expression: null });
    } else {
      let end = text.indexOf('\n', at);
      if (end < 0) end = text.length;
      found.push({ line: lineAt(match.index), name: null, expression: text.slice(at, end).replace(/\s*\/\/.*$/, '').replace(/,\s*$/, '').trim() });
    }
  }
  return found;
}

/** The `CREATE TABLE` statements of an SQL file outside a migration directory: `{ line, name }`; a placeholder name is skipped (a plain .sql file has none). */
export function sqlFileTables(text) {
  const stripped = stripSqlComments(text);
  const lineAt = lineIndex(stripped);
  return sqlOperations(stripped)
    .filter((statement) => statement.op === 'create-table' && statement.name !== null)
    .map((statement) => ({ line: lineAt(statement.index), name: statement.name }));
}
