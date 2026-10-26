// `lib/anchors.mjs`: the anchors GitHub gives the headings of a document
// (openspec change prd-report-prd-shape, design D4). github-slugger is not a
// dependency here, so the expected anchors are written by hand from GitHub's
// rules: lower case, remove what is not a letter, mark, number, underscore,
// hyphen or space, spaces to hyphens, repeats suffixed -1, -2 in order.
import { describe, expect, it } from 'vitest';

import { anchoredHeadings, createSlugger, renderedText, slugOf } from '../../../skills/excavator-prd-report/lib/anchors.mjs';

const chars = (...points) => String.fromCodePoint(...points);
const anchors = (markdown) => anchoredHeadings(markdown).map((heading) => heading.anchor);

describe('slugOf: the anchor of one heading', () => {
  it('lower-cases, removes punctuation and turns spaces into hyphens', () => {
    expect(slugOf('Flow 1: Place an order')).toBe('flow-1-place-an-order');
    expect(slugOf('What\'s new? (v2.0) & more!')).toBe('whats-new-v20--more');
    expect(slugOf('snake_case name - and more')).toBe('snake_case-name---and-more');
  });

  it('keeps non-ASCII letters, lower-cased, and removes non-ASCII punctuation', () => {
    const cafe = chars(0x43, 0x61, 0x66, 0xe9);
    const dash = chars(0x2013);
    const resume = chars(0x72, 0xe9, 0x73, 0x75, 0x6d, 0xe9);
    expect(slugOf(`${cafe} ${dash} ${resume}`)).toBe(`${chars(0x63, 0x61, 0x66, 0xe9)}--${resume}`);
    const cyrillic = chars(0x41f, 0x440, 0x438, 0x432, 0x435, 0x442);
    expect(slugOf(cyrillic)).toBe(chars(0x43f, 0x440, 0x438, 0x432, 0x435, 0x442));
    const user = chars(0x7528, 0x6237);
    expect(slugOf(`${user} Flow`)).toBe(`${user}-flow`);
    expect(slugOf(`${user}${chars(0xff1a)}Flow`)).toBe(`${user}flow`);
  });

  it('uses the text of inline code, links, images and emphasis, never their syntax', () => {
    expect(slugOf('The `POST /orders` route')).toBe('the-post-orders-route');
    expect(slugOf('See [the guide](https://example.com/x_y) now')).toBe('see-the-guide-now');
    expect(slugOf('![logo](a/b.png) Orders')).toBe('logo-orders');
    expect(slugOf('An _emphasised_ and **bold** word')).toBe('an-emphasised-and-bold-word');
    expect(slugOf('Uses snake_case_names here')).toBe('uses-snake_case_names-here');
    expect(slugOf('Tags <kbd>Ctrl</kbd> work')).toBe('tags-ctrl-work');
  });

  it('keeps the text of a code span as written, link syntax included', () => {
    expect(renderedText('`[a](b)` and [c](d)')).toBe('[a](b) and c');
  });
});

describe('anchoredHeadings: a document, in order', () => {
  it('suffixes a repeated anchor -1, -2 in document order, across levels', () => {
    const text = ['# Orders', '', '## Overview', '', '### Overview', '', '## Overview', '', '### Other', '## Orders'].join('\n');
    expect(anchors(text)).toEqual(['orders', 'overview', 'overview-1', 'overview-2', 'other', 'orders-1']);
  });

  it('registers a suffixed anchor too: a later heading that is naturally foo-1 becomes foo-1-1', () => {
    expect(anchors('## Foo\n\n## Foo\n\n## Foo 1\n')).toEqual(['foo', 'foo-1', 'foo-1-1']);
  });

  it('skips headings inside code fences and counts the closing hashes as no text', () => {
    const text = ['## Real ##', '', '```md', '## Fenced', '```', '', '~~~', '## Tilde', '~~~', '', '## Fenced'].join('\n');
    expect(anchoredHeadings(text).map((heading) => [heading.text, heading.anchor, heading.line])).toEqual([
      ['Real', 'real', 0],
      ['Fenced', 'fenced', 10],
    ]);
  });

  it('gives an empty anchor to a heading with no letters and suffixes the next one', () => {
    expect(anchors('## !!!\n\n## ???\n')).toEqual(['', '-1']);
  });

  it('gives the same anchors from a slugger of its own each time', () => {
    const slug = createSlugger();
    expect([slug('A b'), slug('A b'), slug('A b')]).toEqual(['a-b', 'a-b-1', 'a-b-2']);
    expect(createSlugger()('A b')).toBe('a-b');
  });
});
