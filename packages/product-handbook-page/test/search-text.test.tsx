// @vitest-environment happy-dom
// The search also matches the text of the chapters (openspec change handbook-page-structure, design D25): one result per
// section with the words around the first match, fences left out, deeper headings counted as text, a short query matching the
// titles only, the chapters the index leaves out left out, the domains chapter going to a domain's page, the limit, and in the
// dialog the highlighted match, going to the section, and the line for chapters whose text is not loaded.
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppView } from '../src/App';
import { LoaderContext } from '../src/lib/chunks';
import type { Loader, UnitState } from '../src/lib/chunks';
import { DOMAINS_CHAPTER, MAX_RESULTS, plainLine, searchAll, textResults } from '../src/lib/search';
import type { TextInput } from '../src/lib/search';
import { parseHash } from '../src/lib/route';
import type { ChapterData, PageData, SearchItem } from '../src/lib/types';
import { cleanup, mount, settle, typeInto } from './dom';
import { domainData } from './domains-fixture';
import { BOTH, d, marked } from './page-fixture';

afterEach(() => { cleanup(); window.location.hash = ''; });
beforeEach(() => { window.location.hash = ''; });

const chapterItem = (chapter: string, title: string): SearchItem => ({ kind: 'chapter', title, chapter, domain: null, heading: null, level: null });
const input = (query: string, sources: TextInput['sources'], items: SearchItem[] = [chapterItem('F1', 'Leave'), chapterItem('F2', 'Pay')], extra: Partial<TextInput> = {}): TextInput => ({
  query, groups: [], items, references: [], sources, domainsLabel: 'Domains', systemTitle: 'System', ...extra,
});

const LEAVE = [
  '# Leave',
  '',
  'Sick leave is asked for on the form.',
  '',
  '## Rules',
  '',
  '- Sick leave counts **calendar days**.',
  '- A sick note is needed outside one office.',
  '',
  '#### Sick balance',
  '',
  '```mermaid',
  'flowchart LR',
  '  sick --> done',
  '```',
  '',
  '### Attachments',
  '',
  '| Type | Needs a file |',
  '| --- | --- |',
  '| `Sick` | [yes](#/product/chapter/F2) |',
  '',
].join('\n');

describe('plainLine', () => {
  it('drops list, quote, heading, emphasis and code marks, keeps a link as its text, and sets table cells apart', () => {
    expect(plainLine('- Sick leave counts **calendar days**.')).toBe('Sick leave counts calendar days.');
    expect(plainLine('> 1. A `code` _word_ here')).toBe('A code word here');
    expect(plainLine('#### Sick balance')).toBe('Sick balance');
    expect(plainLine('| `Sick` | [yes](#/x) |')).toBe('Sick \u00b7 yes');
    expect(plainLine('| --- | :---: |')).toBe('');
    expect(plainLine('<!-- server-steps-end -->')).toBe('');
  });
});

describe('textResults', () => {
  it('gives one result per section, in order, with the first match and the number of matching lines; a fence does not count and a deeper heading is text', () => {
    const results = textResults(input('sick', [{ chapter: 'F1', text: LEAVE }]));
    expect(results.map((one) => [one.key, one.count, one.context])).toEqual([
      ['text:F1:-1', 1, 'Leave'],
      ['text:F1:0', 3, 'Leave \u00b7 Rules'],
      ['text:F1:1', 1, 'Leave \u00b7 Attachments'],
    ]);
    expect(results.map((one) => one.target)).toEqual([
      { kind: 'chapter', id: 'F1' },
      { kind: 'heading', chapter: 'F1', heading: 0 },
      { kind: 'heading', chapter: 'F1', heading: 1 },
    ]);
    expect(results[1].snippet).toEqual({ before: '', match: 'Sick', after: ' leave counts calendar days.' });
  });

  it('cuts a long line around the match with an ellipsis on each cut side', () => {
    const text = `# Pay\n\n${'a'.repeat(50)} target ${'b'.repeat(80)}\n`;
    const [one] = textResults(input('target', [{ chapter: 'F2', text }]));
    expect(one.snippet?.before.startsWith('\u2026')).toBe(true);
    expect(one.snippet?.before.length).toBe(25);
    expect(one.snippet?.match).toBe('target');
    expect(one.snippet?.after.endsWith('\u2026')).toBe(true);
  });

  it('takes the words of the query apart: a section matches when it holds all of them, on one line or on several', () => {
    const text = ['# Leave', '## Office rules', '- A sick note is needed.', '- One office may send it later.', '## Balance', '- Sick hours are counted.', '## Both', '- Sick leave needs a note.', '- A sick note per office.'].join('\n\n');
    const results = textResults(input('sick  office', [{ chapter: 'F1', text }]));
    expect(results.map((one) => [one.key, one.count])).toEqual([['text:F1:0', 2], ['text:F1:2', 2]]);
    // The line with the most of the words is shown, with its first match highlighted.
    expect(results[1].title).toBe('A sick note per office.');
    expect(results[1].snippet?.match).toBe('sick');
    expect(textResults(input('sick office', [{ chapter: 'F1', text: '# Leave\n\n## Balance\n\n- Sick hours.\n' }]))).toEqual([]);
  });

  it('matches nothing for a one-character query, and leaves out a chapter the index does not list', () => {
    expect(textResults(input('s', [{ chapter: 'F1', text: LEAVE }]))).toEqual([]);
    expect(textResults(input('sick', [{ chapter: 'defects', text: LEAVE }]))).toEqual([]);
  });

  it('sends a match in a domain section of the domains chapter to the domain page when that chapter is an index of the domains', () => {
    const text = '# Domains\n\n## Billing\n\n### Features\n\nInvoices are sent monthly.\n';
    const groups = [{ id: 'd1', name: 'Billing', features: [] }] as unknown as TextInput['groups'];
    const items = [chapterItem(DOMAINS_CHAPTER, 'Domains')];
    const [asIndex] = textResults(input('invoices', [{ chapter: DOMAINS_CHAPTER, text }], items, { groups, domainsIndex: true }));
    expect(asIndex.target).toEqual({ kind: 'domain', id: 'd1' });
    const [asChapter] = textResults(input('invoices', [{ chapter: DOMAINS_CHAPTER, text }], items, { groups }));
    expect(asChapter.target).toEqual({ kind: 'heading', chapter: DOMAINS_CHAPTER, heading: 1 });
  });

  it('comes after the title results, and the whole list is cut at the limit with the total kept', () => {
    const text = ['# Leave', ...Array.from({ length: 50 }, (_, at) => `## Part ${at}\n\nleave words`)].join('\n\n');
    const { results, total } = searchAll(input('leave', [{ chapter: 'F1', text }]));
    expect(results[0].key).toBe('chapter:F1');
    expect(results[1].key).toBe('text:F1:0');
    expect(results).toHaveLength(MAX_RESULTS);
    expect(total).toBe(51);
  });
});

const ITEM_TEXT = (title: string): string => `# ${d(title)}\n\n${d('Intro words.')}\n\n## ${d(`${title} first`)}\n\ntext\n\n## ${d(`${title} second`)}\n\n### ${d('An item')}\n\n- ${d('A rule about')} Sick ${d('hours.')}\n`;

function leaveData(): PageData {
  const data = domainData();
  const chapters: ChapterData[] = data.chapters.map((chapter) => (chapter.id === 'F2' ? { id: 'F2', texts: Object.fromEntries(BOTH.map((view) => [view, ITEM_TEXT('Order entry')])) } : chapter));
  return { ...data, chapters };
}

const page = (data: PageData, hash = '#/product', loader?: Loader): HTMLElement => {
  const view = <AppView data={data} route={parseHash(hash)} />;
  return mount(loader === undefined ? view : <LoaderContext.Provider value={loader}>{view}</LoaderContext.Provider>);
};
const open = (): void => { act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true })); }); };
const field = (): HTMLInputElement => document.querySelector('[role="dialog"] input') as HTMLInputElement;

describe('the dialog', () => {
  it('shows a text result with the match highlighted as written and the chapter and section as its context', () => {
    page(leaveData());
    open();
    typeInto(field(), 'sick');
    const row = document.querySelector('[data-result="text:F2:2"]') as HTMLElement;
    expect(row.querySelector('mark')?.textContent).toBe('Sick');
    expect(row.querySelector('.search-title')?.textContent).toBe(`${d('A rule about')} Sick ${d('hours.')}`);
    expect(row.querySelector('small')?.textContent).toBe(`${d('Order entry')} \u00b7 ${d('An item')}`);
    expect(document.querySelector('.search-note')).toBeNull();
  });

  it('goes to the section of a text result: the chapter opens, the fold that holds it opens, and the heading is focused', async () => {
    const proto = globalThis.HTMLElement.prototype as unknown as { scrollIntoView: (options?: unknown) => void };
    const saved = proto.scrollIntoView;
    proto.scrollIntoView = () => undefined;
    try {
      // The route of the mounted page is fixed, so the page starts on the chapter the result goes to.
      page(leaveData(), '#/product/chapter/F2');
      open();
      typeInto(field(), 'sick');
      act(() => (document.querySelector('[data-result="text:F2:2"]') as HTMLElement).click());
      expect(window.location.hash).toBe('#/product/chapter/F2');
      await settle();
      expect(document.activeElement?.id).toBe('h-2');
      const folds: HTMLDetailsElement[] = [];
      for (let at = document.getElementById('h-2')?.parentElement ?? null; at !== null; at = at.parentElement) if (at instanceof HTMLDetailsElement) folds.push(at);
      expect(folds.length).toBeGreaterThan(0);
      expect(folds.every((fold) => fold.open)).toBe(true);
    } finally {
      proto.scrollIntoView = saved;
    }
  });

  it('in a page with part files, loads every chapter when it opens and says how many are not searched while one is loading or missing', () => {
    const loaded: string[] = [];
    const states: Record<string, UnitState> = { 'chapter:F1': { status: 'loading' }, 'chapter:system': { status: 'missing', parts: ['part-0002'] } };
    const loader: Loader = { state: (key) => states[key] ?? { status: 'core' }, load: (key) => { loaded.push(key); }, subscribe: () => () => undefined };
    page(leaveData(), '#/product', loader);
    open();
    expect(loaded).toEqual(expect.arrayContaining(['chapter:system', 'chapter:F1', 'chapter:F2']));
    typeInto(field(), 's');
    expect(document.querySelector('.search-note')).toBeNull();
    typeInto(field(), 'sick');
    expect(document.querySelector('.search-note')?.textContent).toBe(marked['page.search.partial'].replace('{count}', '2'));
    // The loaded chapter is still searched.
    expect(document.querySelector('[data-result="text:F2:2"]')).not.toBeNull();
  });
});
