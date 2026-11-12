/**
 * The word list of the run's fixed-text table that scripts match against a
 * text: the advice words (`md.findings.adviceWords`, a text may hold none).
 * It is comma-separated and translated with the rest of the table. A word written only in ASCII is matched as a whole word ignoring case;
 * a word with a letter outside ASCII (a language with its own script) is matched
 * as a substring ignoring case, since such text has no spaces to split on. A word with
 * an apostrophe (won't) is an ASCII word like the others; a typographic apostrophe in
 * the text counts as the plain one.
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

/** A typographic apostrophe is the plain one: the table writes won't, a model may write the other form. */
const TYPOGRAPHIC_APOSTROPHE = new RegExp(`[${String.fromCharCode(0x2018, 0x2019)}]`, 'g');

/** Every word of `words` that `text` holds, in the order of the list, each once. */
export function wordsIn(text, words) {
  const lower = text.toLowerCase().replace(TYPOGRAPHIC_APOSTROPHE, "'");
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
