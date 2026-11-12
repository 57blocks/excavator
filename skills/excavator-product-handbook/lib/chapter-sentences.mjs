/**
 * Sentences of a paragraph for the final check. Backtick spans are masked before
 * splitting so the dots inside a cited path never end a sentence; the full-width
 * sentence enders end one without a following space.
 */

import { citationGroups } from './chapter-cites.mjs';

const WIDE_ENDERS = String.fromCharCode(0x3002, 0xff01, 0xff1f);
const SPLIT = new RegExp(`[.!?](?=\\s|$)|[${WIDE_ENDERS}]`, 'g');

/** `text` with every backtick span replaced by letters of the same length. */
const maskSpans = (text) => text.replace(/`[^`\n]*`/g, (span) => 'x'.repeat(span.length));

/**
 * The sentences of `text`: `{ start, end, text, cited, words }` where `cited` says the
 * sentence holds a citation group and `words` that it holds words outside its citation groups.
 */
export function sentencesOf(text) {
  const groups = citationGroups(text);
  const masked = maskSpans(text);
  const cuts = [];
  let from = 0;
  for (const match of masked.matchAll(SPLIT)) {
    cuts.push([from, match.index + 1]);
    from = match.index + 1;
  }
  if (masked.slice(from).trim() !== '') cuts.push([from, text.length]);
  return cuts.map(([start, end]) => {
    const inGroup = new Array(end - start).fill(false);
    let cited = false;
    for (const group of groups) {
      if (group.start >= start && group.start < end) cited = true;
      for (let k = Math.max(group.start, start); k < Math.min(group.end, end); k += 1) inGroup[k - start] = true;
    }
    let words = false;
    for (let k = start; k < end; k += 1) if (!inGroup[k - start] && /[\p{L}\p{N}]/u.test(text[k])) words = true;
    return { start, end, text: text.slice(start, end).trim(), cited, words };
  });
}
