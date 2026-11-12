/**
 * The anchors GitHub gives the headings of a Markdown document (openspec
 * change prd-report-prd-shape, design D4), computed here so the flow index
 * can link to them. The rules are those of GitHub's heading slugs:
 *   - the heading's text as rendered (code spans, links, images and emphasis
 *     keep only their text);
 *   - lower case;
 *   - every character that is not a letter, mark, number, connector
 *     punctuation (the underscore), hyphen or space is removed;
 *   - each space becomes a hyphen;
 *   - a slug already given to an earlier heading gets `-1`, `-2`, ... in
 *     document order, a suffixed slug being registered too.
 * Superscript digits and the few symbols that count as letters in Ruby's
 * word class are not special-cased. Other Markdown renderers may differ.
 */

import { headingsOf } from './headings.mjs';

const REMOVED = /[^\p{L}\p{M}\p{Nd}\p{Nl}\p{Pc} -]/gu;
const PLACEHOLDER = /\u0000(\d+)\u0000/g;

/** The text a heading's inline Markdown renders to. */
export function renderedText(raw) {
  const spans = [];
  let text = raw.replace(/(`+)(.+?)\1/g, (_all, _ticks, code) => {
    spans.push(code.trim());
    return `\u0000${spans.length - 1}\u0000`;
  });
  text = text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    .replace(/<\/?[A-Za-z][^>]*>/g, '')
    .replace(/(?<![\p{L}\p{N}_])_+(.+?)_+(?![\p{L}\p{N}_])/gu, '$1')
    .replace(/\\([\\`*_{}[\]()#+\-.!|<>~])/g, '$1');
  return text.replace(PLACEHOLDER, (_all, at) => spans[Number(at)]);
}

/** The slug of one heading without the duplicate suffix. */
export function slugOf(raw) {
  return renderedText(raw).toLowerCase().replace(REMOVED, '').replace(/ /g, '-');
}

/** A function giving the anchors of headings in document order, suffixing repeats. */
export function createSlugger() {
  const used = new Map();
  return (raw) => {
    const base = slugOf(raw);
    let anchor = base;
    while (used.has(anchor)) {
      used.set(base, used.get(base) + 1);
      anchor = `${base}-${used.get(base)}`;
    }
    used.set(anchor, 0);
    return anchor;
  };
}

/** Every heading of `markdown` outside code fences with its anchor: `{ level, text, line, anchor }` in document order. */
export function anchoredHeadings(markdown) {
  const slug = createSlugger();
  return headingsOf(markdown).map((heading) => ({ ...heading, anchor: slug(heading.text) }));
}
