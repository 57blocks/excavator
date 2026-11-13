import { describe, expect, it } from 'vitest';

import { pageHeadings } from '../../../skills/excavator-product-handbook/lib/page-domains.mjs';
import { previewOf, splitChapter, splitLede, splitServerSteps } from '../src/lib/feature-split';
import type { Role } from '../src/lib/feature-split';

const TITLES: Record<Role, string> = {
  overview: 'Overview', screens: 'Pages', operations: 'Operations', rules: 'Rules', states: 'States', notifications: 'Notifications',
  handovers: 'Hand-overs', openQuestions: 'Points to confirm', problems: 'Known defects',
};

const CHAPTER = [
  '# Orders', '', 'Notice.', '',
  '## Overview', '', 'Lead paragraph.', '', '### Background', '', 'Why.', '',
  '## Operations', '', 'Intro.', '', '### Place', '', '1. Do it.', '', '```text', '## not a heading', '```', '', '### Cancel', '', 'Undo.', '',
  '## Shipping zones', '', 'Zones.', '',
  '## Known defects', '', '#### deep', '', 'Text.', '',
].join('\n');

describe('splitChapter', () => {
  const split = splitChapter(CHAPTER, TITLES);

  it('cuts the head, the sections and their items, in order', () => {
    expect(split.head).toBe('# Orders\n\nNotice.');
    expect(split.sections.map((section) => [section.title, section.role, section.items.map((item) => item.title)])).toEqual([
      ['Overview', 'overview', ['Background']],
      ['Operations', 'operations', ['Place', 'Cancel']],
      ['Shipping zones', null, []],
      ['Known defects', 'problems', []],
    ]);
    expect(split.sections[1].intro).toBe('Intro.');
    expect(split.sections[1].items[0].body).toBe('1. Do it.\n\n```text\n## not a heading\n```');
    expect(split.sections[3].intro).toBe('#### deep\n\nText.');
  });

  it('numbers every ## and ### heading from 0, as the search index does, and leaves a # inside a fence alone', () => {
    const numbers = split.sections.flatMap((section) => [section.n, ...section.items.map((item) => item.n)]);
    expect(numbers).toEqual([0, 1, 2, 3, 4, 5, 6]);
    const index = pageHeadings(CHAPTER) as { title: string; level: number }[];
    expect(index.map((entry) => entry.title)).toEqual(['Overview', 'Background', 'Operations', 'Place', 'Cancel', 'Shipping zones', 'Known defects']);
    const titles = split.sections.flatMap((section) => [[section.n, section.title], ...section.items.map((item) => [item.n, item.title])]);
    for (const [n, title] of titles) expect(index[n as number].title).toBe(title);
  });

  it('agrees with the search index on headings with trailing marks, four hashes and indented fences', () => {
    const text = '# T\n\n## One ##\n\n   ```\n## inside\n   ```\n\n#### four\n\n### Two\n';
    const index = pageHeadings(text) as { title: string }[];
    const sections = splitChapter(text, TITLES).sections;
    expect(sections.flatMap((section) => [section.title, ...section.items.map((item) => item.title)])).toEqual(index.map((entry) => entry.title));
    expect(sections[0].items[0].n).toBe(1);
  });

  it('names a role by the exact fixed text only; the first section with another name is the overview', () => {
    expect(splitChapter('# T\n\n## Summary\n\nx\n\n## Operations\n\ny\n', TITLES).sections.map((section) => section.role)).toEqual(['overview', 'operations']);
    expect(splitChapter('# T\n\n## Operations\n\ny\n\n## Rule\n\nz\n', TITLES).sections.map((section) => section.role)).toEqual(['operations', null]);
  });

  it('is only a head when there is no level-2 heading', () => {
    expect(splitChapter('# T\n\nText\n', TITLES)).toEqual({ head: '# T\n\nText\n', sections: [] });
  });
});

describe('splitLede', () => {
  it('takes the first paragraph when the text starts with one', () => {
    expect(splitLede('One.\nTwo.\n\n- a\n- b\n')).toEqual({ lede: 'One.\nTwo.', rest: '- a\n- b\n' });
  });
  it('takes nothing when the text starts with a list, a table, a quote, a fence or a heading', () => {
    for (const text of ['- a\n\nb', '1. a', '| a | b |\n| - | - |', '> quote', '```mermaid\nx\n```', '#### h']) expect(splitLede(text).lede).toBe('');
    expect(splitLede('').lede).toBe('');
  });
});

describe('previewOf', () => {
  it('is the first line that is not a table row or a lead-in, cut after its first sentence', () => {
    expect(previewOf('Steps:\n\n| a | b |\n| - | - |\n\nThe clerk fills the form. Then more text.')).toBe('The clerk fills the form.');
    expect(previewOf('- **Bold** item (`src/a.js:1-2`) goes on.\n- second')).toBe('Bold item goes on.');
    expect(previewOf('```mermaid\nflowchart TD\n```\n\n1. Do it.')).toBe('Do it.');
  });
  it('stops at a full-width full stop and drops a full-width citation group', () => {
    const stop = String.fromCharCode(0x3002);
    const open = String.fromCharCode(0xff08);
    const close = String.fromCharCode(0xff09);
    expect(previewOf(`abc${open}\`src/a.js:1\`${close}${stop}def`)).toBe(`abc${stop}`);
    expect(previewOf(`abc${String.fromCharCode(0xff1a)}\n\ndef`)).toBe('def');
  });
  it('is at most 100 characters and empty without a line', () => {
    expect(previewOf('x'.repeat(300))).toHaveLength(100);
    expect(previewOf('| a |\n| - |')).toBe('');
  });
});

describe('splitServerSteps', () => {
  const marker = 'Server-side steps:';
  it('cuts at the line equal to the marker, in either colon width, and drops the colon from the title', () => {
    expect(splitServerSteps('1. a\n2. b\n\nServer-side steps:\n\n3. c', marker)).toEqual({ before: '1. a\n2. b', title: 'Server-side steps', after: '3. c' });
    expect(splitServerSteps(`1. a\n\nServer-side steps${String.fromCharCode(0xff1a)}\n3. c`, marker)?.title).toBe('Server-side steps');
  });
  it('is null without the line, for a line that only contains it, and for one inside a fence', () => {
    expect(splitServerSteps('1. a\n2. b', marker)).toBeNull();
    expect(splitServerSteps('The Server-side steps: are here', marker)).toBeNull();
    expect(splitServerSteps('```\nServer-side steps:\n```', marker)).toBeNull();
    expect(splitServerSteps('a', '')).toBeNull();
  });
});
