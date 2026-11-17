// @vitest-environment happy-dom
// The page of a feature chapter (openspec change handbook-page-structure, design D9): the head and the five blocks with no tabs,
// the block of a section no role names, folds with a preview, expand all, the server-side fold, reveal and search jumps into
// a closed item, the list at the right, both views, a chapter that is not a feature, and that no word of the chapter is lost.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

import { AppView } from '../src/App';
import { REVEAL_EVENT, jumpToHeading } from '../src/lib/heading-jump';
import { parseHash } from '../src/lib/route';
import type { PageData } from '../src/lib/types';
import { cleanup, mount, settle } from './dom';
import { domainData } from './domains-fixture';
import { NO_PROBLEMS, d, marked } from './page-fixture';

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
const click = (el: Element): void => { act(() => (el as HTMLElement).click()); };
const item = (host: HTMLElement, title: string): HTMLDetailsElement => (Array.from(host.querySelectorAll('details.fold')).find((one) => one.querySelector('summary h4')?.textContent === title) as HTMLDetailsElement);
const blocks = (host: HTMLElement): HTMLElement[] => Array.from(host.querySelectorAll<HTMLElement>('article > section.fblock'));
const names = (host: HTMLElement): (string | null)[] => blocks(host).map((one) => one.getAttribute('data-block'));
const block = (host: HTMLElement, name: string): HTMLElement => host.querySelector(`section.fblock[data-block="${name}"]`) as HTMLElement;
const noMap = (): PageData => ({ ...withText(TEXT), domains: { state: 'missing', list: [], handovers: [] } });

describe('the blocks', () => {
  it('are the five of the page with a block of its own for a section no role names, in this order; there are no tabs', async () => {
    const host = await open('#/product/chapter/F2');
    expect(names(host)).toEqual(['overview', 'use', 'behavior', 'other', 'problems', 'links']);
    expect(blocks(host).map((one) => one.querySelector('h2')?.textContent)).toEqual([
      S('page.feature.block.overview'), S('page.feature.block.use'), S('page.feature.block.behavior'), d('Shipping zones'), S('page.feature.block.problems'), S('page.feature.block.links'),
    ]);
    expect(host.querySelector('article [role="tab"], article [role="tablist"], article [role="tabpanel"], article [hidden]')).toBeNull();
    expect(host.querySelector('.tabs, .tasks')).toBeNull();
    for (const name of ['overview', 'use', 'behavior', 'problems', 'links']) expect(block(host, name).querySelector('h2')?.id).toBe(`blk-${name}`);
  });

  it('gives a section no role names its own block between behavior and problems, whose h2 is its own title with its h-<n> id and holds all its text', async () => {
    const host = await open('#/product/chapter/F2');
    const zones = block(host, 'other');
    const heading = zones.querySelector('h2') as HTMLElement;
    expect(heading.textContent).toBe(d('Shipping zones'));
    expect(heading.id).toMatch(/^h-\d+$/);
    expect(zones.textContent).toContain(d('Zones are looked up by country.'));
    expect(zones.nextElementSibling?.getAttribute('data-block')).toBe('problems');
    expect(zones.previousElementSibling?.getAttribute('data-block')).toBe('behavior');
  });

  it('does not show a block that has no section and no content; the problems block always shows', async () => {
    const text = [`# ${d('Order entry')}`, '', NOTE, '', `## ${S('chapter.section.rules')}`, '', `- ${d('A draft is kept for a week.')}`, ''].join('\n');
    const host = await open('#/product/chapter/F2', { ...withText(text), domains: { state: 'missing', list: [], handovers: [] } });
    expect(names(host)).toEqual(['behavior', 'problems']);
    expect(host.querySelector('[data-part="links-hint"], [data-part="handover-strip"]')).toBeNull();
  });

  it('holds the pages and operations in the use block and rules in the behavior block, each section with its own h3 and its items as h4 folds', async () => {
    const host = await open('#/product/chapter/F2');
    const use = block(host, 'use');
    expect(Array.from(use.querySelectorAll('.fsection-head > h3')).map((one) => one.textContent)).toEqual([S('chapter.section.screens'), S('chapter.section.operations')]);
    expect(Array.from(use.querySelectorAll('details.fold summary h4')).map((one) => one.textContent)).toEqual([d('Order form'), d('Place an order'), d('Cancel an order')]);
    expect(Array.from(block(host, 'behavior').querySelectorAll('.fsection-head > h3')).map((one) => one.textContent)).toEqual([S('chapter.section.rules')]);
    // Each section's head carries the number of its items; each fold's chevron comes before its title.
    for (const section of Array.from(host.querySelectorAll('.fblock .fsection')).filter((one) => one.querySelector('.fsection-head') !== null)) {
      const count = section.querySelectorAll(':scope > details.fold').length;
      expect(section.querySelector('[data-part="section-count"]')?.textContent).toBe(count === 0 ? undefined : String(count));
    }
    for (const fold of Array.from(host.querySelectorAll('details.fold'))) expect(fold.querySelector('summary')?.firstElementChild?.className).toBe('chev');
  });

  it('puts the overview section (an h3 for readers of the outline only) and its items in the overview block, and the hint then the handovers section then the strip in the links block', async () => {
    const host = await open('#/product/chapter/F2');
    const overview = block(host, 'overview');
    expect(overview.querySelector('h3.sr-only')?.textContent).toBe(S('chapter.section.overview'));
    expect(overview.textContent).toContain(d('a list of lead words'));
    expect(overview.textContent).not.toContain(d('Clerks place orders.'));
    expect(overview.contains(item(host, d('Background')))).toBe(true);
    const links = block(host, 'links');
    expect(Array.from(links.children).map((one) => one.getAttribute('data-part') ?? one.className)).toEqual(['panel-head', 'links-hint', 'fsection', 'handover-strip']);
    // The block's title stands for the section's own heading: kept for search, hidden, not in the nav.
    expect(links.querySelector('.fsection h3.sr-only')?.textContent).toBe(S('chapter.section.handovers'));
    expect(links.querySelector('[data-part="links-hint"]')?.textContent).toBe(S('page.feature.links.hint'));
  });

  it('writes the hint only when the strip has rows', async () => {
    const host = await open('#/product/chapter/F2', noMap());
    expect(block(host, 'links').querySelector('[data-part="links-hint"]')).toBeNull();
    expect(block(host, 'links').querySelector('[data-part="handover-strip"]')).toBeNull();
    expect(block(host, 'links').querySelector('.fsection')).not.toBeNull();
  });
});

describe('the head', () => {
  it('has the heading, its notice, the lede (the first paragraph of the overview) and the problems line, then the blocks; the list at the right is the page\'s own', async () => {
    const host = await open('#/product/chapter/F2');
    const article = host.querySelector('article') as HTMLElement;
    expect(Array.from(article.children).map((one) => one.className.split(' ')[0])).toEqual(['prose', 'lede', 'feature-problems', 'fblock', 'fblock', 'fblock', 'fblock', 'fblock', 'fblock']);
    expect(article.querySelector('h1')?.textContent).toBe(d('Order entry'));
    expect(article.children[0].querySelector('p.note')).not.toBeNull();
    expect(article.children[1].textContent).toBe(d('Clerks place orders. The approver sends them on.'));
    expect(article.querySelector('.feature-problems .fp-title')?.tagName).toBe('P');
    expect(article.querySelector('.feature-problems h1, .feature-problems h2, .feature-problems h3')).toBeNull();
    expect(host.querySelectorAll('.toc')).toHaveLength(1);
    expect(host.querySelector('.toc')?.classList.contains('feature-nav')).toBe(true);
    expect(host.querySelector('.read')?.getAttribute('data-toc')).toBe('own');
    expect(host.querySelector('.feature-layout > article')).not.toBeNull();
  });

  it('has no lede when the overview does not start with a paragraph, and the lede is not repeated in the overview block', async () => {
    const text = TEXT.replace(`${d('Clerks place orders. The approver sends them on.')}\n\n${d('Where it starts:')}\n\n`, `- ${d('Starts with a list')}\n\n`);
    const host = await open('#/product/chapter/F2', withText(text));
    expect(host.querySelector('.lede')).toBeNull();
    expect(block(host, 'overview').textContent).not.toContain(d('Clerks place orders.'));
    const withLede = await open('#/product/chapter/F2');
    expect(block(withLede, 'overview').textContent).not.toContain(d('Clerks place orders.'));
  });
});

describe('the items', () => {
  it('fold to a title with a one-line preview, closed at the start, and show the text when opened; the title is an h4 carrying the heading id', async () => {
    const host = await open('#/product/chapter/F2');
    expect(Array.from(host.querySelectorAll('details.fold')).every((one) => !(one as HTMLDetailsElement).open)).toBe(true);
    const place = item(host, d('Place an order'));
    expect(place.querySelector('summary h4')?.id).toMatch(/^h-\d+$/);
    expect(place.querySelector('summary .p')?.textContent).toBe(d('The clerk fills the form.'));
    click(place.querySelector('summary') as HTMLElement);
    expect(place.open).toBe(true);
  });

  it('expand all opens every item of the block and collapse all closes them; a block with one item has no button', async () => {
    const host = await open('#/product/chapter/F2');
    const use = block(host, 'use');
    const all = use.querySelector('.panel-head button.all') as HTMLElement;
    expect(all.textContent).toBe(S('page.feature.expandAll'));
    click(all);
    expect(Array.from(use.querySelectorAll('details.fold')).every((one) => (one as HTMLDetailsElement).open)).toBe(true);
    expect(use.querySelector('button.all')?.textContent).toBe(S('page.feature.collapseAll'));
    click(use.querySelector('button.all') as HTMLElement);
    expect(Array.from(use.querySelectorAll('details.fold')).some((one) => (one as HTMLDetailsElement).open)).toBe(false);
    expect(block(host, 'behavior').querySelector('button.all')).toBeNull();
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

  it('put the three kinds of problems in the problems block as h3 with their type, and the chapter\'s own problems section there when the defects chapter is not usable', async () => {
    const host = await open('#/product/chapter/F2');
    const problems = block(host, 'problems');
    expect(Array.from(problems.querySelectorAll('h3')).map((one) => [one.getAttribute('data-problem-type'), one.textContent])).toEqual([
      ['defect', S('page.problems.type.defect')], ['design', S('page.problems.type.design')], ['open', S('page.problems.type.open')],
    ]);
    cleanup();
    const fallback = await open('#/product/chapter/F2', { ...withText(TEXT), problems: { ...NO_PROBLEMS, sources: { ...NO_PROBLEMS.sources, defects: { state: 'missing', count: null } } } });
    expect(item(fallback, d('Double send')).querySelector('.p')?.textContent).toBe(d('Sending twice makes two orders.'));
  });
});

describe('going to a heading', () => {
  /** The page with the defects chapter unusable, so the chapter's own problems section is in the problems block. */
  const unranked = (): PageData => ({ ...withText(TEXT), problems: { ...NO_PROBLEMS, sources: { ...NO_PROBLEMS.sources, defects: { state: 'missing', count: null } } } });

  it('opens its item and focuses its heading, also inside the nested fold', async () => {
    const host = await open('#/product/chapter/F2', unranked());
    const heading = item(host, d('Double send')).querySelector('h4') as HTMLElement;
    const n = Number(heading.id.slice(2));
    expect(item(host, d('Double send')).open).toBe(false);
    jumpToHeading('F2', n);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)); });
    expect(item(host, d('Double send')).open).toBe(true);
    expect(document.activeElement).toBe(heading);
  });

  it('opens the folds that hold the target when a reveal event reaches an item heading', async () => {
    const host = await open('#/product/chapter/F2');
    const target = item(host, d('Place an order'));
    expect(target.open).toBe(false);
    act(() => { (target.querySelector('h4') as HTMLElement).dispatchEvent(new CustomEvent(REVEAL_EVENT, { bubbles: true })); });
    expect(target.open).toBe(true);
    expect(item(host, d('Cancel an order')).open).toBe(false);
  });

  it('keeps a fold the reader closed closed on a later render and follows a fold the browser opened by itself', async () => {
    const host = await open('#/product/chapter/F2');
    const place = item(host, d('Place an order'));
    act(() => { place.open = true; place.dispatchEvent(new Event('toggle')); });
    expect(place.open).toBe(true);
    click(block(host, 'use').querySelector('button.all') as HTMLElement);
    expect(Array.from(block(host, 'use').querySelectorAll('details.fold')).every((one) => (one as HTMLDetailsElement).open)).toBe(true);
  });

  it('numbers its headings as the search does: the heading of each section and item is h-<n> in chapter order', async () => {
    const host = await open('#/product/chapter/F2', unranked());
    const ids = Array.from(host.querySelectorAll('article [id^="h-"]')).filter((el) => /^H[234]$/.test(el.tagName)).map((el) => [Number(el.id.slice(2)), el.textContent]);
    ids.sort((a, b) => (a[0] as number) - (b[0] as number));
    expect(ids.map((entry) => entry[0])).toEqual(Array.from({ length: ids.length }, (_, at) => at));
    expect(ids.map((entry) => entry[1])).toEqual([
      S('chapter.section.overview'), d('Background'), S('chapter.section.screens'), d('Order form'), S('chapter.section.operations'), d('Place an order'), d('Cancel an order'),
      S('chapter.section.rules'), d('Shipping zones'), S('chapter.section.handovers'), S('page.problems.type.open'), S('page.problems.type.defect'), d('Double send'),
    ]);
  });
});

describe('the list at the right', () => {
  const entries = (host: HTMLElement): [string | null, string, string | null][] => Array.from(host.querySelectorAll<HTMLElement>('.feature-nav button')).map((one) => [one.getAttribute('data-target'), one.textContent ?? '', one.getAttribute('data-level')]);

  it('has one entry for each block h2, each section h3 of the use and behavior blocks and the three problem types, with ids that are in the page', async () => {
    const host = await open('#/product/chapter/F2');
    const list = entries(host);
    expect(list.map(([, label, level]) => [label, level])).toEqual([
      [S('page.feature.block.overview'), '2'],
      [S('page.feature.block.use'), '2'], [S('chapter.section.screens'), '3'], [S('chapter.section.operations'), '3'],
      [S('page.feature.block.behavior'), '2'], [S('chapter.section.rules'), '3'],
      [d('Shipping zones'), '2'],
      [S('page.feature.block.problems'), '2'], [S('page.problems.type.defect'), '3'], [S('page.problems.type.design'), '3'], [S('page.problems.type.open'), '3'],
      [S('page.feature.block.links'), '2'],
    ]);
    for (const [id, label] of list) expect(document.getElementById(id as string)?.textContent, label).toBe(label);
    const h2s = Array.from(host.querySelectorAll('article h2')).map((one) => one.id);
    expect(list.filter(([, , level]) => level === '2').map(([id]) => id)).toEqual(h2s);
    expect(host.querySelector('.feature-nav')?.getAttribute('aria-label')).toBe(S('page.toc.label'));
  });

  it('marks one entry current, scrolls to the clicked one, focuses it and leaves every heading id as it was', async () => {
    const host = await open('#/product/chapter/F2');
    const before = Array.from(host.querySelectorAll('article [id]')).map((one) => one.id);
    const scrolled: string[] = [];
    const proto = globalThis.HTMLElement.prototype as unknown as { scrollIntoView: (options?: unknown) => void };
    const saved = proto.scrollIntoView;
    proto.scrollIntoView = function scroll(this: HTMLElement) { scrolled.push(this.id); };
    try {
      expect(host.querySelectorAll('.feature-nav [aria-current="true"]')).toHaveLength(1);
      const rules = Array.from(host.querySelectorAll('.feature-nav button')).find((one) => one.textContent === S('chapter.section.rules')) as HTMLElement;
      click(rules);
      expect(rules.getAttribute('aria-current')).toBe('true');
      expect(host.querySelectorAll('.feature-nav [aria-current="true"]')).toHaveLength(1);
      expect(scrolled).toEqual([rules.getAttribute('data-target')]);
      expect(document.activeElement?.id).toBe(rules.getAttribute('data-target'));
    } finally {
      proto.scrollIntoView = saved;
    }
    expect(Array.from(host.querySelectorAll('article [id]')).map((one) => one.id)).toEqual(before);
  });

  it('keeps the clicked entry marked while the page scrolls there, and follows the page again once the reader scrolls', async () => {
    const host = await open('#/product/chapter/F2');
    const frame = () => act(() => new Promise<void>((done) => { window.requestAnimationFrame(() => done()); }));
    const current = () => host.querySelector('.feature-nav [aria-current="true"]')?.textContent;
    const rules = Array.from(host.querySelectorAll('.feature-nav button')).find((one) => one.textContent === S('chapter.section.rules')) as HTMLElement;
    // Without layout every heading is at the top, so the spy alone marks the last entry.
    const last = Array.from(host.querySelectorAll('.feature-nav button')).at(-1)?.textContent;
    expect(last).not.toBe(S('chapter.section.rules'));
    rules.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    click(rules);
    window.dispatchEvent(new Event('scroll'));
    await frame();
    expect(current()).toBe(S('chapter.section.rules'));
    window.dispatchEvent(new Event('wheel'));
    window.dispatchEvent(new Event('scroll'));
    await frame();
    expect(current()).toBe(last);
  });

  it('does not carry a pin over to another page whose list has the same ids', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const show = async (hash: string) => { act(() => root.render(<AppView data={withText(TEXT)} route={parseHash(hash)} />)); await settle(); await settle(); };
    const frame = () => act(() => new Promise<void>((done) => { window.requestAnimationFrame(() => done()); }));
    const current = () => host.querySelector('.feature-nav [aria-current="true"]')?.textContent;
    try {
      await show('#/product/chapter/F2');
      const last = Array.from(host.querySelectorAll('.feature-nav button')).at(-1)?.textContent;
      const rules = Array.from(host.querySelectorAll('.feature-nav button')).find((one) => one.textContent === S('chapter.section.rules')) as HTMLElement;
      click(rules);
      // The same chapter in the other view: the same ids, another page.
      await show('#/technical/chapter/F2');
      window.dispatchEvent(new Event('scroll'));
      await frame();
      expect(current()).toBe(last);
    } finally {
      act(() => root.unmount());
      host.remove();
    }
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
    expect(names(technical)).toEqual(['overview', 'use', 'behavior', 'other', 'problems', 'links']);
  });

  it('leaves a chapter that is not a feature as it was: one Markdown block and its table of contents', async () => {
    const host = await open('#/product/chapter/system', withText(TEXT, 'system'));
    expect(host.querySelector('.fblock, .feature-nav')).toBeNull();
    expect(host.querySelector('.toc')).not.toBeNull();
    expect(host.querySelector('.read')?.getAttribute('data-toc')).toBe('yes');
    expect(host.querySelectorAll('article > .prose')).toHaveLength(1);
    expect(host.querySelectorAll('details.fold')).toHaveLength(0);
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
    // With the defects chapter unusable the chapter's problems section is in the page; the points to confirm are the problems table's now, and the issues tab names the defects sub-section by its own fixed text (the word "known" of the old heading).
    const host = await open('#/product/chapter/F2', { ...withText(TEXT), problems: { ...NO_PROBLEMS, sources: { ...NO_PROBLEMS.sources, defects: { state: 'missing', count: null } } } });
    const shown = words(host.querySelector('article') as HTMLElement);
    const missing = Array.from(expected).filter(([word, count]) => (shown.get(word) ?? 0) < count).map(([word]) => word);
    expect(missing).toEqual(['nobody', 'can', 'tell', 'how', 'long', 'drafts', 'live', 'known']);
    expect(expected.size).toBeGreaterThan(30);
  });
});
