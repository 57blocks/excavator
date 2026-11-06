/**
 * Where a table name appears outside the migrations (openspec change
 * handbook-data-tables, design D4 and D6). Three rules, nothing else:
 *   a  a string literal whose whole content is the table name, case sensitive;
 *   b  FROM, JOIN, INTO, UPDATE or TABLE (any case) followed by optional
 *      whitespace, an optional quote or backtick, an optional `database.`
 *      prefix and then exactly the table name, with no letter, digit or
 *      underscore on either side. After TABLE the separator may also be an
 *      opening parenthesis and a quote or backtick (an ORM call such as
 *      `.Table("name AS n")`): the name is then the start of the literal and
 *      the rest of the literal may follow. A literal that is the whole name is
 *      rule a's, not counted twice;
 *   c  `many2many:` followed at once by exactly the table name (the join
 *      table of a struct tag), with no letter, digit or underscore after it.
 * A comment is text like any other, so a name in a comment counts. The result
 * says where the name appears; it does not say the file reads or writes the
 * table. One pass per file: the literals are cut out once and looked up in a
 * set of names, and the keywords are found once and the word after each is
 * looked up in the same set, so the cost is the size of the files, not the
 * number of tables times it.
 */

const LITERAL = /'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
const KEYWORD = /\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\b/gi;
const AFTER_KEYWORD = /\s*(?:[`"'[]?[\w$]+[`"'\]]?\.)*[`"'[]?([A-Za-z0-9_]+)/y;
const AFTER_TABLE_CALL = /\s*\(\s*([`"'])(?:[`"'[]?[\w$]+[`"'\]]?\.)*[`"'[]?([A-Za-z0-9_]+)/y;
const MANY_TO_MANY = /\bmany2many:([A-Za-z0-9_]+)/gi;

/** A counter of line numbers for indexes that only increase. */
function lineCounter(text) {
  let line = 1;
  let at = 0;
  return (index) => {
    for (let i = text.indexOf('\n', at); i >= 0 && i < index; i = text.indexOf('\n', at)) {
      line += 1;
      at = i + 1;
    }
    return line;
  };
}

/** Add `{ file, line, rule }` for each appearance of a name of `names` (a Set) in `text` to `into` (`Map<name, Map<`file:line:rule`, row>>`). */
export function findMentions(file, text, names, into) {
  const record = (name, line, rule) => {
    let rows = into.get(name);
    if (rows === undefined) {
      rows = new Map();
      into.set(name, rows);
    }
    const key = `${line}:${rule}`;
    if (!rows.has(key)) rows.set(key, { file, line, rule });
  };

  const literalLine = lineCounter(text);
  LITERAL.lastIndex = 0;
  let match;
  while ((match = LITERAL.exec(text)) !== null) {
    const content = match[0].slice(1, -1);
    if (names.has(content)) record(content, literalLine(match.index), 'a');
  }

  const keywordLine = lineCounter(text);
  KEYWORD.lastIndex = 0;
  while ((match = KEYWORD.exec(text)) !== null) {
    AFTER_KEYWORD.lastIndex = KEYWORD.lastIndex;
    const word = AFTER_KEYWORD.exec(text);
    if (word === null) {
      if (match[0].toUpperCase() !== 'TABLE') continue;
      AFTER_TABLE_CALL.lastIndex = KEYWORD.lastIndex;
      const call = AFTER_TABLE_CALL.exec(text);
      if (call === null || !names.has(call[2]) || text[AFTER_TABLE_CALL.lastIndex] === call[1]) continue;
      record(call[2], keywordLine(call.index + call[0].length - call[2].length), 'b');
      continue;
    }
    const run = word[1];
    if (names.has(run)) record(run, keywordLine(word.index + word[0].length - run.length), 'b');
  }

  const joinLine = lineCounter(text);
  MANY_TO_MANY.lastIndex = 0;
  while ((match = MANY_TO_MANY.exec(text)) !== null) {
    if (names.has(match[1])) record(match[1], joinLine(match.index + match[0].length - match[1].length), 'c');
  }
}
