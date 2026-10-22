/**
 * tour-sentences.mjs
 *
 * The one sentence splitter the tour commands share (openspec: changes/
 * tour-product, design D3): `check` counts sentences with it, `slices` ids them
 * with it, so the number the structure rule sees is the number the verifier is
 * asked about.
 *
 * A sentence ends at `.`, `!` or `?` followed by whitespace or the end of the
 * text, or at a fullwidth `!`, `?` or ideographic full stop anywhere. Closing quotes and
 * brackets after the mark stay with the sentence. A stop inside a backtick span,
 * a dot inside a name or number (`main.go`, `3.5`), and the abbreviations e.g.,
 * i.e., vs. and cf. do not end one. Whitespace runs are collapsed to one space; a
 * trailing fragment without a mark is a sentence.
 */

const ASCII_MARKS = '.!?';
const WIDE_MARKS = String.fromCharCode(0x3002, 0xff01, 0xff1f);
const CLOSERS = `"')]}${String.fromCharCode(0x201d, 0x2019, 0xff09, 0x300d, 0x300f)}`;
const ABBREVIATION = /(?:^|[\s(])(?:e\.g|i\.e|vs|cf)\.$/i;

const isMark = (char) => ASCII_MARKS.includes(char) || WIDE_MARKS.includes(char);

/** @param {string} text @returns {string[]} */
export function splitSentences(text) {
  const chars = [...String(text ?? '')];
  const sentences = [];
  let current = '';
  let inCode = false;
  const flush = () => {
    const sentence = current.replace(/\s+/g, ' ').trim();
    if (sentence !== '') sentences.push(sentence);
    current = '';
  };
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    current += char;
    if (char === '`') inCode = !inCode;
    if (inCode || !isMark(char)) continue;
    // Take the whole run of marks and closers (`?!`, `..."`) with the sentence.
    let j = i + 1;
    let wide = WIDE_MARKS.includes(char);
    while (j < chars.length && (isMark(chars[j]) || CLOSERS.includes(chars[j]))) {
      if (WIDE_MARKS.includes(chars[j])) wide = true;
      current += chars[j];
      j += 1;
    }
    i = j - 1;
    const next = chars[j];
    const boundary = wide || next === undefined || /\s/.test(next);
    if (boundary && !ABBREVIATION.test(current.trimEnd())) flush();
  }
  flush();
  return sentences;
}
