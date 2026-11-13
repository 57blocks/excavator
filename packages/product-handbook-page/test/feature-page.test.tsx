// @vitest-environment happy-dom
// The page of a feature chapter (openspec change handbook-feature-page, design D3): the head and tabs, the roles of the
// sections, the lists on the overview, folds with a preview, expand all, the server-side fold, find-in-page and search
// jumps into a closed item, both views, a chapter that is not a feature, and that no word of the chapter is lost.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';

import { AppView } from '../src/App';
import { jumpToHeading } from '../src/lib/heading-jump';
import { parseHash } from '../src/lib/route';
import type { PageData } from '../src/lib/types';
import { cleanup, mount, settle } from './dom';
import { domainData } from './domains-fixture';
import { d, marked } from './page-fixture';

const mermaid = vi.hoisted(() => ({ initialize: vi.fn(), render: vi.fn(), parse: vi.fn() }));
vi.mock('mermaid', () => ({ default: mermaid }));

beforeEach(() => {
  mermaid.parse.mockImplementation(async () => ({ diagramType: 'flowchart' }));
  mermaid.render.mockImplementation(async (id: string) => ({ svg: `<svg data-id="${id}"></svg>` }));
});
afterEach(cleanup);

const S = (key: string): string => marked[key];
const NOTE = marked['chapter.notVerified'];
const STEPS = marked['chapter.serverSteps'];

/** A feature chapter with every role, a section no role names, a server-side fold, a diagram and a citation. */
const TEXT = [
  `# ${d('Order entry')}`, '', NOTE, '',
  `## ${S('chapter.section.overview')}`, '',
  `${d('Clerks place orders. The approver sends them on.')}`, '',
  `${d('Where it starts:')}`, '', `- ${d('a list of lead words')}`, '',
  `### ${d('Background')}`, '', `${d('Why orders exist.')} (\`src/orders/a.js:1-2\`)`, '',
  `## ${S('chapter.section.screens')}`, '', `${d('Screen intro words.')}`, '',
  `### ${d('Order form')}`, '', `${d('The form holds the fields.')}`, '',
  `## ${S('chapter.section.operations')}`, '', `${d('Operation intro words.')}`, '',
  `### ${d('Place an order')}`, '', `1. ${d('The clerk fills the form.')}`, `2. ${d('The clerk sends it.')}`, '', STEPS, '', `3. ${d('The server stores the order.')}`, '',
  `### ${d('Cancel an order')}`, '', `${d('Cancelling frees the stock.')}`, '', '```mermaid\nstateDiagram-v2\n  Draft\n  [*] --> Draft\n```', '',
  `## ${S('chapter.section.rules')}`, '', `- ${d('A draft is kept for a week.')}`, '',
  `## ${d('Shipping zones')}`, '', `${d('Zones are looked up by country.')}`, '',
  `## ${S('chapter.section.handovers')}`, '', `${d('Billing takes the order next.')}`, '',
  `## ${S('chapter.openQuestions')}`, '', `- ${d('Nobody can tell how long drafts live.')}`, '',
  `## ${S('chapter.problems')}`, '', `### ${d('Double send')}`, '', `${d('Sending twice makes two orders.')}`, '',
].join('\n');

const withText = (text: string, id = 'F2'): PageData => {
  const data = domainData();
  return { ...data, chapters: data.chapters.map((one) => (one.id === id ? { id, texts: { product: text, technical: text } } : one)) };
};
const open = async (hash: string, data: PageData = withText(TEXT)): Promise<HTMLElement> => {
  const host = mount(<AppView data={data} route={parseHash(hash)} />);
  await settle();
  await settle();
  return host;
};
const tabs = (host: HTMLElement): HTMLElement[] => Array.from(host.querySelectorAll<HTMLElement>('[role="tab"]'));
const selected = (host: HTMLElement): string => tabs(host).find((tab) => tab.getAttribute('aria-selected') === 'true')?.textContent ?? '';
const panelOf = (host: HTMLElement, label: string): HTMLElement => {
  const tab = tabs(host).find((one) => one.textContent?.startsWith(label)) as HTMLElement;
  return host.querySelector(`#${CSS.escape(tab.getAttribute('aria-controls') as string)}`) as HTMLElement;
};
const click = (el: Element): void => { act(() => (el as HTMLElement).click()); };
const item = (host: HTMLElement, title: string): HTMLDetailsElement => (Array.from(host.querySelectorAll('details.item')).find((one) => one.querySelector('summary h3')?.textContent === title) as HTMLDetailsElement);

describe('the tabs', () => {
  it('are the overview, one per section with its own role or none, and the issues; hand-overs sit on the overview', async () => {
    const host = await open('#/product/chapter/F2');
    expect(tabs(host).map((tab) => tab.textContent)).toEqual([
      S('page.feature.overview'), `${S('chapter.section.screens')}1`, `${S('chapter.section.operations')}2`, `${S('chapter.section.rules')}`, d('Shipping zones'), S('page.feature.issues'),
    ]);
    expect(host.querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe(S('page.feature.tabs'));
    expect(selected(host)).toBe(S('page.feature.overview'));
    const panels = Array.from(host.querySelectorAll('[role="tabpanel"]'));
    expect(panels.map((panel) => panel.hasAttribute('hidden'))).toEqual([false, true, true, true, true, true]);
    expect(panels[1].getAttribute('hidden')).toBe('until-found');
    expect(tabs(host).every((tab) => host.querySelector(`#${CSS.escape(tab.getAttribute('aria-controls') as string)}`)?.getAttribute('aria-labelledby') === tab.id)).toBe(true);
  });

  it('give a section no role names its own tab with all its text', async () => {
    const host = await open('#/product/chapter/F2');
    const zones = panelOf(host, d('Shipping zones'));
    expect(zones.textContent).toContain(d('Zones are looked up by country.'));
    expect(zones.querySelector('h2')?.textContent).toBe(d('Shipping zones'));
  });

  it('select with a click and move with the arrow keys, Home and End', async () => {
    const host = await open('#/product/chapter/F2');
    click(tabs(host)[2]);
    expect(selected(host)).toMatch(new RegExp(`^${S('chapter.section.operations')}`));
    expect(panelOf(host, S('chapter.section.operations')).hasAttribute('hidden')).toBe(false);
    expect(panelOf(host, S('page.feature.overview')).getAttribute('hidden')).toBe('until-found');
    const key = (name: string): void => { act(() => { (document.activeElement as HTMLElement ?? tabs(host)[2]).dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })); }); };
    tabs(host)[2].focus();
    key('ArrowRight');
    expect(selected(host)).toBe(S('chapter.section.rules'));
    expect(document.activeElement).toBe(tabs(host)[3]);
    key('End');
    expect(selected(host)).toBe(S('page.feature.issues'));
    key('ArrowRight');
    expect(selected(host)).toBe(S('page.feature.overview'));
    key('ArrowLeft');
    expect(selected(host)).toBe(S('page.feature.issues'));
    key('Home');
    expect(selected(host)).toBe(S('page.feature.overview'));
  });

  it('are shown again by the browser find: a beforematch on a hidden panel selects its tab', async () => {
    const host = await open('#/product/chapter/F2');
    const rules = panelOf(host, S('chapter.section.rules'));
    act(() => { rules.dispatchEvent(new Event('beforematch', { bubbles: true })); });
    expect(selected(host)).toBe(S('chapter.section.rules'));
    expect(rules.hasAttribute('hidden')).toBe(false);
  });
});

describe('the head', () => {
  it('has the heading, its notice, the lede (the first paragraph of the overview), the hand-over strip and then the tabs', async () => {
    const host = await open('#/product/chapter/F2');
    const article = host.querySelector('article') as HTMLElement;
    expect(Array.from(article.children).map((one) => one.className.split(' ')[0])).toEqual(['prose', 'lede', 'strip', 'tabs', 'panel', 'panel', 'panel', 'panel', 'panel', 'panel']);
    expect(article.querySelector('h1')?.textContent).toBe(d('Order entry'));
    expect(article.children[0].querySelector('p.note')).not.toBeNull();
    expect(article.children[1].textContent).toBe(d('Clerks place orders. The approver sends them on.'));
    expect(host.querySelector('.toc')).toBeNull();
    expect(host.querySelector('.read')?.getAttribute('data-toc')).toBe('none');
  });

  it('has no lede when the overview does not start with a paragraph, and the lede is not repeated in the overview tab', async () => {
    const text = TEXT.replace(`${d('Clerks place orders. The approver sends them on.')}\n\n${d('Where it starts:')}\n\n`, `- ${d('Starts with a list')}\n\n`);
    const host = await open('#/product/chapter/F2', withText(text));
    expect(host.querySelector('.lede')).toBeNull();
    const overview = panelOf(host, S('page.feature.overview'));
    expect(overview.textContent).not.toContain(d('Clerks place orders.'));
    const withLede = await open('#/product/chapter/F2');
    expect(panelOf(withLede, S('page.feature.overview')).textContent).not.toContain(d('Clerks place orders.'));
  });
});

describe('the overview', () => {
  it('lists what you can do and the pages with a preview, then the hand-overs text, then more details folded', async () => {
    const host = await open('#/product/chapter/F2');
    const overview = panelOf(host, S('page.feature.overview'));
    const subs = Array.from(overview.querySelectorAll('h2.sub')).map((one) => one.textContent);
    expect(subs).toEqual([S('page.feature.canDo'), S('page.feature.screens'), S('chapter.section.handovers'), S('page.feature.more')]);
    const rows = Array.from(overview.querySelectorAll('.tasks')).map((list) => Array.from(list.querySelectorAll('li')).map((li) => [li.querySelector('.t')?.textContent, li.querySelector('.p')?.textContent]));
    expect(rows).toEqual([
      [[d('Place an order'), d('The clerk fills the form.')], [d('Cancel an order'), d('Cancelling frees the stock.')]],
      [[d('Order form'), d('The form holds the fields.')]],
    ]);
    expect(overview.textContent).toContain(d('Billing takes the order next.'));
    const more = item(host, d('Background'));
    expect(overview.contains(more)).toBe(true);
    expect(more.open).toBe(false);
    expect(more.querySelector('.p')?.textContent).toBe(d('Why orders exist.'));
    expect(overview.textContent).toContain(d('a list of lead words'));
  });

  it('opens the operations tab and the item when a row is clicked, and moves the focus to its heading', async () => {
    const host = await open('#/product/chapter/F2');
    const scrolled: string[] = [];
    const proto = globalThis.HTMLElement.prototype as unknown as { scrollIntoView: (options?: unknown) => void };
    const saved = proto.scrollIntoView;
    proto.scrollIntoView = function scroll(this: HTMLElement) { scrolled.push(this.id); };
    try {
      const row = Array.from(host.querySelectorAll('.tasks button')).find((button) => button.textContent?.startsWith(d('Cancel an order'))) as HTMLElement;
      click(row);
      expect(selected(host)).toMatch(new RegExp(`^${S('chapter.section.operations')}`));
      expect(item(host, d('Cancel an order')).open).toBe(true);
      expect(item(host, d('Place an order')).open).toBe(false);
      expect(document.activeElement?.textContent).toBe(d('Cancel an order'));
      expect(scrolled).toEqual([document.activeElement?.id]);
    } finally {
      proto.scrollIntoView = saved;
    }
  });
});

describe('the items', () => {
  it('fold to a title with a one-line preview, and show the text when opened; the title element carries the heading id', async () => {
    const host = await open('#/product/chapter/F2');
    const place = item(host, d('Place an order'));
    expect(place.open).toBe(false);
    expect(place.querySelector('summary h3')?.id).toMatch(/^h-\d+$/);
    expect(place.querySelector('summary .p')?.textContent).toBe(d('The clerk fills the form.'));
    click(place.querySelector('summary') as HTMLElement);
    expect(place.open).toBe(true);
  });

  it('expand all opens every item of the tab and collapse all closes them; a tab with one item has no button', async () => {
    const host = await open('#/product/chapter/F2');
    const operations = panelOf(host, S('chapter.section.operations'));
    const all = operations.querySelector('button.all') as HTMLElement;
    expect(all.textContent).toBe(S('page.feature.expandAll'));
    click(all);
    expect(Array.from(operations.querySelectorAll('details.item')).every((one) => (one as HTMLDetailsElement).open)).toBe(true);
    expect(operations.querySelector('button.all')?.textContent).toBe(S('page.feature.collapseAll'));
    click(operations.querySelector('button.all') as HTMLElement);
    expect(Array.from(operations.querySelectorAll('details.item')).some((one) => (one as HTMLDetailsElement).open)).toBe(false);
    expect(panelOf(host, S('chapter.section.screens')).querySelector('button.all')).toBeNull();
  });

  it('fold the server-side steps of an operation in a nested block titled by the fixed line without its colon', async () => {
    const host = await open('#/product/chapter/F2');
    const place = item(host, d('Place an order'));
    const inner = place.querySelector('details.inner') as HTMLDetailsElement;
    expect(inner.querySelector('summary')?.textContent).toBe(STEPS.replace(/:$/, ''));
    expect(inner.textContent).toContain(d('The server stores the order.'));
    expect(inner.textContent).not.toContain(d('The clerk sends it.'));
    expect(place.textContent).toContain(d('The clerk sends it.'));
    expect(inner.open).toBe(false);
    expect(item(host, d('Cancel an order')).querySelector('details.inner')).toBeNull();
    expect(host.querySelectorAll('.diagram, [data-diagram]').length).toBeGreaterThan(0);
  });

  it('put the open questions and the defects, with their own titles, on the issues tab', async () => {
    const host = await open('#/product/chapter/F2');
    const issues = panelOf(host, S('page.feature.issues'));
    expect(Array.from(issues.querySelectorAll('h2')).map((one) => one.textContent)).toEqual([S('chapter.openQuestions'), S('chapter.problems')]);
    expect(issues.textContent).toContain(d('Nobody can tell how long drafts live.'));
    expect(item(host, d('Double send')).querySelector('.p')?.textContent).toBe(d('Sending twice makes two orders.'));
  });
});

describe('going to a heading', () => {
  it('selects its tab, opens its item and focuses its heading, also inside the nested fold', async () => {
    const host = await open('#/product/chapter/F2');
    const heading = item(host, d('Double send')).querySelector('h3') as HTMLElement;
    const n = Number(heading.id.slice(2));
    expect(item(host, d('Double send')).open).toBe(false);
    jumpToHeading('F2', n);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)); });
    expect(selected(host)).toBe(S('page.feature.issues'));
    expect(item(host, d('Double send')).open).toBe(true);
    expect(document.activeElement).toBe(heading);
  });

  it('numbers its headings as the search does: the heading of each section and item is h-<n> in chapter order', async () => {
    const host = await open('#/product/chapter/F2');
    const ids = Array.from(host.querySelectorAll('article h2[id], article h3[id]')).map((el) => [Number(el.id.slice(2)), el.textContent]);
    ids.sort((a, b) => (a[0] as number) - (b[0] as number));
    expect(ids.map((entry) => entry[0])).toEqual(Array.from({ length: ids.length }, (_, at) => at));
    expect(ids.map((entry) => entry[1])).toEqual([
      S('chapter.section.overview'), d('Background'), S('chapter.section.screens'), d('Order form'), S('chapter.section.operations'), d('Place an order'), d('Cancel an order'),
      S('chapter.section.rules'), d('Shipping zones'), S('chapter.section.handovers'), S('chapter.openQuestions'), S('chapter.problems'), d('Double send'),
    ]);
  });
});

describe('the views and the other pages', () => {
  it('shows the citations of the technical view in the items and none in the product view', async () => {
    const product = await open('#/product/chapter/F2', withText(TEXT.replace('(`src/orders/a.js:1-2`)', '')));
    expect(product.querySelectorAll('.cite')).toHaveLength(0);
    cleanup();
    const technical = await open('#/technical/chapter/F2');
    expect(technical.querySelectorAll('.cite').length).toBeGreaterThan(0);
    expect(item(technical, d('Background')).querySelector('.p')?.textContent).toBe(d('Why orders exist.'));
    expect(tabs(technical)).toHaveLength(6);
  });

  it('leaves a chapter that is not a feature as it was: one Markdown block and its table of contents', async () => {
    const host = await open('#/product/chapter/system', withText(TEXT, 'system'));
    expect(host.querySelector('[role="tablist"]')).toBeNull();
    expect(host.querySelector('.toc')).not.toBeNull();
    expect(host.querySelectorAll('article > .prose')).toHaveLength(1);
    expect(host.querySelectorAll('details.item')).toHaveLength(0);
  });
});

describe('the text of the chapter', () => {
  /** The words of an element, counted; the text nodes are separated so that neighbouring elements do not glue words together. */
  const words = (root: HTMLElement): Map<string, number> => {
    const pieces: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) pieces.push(node.textContent ?? '');
    const count = new Map<string, number>();
    for (const word of pieces.join(' ').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) count.set(word, (count.get(word) ?? 0) + 1);
    return count;
  };

  it('is all in the feature page: every word of the chapter shown as one block is in the page, as often as it is written', async () => {
    const plain = await open('#/product/chapter/system', withText(TEXT, 'system'));
    const reference = plain.querySelector('article') as HTMLElement;
    const expected = words(reference);
    cleanup();
    const host = await open('#/product/chapter/F2');
    const shown = words(host.querySelector('article') as HTMLElement);
    const missing = Array.from(expected).filter(([word, count]) => (shown.get(word) ?? 0) < count).map(([word]) => word);
    expect(missing).toEqual([]);
    expect(expected.size).toBeGreaterThan(30);
  });
});
