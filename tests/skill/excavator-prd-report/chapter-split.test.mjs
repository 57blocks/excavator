// `lib/chapter.mjs`: the one function that splits a chapter into its
// front-matter, its body without the open items section and that section's
// text (openspec change prd-report-prd-shape, design D4).
import { describe, expect, it } from 'vitest';

import { body, byChapter, splitChapter } from '../../../skills/excavator-prd-report/lib/chapter.mjs';

const chapter = (front, text) => `---\nid: F1\nname: Orders\nkind: flow\n${front}chapter: 1\n---\n${text}`;
const TEXT = '## Orders\n\nIntro.\n\n### Flow 1: Place\n\nSteps.\n\n### Open items\n\n| Item | Searched |\n|---|---|\n| Expiry | the project |\n';

describe('splitChapter', () => {
  it('returns the body without the open items section, and that section\'s text without its heading', () => {
    const split = splitChapter(chapter('actors: [customer]\npermissionRoles: [admin]\nflows: [Flow 1: Place]\nopenItems: Open items\n', TEXT));
    expect(split.ok).toBe(true);
    expect(split.body).toBe('## Orders\n\nIntro.\n\n### Flow 1: Place\n\nSteps.');
    expect(split.openItems).toBe('| Item | Searched |\n|---|---|\n| Expiry | the project |');
    expect([split.actors, split.permissionRoles, split.flows]).toEqual([['customer'], ['admin'], ['Flow 1: Place']]);
    expect(split.data.name).toBe('Orders');
  });

  it('keeps the whole body and gives no open items when the front-matter names none', () => {
    const split = splitChapter(chapter('actors: []\n', TEXT));
    expect(split.body).toBe(TEXT.trimEnd());
    expect(split.openItems).toBeNull();
    expect([split.actors, split.permissionRoles, split.flows]).toEqual([[], [], []]);
  });

  it('matches the heading outside code fences only, and takes a list as the section', () => {
    const text = '## Orders\n\n```md\n### Open items\n```\n\n### Open items\n\n- Expiry\n- Refunds\n';
    const split = splitChapter(chapter('openItems: Open items\n', text));
    expect(split.body).toBe('## Orders\n\n```md\n### Open items\n```');
    expect(split.openItems).toBe('- Expiry\n- Refunds');
  });

  it('reports a heading that is not the last ### heading, and a chapter with no front-matter', () => {
    const missing = splitChapter(chapter('openItems: Open items\n', '## Orders\n\n### Flow\n'));
    expect(missing).toEqual({ ok: false, reason: 'open items heading "Open items" is not the last ### heading' });
    const notLast = splitChapter(chapter('openItems: Open items\n', '## Orders\n\n### Open items\n\nx\n\n### Flow\n'));
    expect(notLast.ok).toBe(false);
    expect(splitChapter('## Orders\n').ok).toBe(false);
  });

  it('gives the same body as body() when there is no open items section, so the page and the PRD agree', () => {
    const text = chapter('actors: []\n', TEXT);
    expect(splitChapter(text).body).toBe(body(text));
  });
});

describe('byChapter', () => {
  it('orders features by chapter, then by the number of the id (F10 after F9)', () => {
    const features = [{ id: 'F10', chapter: 2 }, { id: 'F9', chapter: 2 }, { id: 'F2', chapter: 1 }];
    expect(features.sort(byChapter).map((feature) => feature.id)).toEqual(['F2', 'F9', 'F10']);
  });
});
