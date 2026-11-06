/**
 * The word lists of the run's fixed-text table that scripts match against a
 * statement: the advice words (`md.findings.adviceWords`, a statement may hold
 * none) and the scope words (`md.findings.scopeWords`, the trace asks a case
 * for each). Both are comma-separated and translated with the rest of the
 * table. A word written only in ASCII is matched as a whole word ignoring case;
 * a word with a letter outside ASCII (a language with its own script) is matched
 * as a substring ignoring case, since such text has no spaces to split on.
 */

const ASCII_ONLY = /^[\x20-\x7e]+$/;
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The comma-separated word list stored under `key` of the run's table, as a list. */
function wordListOf(ui, key) {
  const raw = Object.hasOwn(ui, key) ? ui[key] : '';
  return raw.split(',').map((word) => word.trim()).filter((word) => word !== '');
}

/** The advice words of the run's table, as a list. */
export const adviceWordsOf = (ui) => wordListOf(ui, 'md.findings.adviceWords');

/** The scope words of the run's table (`md.findings.scopeWords`), as a list. */
export const scopeWordsOf = (ui) => wordListOf(ui, 'md.findings.scopeWords');

/** Every word of `words` that `text` holds, in the order of the list, each once. */
export function wordsIn(text, words) {
  const lower = text.toLowerCase();
  const found = [];
  for (const word of words) {
    const needle = word.toLowerCase();
    const holds = ASCII_ONLY.test(word)
      ? new RegExp(`(?<![A-Za-z])${escapeRegex(needle)}(?![A-Za-z])`).test(lower)
      : lower.includes(needle);
    if (holds && !found.includes(word)) found.push(word);
  }
  return found;
}
