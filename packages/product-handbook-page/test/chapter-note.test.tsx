// @vitest-environment happy-dom
// The not-verified line of a chapter: the first paragraph after the h1, when its text is the fixed text, is a quiet note with an
// icon (and the not-passed line likewise, matched by the text before its first placeholder); the same words further down the
// chapter, after the first h2, stay an ordinary paragraph.
import { afterEach, describe, expect, it } from 'vitest';

import { AppView } from '../src/App';
import { fill } from '../src/lib/text';
import { parseHash } from '../src/lib/route';
import type { PageData } from '../src/lib/types';
import { cleanup, mount, settle } from './dom';
import { d, marked, pageData } from './page-fixture';

afterEach(cleanup);

const NOT_VERIFIED = marked['chapter.notVerified'];
const NOT_PASSED = fill(marked['chapter.notPassed'], { count: 3 });
const chapters = (text: string) => [
  { id: 'F1', texts: { product: text, technical: text } },
  { id: 'system', texts: { product: `# ${d('S')}\n`, technical: `# ${d('S')}\n` } },
  { id: 'F2', texts: { product: `# ${d('R')}\n`, technical: `# ${d('R')}\n` } },
];
const settled = async (data: PageData): Promise<HTMLElement> => {
  const host = mount(<AppView data={data} route={parseHash('#/product/chapter/F1')} />);
  await settle();
  await settle();
  return host;
};

describe('the not-verified line', () => {
  it('is a note with an icon, and so is the not-passed line; both keep their text', async () => {
    const host = await settled(pageData({ chapters: chapters(`# ${d('Orders')}\n\n${NOT_VERIFIED}\n\n${NOT_PASSED}\n\n${d('Intro.')}\n\n## ${d('Part')}\n\n${d('Body.')}\n`) }));
    const notes = Array.from(host.querySelectorAll('.prose p.chapter-note'));
    expect(notes.map((note) => note.getAttribute('data-part'))).toEqual(['not-verified', 'not-passed']);
    expect(notes[0].textContent).toBe(NOT_VERIFIED);
    expect(notes[1].textContent).toBe(NOT_PASSED);
    for (const note of notes) {
      const icon = note.querySelector('svg');
      expect(icon?.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('does not touch the same words after the first h2, or a paragraph that merely contains them', async () => {
    const host = await settled(pageData({ chapters: chapters(`# ${d('Orders')}\n\n${d('Intro.')}\n\n${d('see:')} ${NOT_VERIFIED}\n\n## ${d('Part')}\n\n${NOT_VERIFIED}\n\n${NOT_PASSED}\n`) }));
    expect(host.querySelectorAll('.chapter-note').length).toBe(0);
    expect(host.textContent).toContain(NOT_VERIFIED);
  });

  it('is not matched in a fence before the first h2 or with a missing key', async () => {
    const host = await settled(pageData({ chapters: chapters(`# ${d('Orders')}\n\n\`\`\`\n## fake\n\`\`\`\n\n${NOT_VERIFIED}\n`) }));
    // The fenced "## fake" is not a heading, so the paragraph after it is still before the first real h2.
    expect(host.querySelectorAll('.chapter-note').length).toBe(1);
    const lacking = pageData({ chapters: chapters(`# ${d('Orders')}\n\n${NOT_VERIFIED}\n`) });
    const { ['chapter.notVerified']: _removed, ...rest } = lacking.ui.strings;
    const bare = await settled({ ...lacking, ui: { strings: rest } });
    expect(bare.querySelectorAll('.chapter-note').length).toBe(0);
  });
});
