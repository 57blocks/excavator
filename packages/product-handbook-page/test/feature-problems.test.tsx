// @vitest-environment happy-dom
// Tasks 4.1 and 7.3 of openspec change handbook-page-structure: the problems line under the head (counts that jump to their part of
// the problems block), the problems block built from the problems table (three sub-sections, folds, the fallback when the defects
// chapter cannot be used, the anchors search jumps to),
// and the count of the model. Rows are written by hand.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { AppView } from '../src/App';
import { jumpToHeading } from '../src/lib/heading-jump';
import { rowsOfFeature } from '../src/lib/problems';
import { parseHash } from '../src/lib/route';
import { fill } from '../src/lib/text';
import type { PageData, ProblemRow, ProblemsData } from '../src/lib/types';
import { cleanup, mount, settle } from './dom';
import { domainData } from './domains-fixture';
import { NO_PROBLEMS, d, marked } from './page-fixture';

afterEach(() => { cleanup(); window.history.replaceState(null, '', '#'); });
beforeEach(() => { window.history.replaceState(null, '', '#'); });

const S = (key: string, values: Record<string, string | number> = {}): string => fill(marked[key], values);

const row = (id: string, over: Partial<ProblemRow> = {}): ProblemRow => ({
  id, type: 'defect', level: 'P1', group: 'security', features: ['F2'], summary: d(`summary ${id}`),
  texts: { product: d(`product text ${id}`), technical: d(`technical text ${id}`) },
  source: { chapter: 'defects', line: 4 }, remedy: null, ...over,
});
const design = (id: string, over: Partial<ProblemRow> = {}): ProblemRow => row(id, {
  type: 'design', level: 'high', group: 'duplication', summary: d(`design ${id}`),
  texts: { product: { situation: d(`situation ${id}`), consequence: d(`consequence ${id}`) }, technical: { situation: d(`tech situation ${id}`), consequence: d(`tech consequence ${id}`) } },
  cites: ['src/x.js:10-12'], source: { chapter: 'review', line: 6 }, ...over,
});
const open = (id: string, over: Partial<ProblemRow> = {}): ProblemRow => row(id, {
  type: 'open', level: null, group: null, summary: d(`question ${id}`), texts: { product: d(`open text ${id}`), technical: d(`open technical ${id}`) }, source: { chapter: 'F2', line: 9 }, ...over,
});

const problems = (rows: ProblemRow[], over: Partial<ProblemsData> = {}): ProblemsData => ({
  sources: { defects: { state: 'ok', count: null }, design: { state: 'ok', count: null }, open: { state: 'ok', count: null, unmatched: [] } }, rows, remedies: null, ...over,
});
const sourcesOf = (defects: 'ok' | 'missing' | 'failed' | 'changed', designState: 'ok' | 'missing' | 'failed' | 'changed', openState: 'ok' | 'missing' | 'failed' | 'changed', unmatched: string[] = []): ProblemsData['sources'] => ({
  defects: { state: defects, count: null }, design: { state: designState, count: null }, open: { state: openState, count: null, unmatched },
});

const text = (...sections: string[]): string => [`# ${d('Order entry')}`, '', marked['chapter.notVerified'], '', ...sections].join('\n');
const withText = (data: PageData, body: string, id = 'F2'): PageData => ({ ...data, chapters: data.chapters.map((one) => (one.id === id ? { id, texts: { product: body, technical: body } } : one)) });
const data = (rows: ProblemRow[], over: Partial<ProblemsData> = {}, body?: string): PageData => {
  const page = domainData({ problems: problems(rows, over) });
  return body === undefined ? page : withText(page, body);
};

const show = async (page: PageData, hash = '#/product/chapter/F2'): Promise<HTMLElement> => {
  const host = mount(<AppView data={page} route={parseHash(hash)} />);
  await settle();
  await settle();
  return host;
};
const click = (el: Element): void => { act(() => (el as HTMLElement).click()); };
const issues = (host: HTMLElement): HTMLElement => host.querySelector('section.fblock[data-block="problems"]') as HTMLElement;
const block = (host: HTMLElement): HTMLElement => host.querySelector('[data-part="feature-problems"]') as HTMLElement;
const squash = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const fold = (host: HTMLElement, id: string): HTMLDetailsElement => host.querySelector(`details[data-problem="${id}"]`) as HTMLDetailsElement;
const headings = (panel: HTMLElement): string[] => Array.from(panel.querySelectorAll('h3.sub')).map((one) => one.textContent ?? '');

describe('the block of a feature\'s problems', () => {
  it('sits after the head and before the blocks, with its title as a paragraph and not a heading', async () => {
    const host = await show(data([row('d1')]));
    const article = host.querySelector('article') as HTMLElement;
    const classes = Array.from(article.children).map((one) => one.className.split(' ')[0]);
    expect(classes.indexOf('feature-problems')).toBeGreaterThan(-1);
    expect(classes.indexOf('fblock')).toBe(classes.indexOf('feature-problems') + 1);
    expect(classes).not.toContain('strip');
    expect(block(host).querySelector('p.fp-title')?.textContent).toBe(marked['page.feature.problems.title']);
    expect(block(host).querySelector('h1, h2, h3, h4')).toBeNull();
  });

  it('counts the rows of this feature per type, and leaves out the rows of other features', async () => {
    const host = await show(data([row('d1'), row('d2', { level: 'P0' }), row('d3', { features: ['F1'] }), design('r1'), open('q1'), open('q2'), open('q3', { features: ['F1'] })]));
    const lines = Array.from(block(host).querySelectorAll('[data-source]')).map((li) => [li.getAttribute('data-source'), squash(li)]);
    expect(lines).toEqual([
      ['defect', `${marked['page.problems.type.defect']} 2`],
      ['design', `${marked['page.problems.type.design']} 1`],
      ['open', `${marked['page.problems.type.open']} 2`],
    ]);
  });

  it('has no list of the worst problems any more', async () => {
    const host = await show(data([row('p1', { level: 'P1' }), design('h1', { level: 'high' }), row('z1', { level: 'P0' })]));
    expect(block(host).querySelector('[data-part="feature-problem-top"], [data-top-problem]')).toBeNull();
  });

  it('links to the problems table filtered by the feature, with the view in the address when the page has two views', async () => {
    const host = await show(data([row('d1')]));
    const link = block(host).querySelector('a[data-part="feature-problems-all"]') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('#/product/problems?feature=F2');
    expect(link.textContent).toBe(marked['page.feature.problems.viewAll']);
    cleanup();
    const single = data([row('d1')]);
    single.views = ['product'];
    const alone = await show(single, '#/chapter/F2');
    expect(block(alone).querySelector('a[data-part="feature-problems-all"]')?.getAttribute('href')).toBe('#/problems?feature=F2');
  });

  it('has a count button for each type that is ok; it scrolls to the heading of that type in the problems block and focuses it, never touching the address', async () => {
    const host = await show(data([row('d1'), design('r1')], { sources: sourcesOf('ok', 'ok', 'failed') }));
    const buttons = Array.from(block(host).querySelectorAll<HTMLElement>('button[data-count-type]'));
    expect(buttons.map((one) => [one.getAttribute('data-count-type'), one.textContent])).toEqual([['defect', '1'], ['design', '1']]);
    const scrolled: (string | null)[] = [];
    const proto = globalThis.HTMLElement.prototype as unknown as { scrollIntoView: (options?: unknown) => void };
    const saved = proto.scrollIntoView;
    proto.scrollIntoView = function scroll(this: HTMLElement) { scrolled.push(this.getAttribute('data-problem-type')); };
    try {
      window.history.replaceState(null, '', '#/product/chapter/F2');
      click(buttons[1]);
      expect(scrolled).toEqual(['design']);
      expect(document.activeElement).toBe(issues(host).querySelector('h3[data-problem-type="design"]'));
      expect(window.location.hash).toBe('#/product/chapter/F2');
    } finally {
      proto.scrollIntoView = saved;
    }
    expect(block(host).querySelector('[data-count-type="open"]')).toBeNull();
  });

  it('keeps every fold of the problems block closed until the reader opens it', async () => {
    const host = await show(data([row('d1'), design('r1')]));
    expect(fold(host, 'r1').open).toBe(false);
    click(fold(host, 'r1').querySelector('summary') as HTMLElement);
    expect(fold(host, 'r1').open).toBe(true);
    expect(fold(host, 'd1').open).toBe(false);
    expect(issues(host).contains(fold(host, 'r1'))).toBe(true);
  });

  it('shows only the fixed "none" text when every source is ok, the chapter is not unmatched and it has no rows', async () => {
    const host = await show(data([row('d1', { features: ['F1'] })]));
    expect(squash(block(host).querySelector('[data-part="feature-problems-none"]'))).toBe(marked['page.feature.problems.none']);
    expect(block(host).querySelector('[data-source]')).toBeNull();
    expect(block(host).querySelector('a')).toBeNull();
    expect(block(host).querySelector('button')).toBeNull();
  });

  it('does not say "none" when a source is not ok, and shows the state in place of the count', async () => {
    const host = await show(data([], { sources: sourcesOf('ok', 'missing', 'failed') }));
    expect(block(host).querySelector('[data-part="feature-problems-none"]')).toBeNull();
    const lines = Array.from(block(host).querySelectorAll('[data-source]')).map((li) => squash(li));
    expect(lines).toEqual([
      `${marked['page.problems.type.defect']} 0`,
      `${marked['page.problems.type.design']} ${marked['page.problems.count.missing']}`,
      `${marked['page.problems.type.open']} ${marked['page.problems.count.failed']}`,
    ]);
    cleanup();
    const changed = await show(data([], { sources: sourcesOf('changed', 'ok', 'ok') }));
    expect(squash(block(changed).querySelector('[data-source="defect"]'))).toBe(`${marked['page.problems.type.defect']} ${marked['page.problems.count.changed']}`);
  });

  it('marks the count of the points to confirm incomplete when the chapter has no such heading, and does not say "none"', async () => {
    const host = await show(data([], { sources: sourcesOf('ok', 'ok', 'ok', ['F2']) }));
    expect(block(host).querySelector('[data-part="feature-problems-none"]')).toBeNull();
    expect(squash(block(host).querySelector('[data-source="open"]'))).toBe(`${marked['page.problems.type.open']} 0 ${marked['page.problems.count.incomplete']}`);
    // Another chapter in the list does not mark this one.
    cleanup();
    const other = await show(data([], { sources: sourcesOf('ok', 'ok', 'ok', ['F1']) }));
    expect(squash(block(other).querySelector('[data-part="feature-problems-none"]'))).toBe(marked['page.feature.problems.none']);
  });
});

describe('the problems block', () => {
  const ROWS = [row('d1', { level: 'P2' }), row('d2', { level: 'P0', features: ['F1', 'F2'] }), design('r1'), open('q1'), open('q2', { features: ['F1'] })];

  it('is always there, and the counts of the line equal the rows of the feature in the problems table', async () => {
    const host = await show(data(ROWS));
    const total = Array.from(block(host).querySelectorAll('button[data-count-type]')).reduce((sum, one) => sum + Number(one.textContent), 0);
    expect(total).toBe(rowsOfFeature(ROWS, 'F2').length);
    expect(issues(host).querySelector('h2')?.textContent).toBe(marked['page.feature.block.problems']);
    cleanup();
    const empty = await show(data([]));
    expect(issues(empty)).not.toBeNull();
    expect(issues(empty).querySelectorAll('h3[data-problem-type]')).toHaveLength(3);
  });

  it('has three sub-sections (h3 with their type), in order, each with its rows in the default order', async () => {
    const host = await show(data(ROWS));
    const panel = issues(host);
    expect(headings(panel)).toEqual([marked['page.problems.type.defect'], marked['page.problems.type.design'], marked['page.problems.type.open']]);
    expect(Array.from(panel.querySelectorAll('details[data-problem]')).map((one) => one.getAttribute('data-problem'))).toEqual(['d2', 'd1', 'r1', 'q1']);
    const level = (id: string): string | undefined => fold(host, id).querySelector('summary .lvl')?.textContent ?? undefined;
    expect([level('d2'), level('d1'), level('r1'), level('q1')]).toEqual(['P0', 'P2', marked['chapter.review.impact.high'], undefined]);
    expect(fold(host, 'q1').querySelector('summary')?.textContent).toContain(d('question q1'));
  });

  it('shows the body of a row in its fold, with the keys and ids of problems, never the numbering of the chapter headings', async () => {
    const host = await show(data(ROWS));
    const one = fold(host, 'd1');
    expect(one.getAttribute('data-key')).toBe('p-d1');
    expect(one.querySelector('#problem-d1')?.textContent).toContain(d('product text d1'));
    expect(host.querySelectorAll('#problem-d1')).toHaveLength(1);
    expect(Array.from(issues(host).querySelectorAll('[id^="h-"]'))).toHaveLength(0);
    expect(Array.from(issues(host).querySelectorAll('h3[data-problem-type]')).map((one) => one.id)).toEqual(['prob-defect', 'prob-design', 'prob-open']);
    expect(fold(host, 'r1').textContent).toContain(d('situation r1'));
  });

  it('expands all the problem folds with one button', async () => {
    const host = await show(data(ROWS));
    const all = issues(host).querySelector('.panel-head .all') as HTMLElement;
    expect(all.textContent).toBe(marked['page.feature.expandAll']);
    click(all);
    expect(Array.from(issues(host).querySelectorAll('details[data-problem]')).every((one) => (one as HTMLDetailsElement).open)).toBe(true);
    expect((issues(host).querySelector('.panel-head .all') as HTMLElement).textContent).toBe(marked['page.feature.collapseAll']);
  });

  it('writes the fixed "None." under a sub-section with no rows whose source is ok', async () => {
    const host = await show(data([design('r1')]));
    const none = Array.from(issues(host).querySelectorAll('p.muted')).map((one) => one.textContent);
    expect(none).toEqual([marked['chapter.none'], marked['chapter.none']]);
  });

  it('shows a defect that names two features in the block of each', async () => {
    const rows = [row('both', { features: ['F1', 'F2'] }), row('only1', { features: ['F1'] })];
    const second = await show(data(rows));
    expect(Array.from(issues(second).querySelectorAll('details[data-problem]')).map((one) => one.getAttribute('data-problem'))).toEqual(['both']);
    cleanup();
    const first = await show(data(rows), '#/product/chapter/F1');
    expect(Array.from(issues(first).querySelectorAll('details[data-problem]')).map((one) => one.getAttribute('data-problem'))).toEqual(['both', 'only1']);
  });

  it('writes the state of the design list when it is not ok, with no rows', async () => {
    const host = await show(data([row('d1'), design('r1')], { sources: sourcesOf('ok', 'missing', 'ok') }));
    const line = issues(host).querySelector('[data-part="issues-state"][data-source="design"]') as HTMLElement;
    expect(line.textContent).toBe(S('page.problems.state.missing', { source: marked['page.problems.type.design'] }));
    expect(fold(host, 'r1')).toBeNull();
  });

  it('writes the unmatched line when the chapter has no points-to-confirm heading, and the chapter section is a block of its own', async () => {
    const body = text(`## ${marked['chapter.section.overview']}`, '', d('Lead words.'), '', `## ${d('Questions')}`, '', `- ${d('Nobody knows the limit.')}`, '');
    const host = await show(data([row('d1')], { sources: sourcesOf('ok', 'ok', 'ok', ['F2']) }, body));
    const line = issues(host).querySelector('[data-part="issues-open-unmatched"]') as HTMLElement;
    expect(line.textContent).toBe(S('page.feature.problems.openUnmatched', { heading: marked['chapter.openQuestions'] }));
    const own = host.querySelector('section.fblock[data-block="other"]') as HTMLElement;
    expect(own.querySelector('h2')?.textContent).toBe(d('Questions'));
    expect(own.textContent).toContain(d('Nobody knows the limit.'));
    expect(own.nextElementSibling).toBe(issues(host));
    expect(issues(host).textContent).not.toContain(d('Nobody knows the limit.'));
  });

  describe('when the defects chapter cannot be used', () => {
    const BODY = text(
      `## ${marked['chapter.section.overview']}`, '', d('Lead words.'), '',
      `## ${marked['chapter.openQuestions']}`, '', `- ${d('Nobody can tell how long drafts live.')}`, '',
      `## ${marked['chapter.problems']}`, '', d('Problem intro words.'), '', `### ${d('Double send')}`, '', `${d('Sending twice makes two orders.')}`, '',
    );
    const fallback = (state: 'missing' | 'failed' | 'changed') => data([design('r1')], { sources: sourcesOf(state, 'ok', 'ok') }, BODY);

    it('shows the chapter\'s own problems section in the defects sub-section, with the reason above it', async () => {
      for (const state of ['missing', 'failed', 'changed'] as const) {
        const host = await show(fallback(state));
        const panel = issues(host);
        expect(panel.querySelector('[data-part="issues-unranked"]')?.textContent).toBe(S('page.feature.problems.unranked', { reason: marked[`page.problems.count.${state}`] }));
        expect(panel.textContent).toContain(d('Problem intro words.'));
        const double = Array.from(panel.querySelectorAll('details.item h4')).find((one) => one.textContent === d('Double send')) as HTMLElement;
        expect(double).toBeDefined();
        expect(double.id).toMatch(/^h-\d+$/);
        expect(panel.querySelector('details[data-problem="r1"]')).not.toBeNull();
        cleanup();
      }
    });

    it('shows the state in words in place of the defect count, since the chapter\'s own items are not rows', async () => {
      const host = await show(fallback('failed'));
      expect(block(host).querySelector('[data-count-type="defect"]')).toBeNull();
      expect(squash(block(host).querySelector('[data-source="defect"]'))).toBe(`${marked['page.problems.type.defect']} ${marked['page.problems.count.failed']}`);
    });

    it('writes "None." when the chapter has no problems section either', async () => {
      const host = await show(data([], { sources: sourcesOf('missing', 'ok', 'ok') }, text(`## ${marked['chapter.section.overview']}`, '', d('Lead words.'), '')));
      const defects = issues(host).querySelector('[data-part="issues-unranked"]') as HTMLElement;
      expect((defects.nextElementSibling as HTMLElement).textContent).toBe(marked['chapter.none']);
    });

    it('keeps the numbers of the headings: the heading of the problems section and of the open questions, once each, in the problems block; the item is jumped to', async () => {
      const host = await show(fallback('missing'));
      // overview 0, openQuestions 1, problems 2, item 3
      for (const n of [1, 2, 3]) expect(host.querySelectorAll(`#h-${n}`), `h-${n}`).toHaveLength(1);
      expect(issues(host).contains(host.querySelector('#h-1'))).toBe(true);
      expect(issues(host).contains(host.querySelector('#h-2'))).toBe(true);
      expect(host.querySelector('#h-1')?.textContent).toBe(marked['page.problems.type.open']);
      expect(host.querySelector('#h-2')?.textContent).toBe(marked['page.problems.type.defect']);
      expect(host.querySelector('#h-3')?.tagName).toBe('H4');
      expect(host.querySelector('#h-1')?.getAttribute('data-problem-type')).toBe('open');
      expect(host.querySelector('#h-2')?.getAttribute('data-problem-type')).toBe('defect');
      jumpToHeading('F2', 3);
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)); });
      expect((host.querySelector('#h-3') as HTMLElement).closest('details')?.open).toBe(true);
    });

    it('keeps the anchors of the two headings also when the sources are ok, and leaves the chapter\'s own items out', async () => {
      const host = await show(data([], {}, BODY));
      expect(host.querySelectorAll('#h-1')).toHaveLength(1);
      expect(host.querySelectorAll('#h-2')).toHaveLength(1);
      expect(host.querySelector('#h-3')).toBeNull();
      expect(host.textContent).not.toContain(d('Double send'));
      expect(host.textContent).not.toContain(d('Nobody can tell how long drafts live.'));
      jumpToHeading('F2', 2);
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)); });
      expect(document.activeElement).toBe(host.querySelector('#h-2'));
    });
  });
});

describe('the count of the model', () => {
  it('is the number of rows that name the feature, for every feature and system, and is the one the problems table filters to', () => {
    const rows = [row('a'), row('b', { features: ['F1', 'F2'] }), open('q', { features: ['system'] })];
    const html = renderToStaticMarkup(<AppView data={data(rows)} route={parseHash('#/product/chapter/F1')} />);
    const counts = Array.from(html.matchAll(/data-page="chapter:(F\d)"[^>]*>(?:(?!<\/a>).)*?data-part="problem-count">(\d+)</g)).map((found) => [found[1], Number(found[2])]);
    expect(counts).toEqual([['F1', 1], ['F2', 2], ['F3', 0], ['F4', 0]]);
    expect(NO_PROBLEMS.rows).toHaveLength(0);
  });
});
