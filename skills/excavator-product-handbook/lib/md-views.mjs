/**
 * The text of one chapter in each view. The technical view is the chapter as written. The
 * product view has every citation group taken out (the sentence punctuation the group carried
 * stays, the space before it goes, table cells stay), outside fenced blocks only. Both views get
 * the fixed sentences after the chapter's first level-1 heading (or on top when it has none).
 */

import { citationGroups } from './chapter-cites.mjs';
import { fill } from './ui.mjs';

const FENCE = /^\s*```/;
const TRAILING = new RegExp(`[.!?${String.fromCharCode(0x3002, 0xff01, 0xff1f)}]*$`);

/** `text` (no fenced block inside) with its citation groups removed. */
function withoutCitations(text) {
  let out = '';
  let at = 0;
  for (const group of citationGroups(text)) {
    out = (out + text.slice(at, group.start)).replace(/[ \t]+$/, '');
    out += TRAILING.exec(text.slice(group.start, group.end))[0];
    at = group.end;
  }
  return out + text.slice(at);
}

/** The product view of `text`: citation groups removed outside fences, fences byte for byte. */
export function productText(text) {
  const lines = text.split('\n');
  const out = [];
  let run = [];
  let fenced = false;
  const flush = () => {
    if (run.length > 0) out.push(withoutCitations(run.join('\n')));
    run = [];
  };
  for (const line of lines) {
    if (FENCE.test(line)) {
      if (!fenced) flush();
      fenced = !fenced;
      out.push(line);
    } else if (fenced) out.push(line);
    else run.push(line);
  }
  flush();
  return out.join('\n');
}

/** `text` with `sentences` (own paragraphs) inserted after the first level-1 heading outside fences, or on top. */
export function withSentences(text, sentences) {
  if (sentences.length === 0) return text;
  const lines = text.split('\n');
  let fenced = false;
  let at = 0;
  for (let i = 0; i < lines.length; i += 1) {
    if (FENCE.test(lines[i])) fenced = !fenced;
    else if (!fenced && /^#\s/.test(lines[i])) {
      at = i + 1;
      break;
    }
  }
  const block = sentences.flatMap((sentence) => ['', sentence]);
  if (at === 0) return [...sentences.flatMap((sentence, index) => (index === 0 ? [sentence] : ['', sentence])), '', ...lines].join('\n');
  return [...lines.slice(0, at), ...block, ...(lines[at] === '' ? [] : ['']), ...lines.slice(at)].join('\n');
}

/** The sentences a chapter carries: not verified always, not passed when its record failed twice. */
export function noticeSentences(record, strings) {
  const out = [strings['chapter.notVerified']];
  if (record.status === 'failed' && record.attempts >= 2) out.push(fill(strings['chapter.notPassed'], { count: record.reasons.length }));
  return out;
}

/** One chapter as one view shows it, headings as written: the view's text of the file, then the fixed sentences. Assemble shifts the headings; the page shows it as is. */
export function chapterMarkdown(chapter, view, strings) {
  const body = view === 'product' ? productText(chapter.text) : chapter.text;
  return withSentences(body.replace(/\s+$/, ''), noticeSentences(chapter.record, strings)).replace(/\s+$/, '');
}

/** The text of the first level-1 heading outside fences, or `name` when the chapter has none. */
export function chapterTitle(text, name) {
  let fenced = false;
  for (const line of text.split('\n')) {
    if (FENCE.test(line)) fenced = !fenced;
    else if (!fenced) {
      const found = /^#\s+(.*?)\s*#*\s*$/.exec(line);
      if (found !== null && found[1] !== '') return found[1];
    }
  }
  return name;
}
