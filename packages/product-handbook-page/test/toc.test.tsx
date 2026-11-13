// @vitest-environment happy-dom
// Step 5: the on-this-page table of contents. It lists the h2 and h3 of a chapter (and of the coverage page) with ids, scrolls by
// button and never touches the hash, is absent where there is nothing to list, and follows the reader by a pure scrollspy rule.
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppView } from '../src/App';
import { activeIndex } from '../src/components/Toc';
import { parseHash } from '../src/lib/route';
import type { PageData } from '../src/lib/types';
import { cleanup, mount, settle } from './dom';
import { declared, rulesFor } from './css';
import { d, marked, pageData, shipped } from './page-fixture';

const scroll = vi.fn();
beforeEach(() => {
  scroll.mockReset();
  (globalThis.HTMLElement.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView = scroll;
  window.location.hash = '#/technical/chapter/F1';
});
afterEach(() => {
  cleanup();
  window.location.hash = '';
  delete (window as { matchMedia?: unknown }).matchMedia;
});

const BODY = `# ${d('Orders')}\n\n${d('Intro.')}\n\n## ${d('Create')}\n\n${d('Text.')}\n\n### ${d('Create details')}\n\n${d('More.')}\n\n## ${d('Approve')}\n\n${d('Text.')}\n\n## ${d('Send')}\n\n${d('Text.')}\n`;
const withText = (text: string): PageData => pageData({ chapters: [{ id: 'F1', texts: { product: text, technical: text } }, { id: 'system', texts: { product: `# ${d('S')}\n`, technical: `# ${d('S')}\n` } }, { id: 'F2', texts: { product: `# ${d('R')}\n`, technical: `# ${d('R')}\n` } }] });
const settled = async (data: PageData, hash: string): Promise<HTMLElement> => {
  window.location.hash = hash;
  const host = mount(<AppView data={data} route={parseHash(hash)} />);
  await settle();
  await settle();
  return host;
};
const entries = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLButtonElement>('nav.toc .toc-link'));

describe('the table of contents', () => {
  it('has a shipped label and lists the h2 and h3 of the chapter, each heading with an id', async () => {
    expect(shipped.strings['page.toc.label']).toBe('On this page');
    const host = await settled(withText(BODY), '#/technical/chapter/F1');
    const nav = host.querySelector('nav.toc') as HTMLElement;
    expect(nav.getAttribute('aria-label')).toBe(marked['page.toc.label']);
    expect(nav.getAttribute('data-part')).toBe('toc');
    expect(nav.querySelector('.toc-title')?.textContent).toBe(marked['page.toc.label']);
    expect(entries(host).map((entry) => [entry.textContent, entry.getAttribute('data-level')])).toEqual([[d('Create'), '2'], [d('Create details'), '3'], [d('Approve'), '2'], [d('Send'), '2']]);
    const headings = Array.from(host.querySelectorAll('.prose h2, .prose h3'));
    expect(headings.map((heading) => heading.id)).toEqual(['toc-1', 'toc-2', 'toc-3', 'toc-4']);
    for (const entry of entries(host)) expect(entry.type).toBe('button');
    expect(nav.querySelector('a')).toBeNull();
  });

  it('scrolls to the heading on a click, focuses it, and leaves the hash alone', async () => {
    const host = await settled(withText(BODY), '#/technical/chapter/F1');
    scroll.mockClear();
    act(() => entries(host)[2].click());
    const heading = host.querySelector('#toc-3') as HTMLElement;
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.contexts[0]).toBe(heading);
    expect(scroll.mock.calls[0][0]).toEqual({ block: 'start', behavior: 'smooth' });
    expect(heading.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(heading);
    expect(window.location.hash).toBe('#/technical/chapter/F1');
  });

  it('scrolls without animation for a reader who asks for less motion', async () => {
    (window as unknown as { matchMedia: unknown }).matchMedia = (query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)', media: query, addEventListener() {}, removeEventListener() {} });
    const host = await settled(withText(BODY), '#/technical/chapter/F1');
    scroll.mockClear();
    act(() => entries(host)[0].click());
    expect(scroll.mock.calls[0][0]).toEqual({ block: 'start', behavior: 'auto' });
  });

  it('marks the entry the reader is at, from where the headings sit under the bar; the first when none has passed it', async () => {
    const tops: Record<string, number> = { 'toc-1': 300, 'toc-2': 500, 'toc-3': 700, 'toc-4': 900 };
    const rect = vi.spyOn(globalThis.HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { top: tops[this.id] ?? 0, height: 56 } as DOMRect;
    });
    try {
      const host = await settled(withText(BODY), '#/technical/chapter/F1');
      expect(entries(host).map((entry) => entry.getAttribute('aria-current'))).toEqual(['true', null, null, null]);
      Object.assign(tops, { 'toc-1': -300, 'toc-2': -100, 'toc-3': 60, 'toc-4': 400 });
      act(() => { window.dispatchEvent(new Event('scroll')); });
      await settle();
      expect(entries(host).map((entry) => entry.getAttribute('aria-current'))).toEqual([null, null, 'true', null]);
    } finally {
      rect.mockRestore();
    }
  });

  it('is on the coverage page too, when it has two h2, and absent on the data page, on a chapter with fewer than two h2 and on the home of a one-h2 chapter', async () => {
    expect((await settled(withText(BODY), '#/technical/data')).querySelector('.toc')).toBeNull();
    cleanup();
    expect((await settled(withText(`# ${d('T')}\n\n## ${d('Only')}\n\n${d('x')}\n\n### ${d('Sub')}\n`), '#/technical/chapter/F1')).querySelector('.toc')).toBeNull();
    cleanup();
    expect((await settled(withText(`# ${d('T')}\n\n${d('no headings')}\n`), '#/technical/chapter/F1')).querySelector('.toc')).toBeNull();
    cleanup();
    const data = pageData();
    data.coverage = { product: `# ${d('C')}\n\n## ${d('One')}\n\n## ${d('Two')}\n`, technical: `# ${d('C')}\n\n## ${d('One')}\n\n## ${d('Two')}\n` };
    expect(entries(await settled(data, '#/technical/coverage')).map((entry) => entry.textContent)).toEqual([d('One'), d('Two')]);
  });
});

describe('the scrollspy rule', () => {
  it('picks the last heading whose top is at or above the limit, the first when none is', () => {
    const tops = [-400, -120, 60, 500];
    expect(activeIndex(tops, 80)).toBe(2);
    expect(activeIndex(tops, 60)).toBe(2);
    expect(activeIndex(tops, 59)).toBe(1);
    expect(activeIndex(tops, 1000)).toBe(3);
    expect(activeIndex([300, 600, 900], 80)).toBe(0);
    expect(activeIndex([], 80)).toBe(0);
  });
});

describe('the table of contents layout', () => {
  const WIDE = '@media (min-width: 1280px) and (pointer: fine)';
  it('is a second column from 1280px on, sticky under the bar, and hidden below', () => {
    expect(declared('.toc', 'display')).toBe('none');
    expect(declared('.main-grid', 'grid-template-columns', WIDE)).toBe('minmax(0, var(--content-w)) var(--toc-w)');
    expect(declared('.main-grid', 'gap', WIDE)).toBe('48px');
    expect(declared('.main-grid', 'justify-content', WIDE)).toBe('center');
    expect(declared('.toc', 'display', WIDE)).toBe('block');
    expect(declared('.toc', 'position', WIDE)).toBe('sticky');
    expect(declared('.toc', 'top', WIDE)).toBe('calc(var(--topbar-h) + 24px)');
    expect(declared('.toc', 'overflow-y', WIDE)).toBe('auto');
    expect(declared('.toc-link[aria-current="true"]', 'color')).toBe('var(--accent-text)');
    expect(declared('.toc-link[aria-current="true"]', 'font-weight')).toBe('600');
    expect(declared('.toc-link[aria-current="true"]', 'box-shadow')).toBe('inset 2px 0 0 var(--accent)');
    expect(declared('.toc-link[data-level="3"]', 'padding-left')).toBe('24px');
    expect(rulesFor('.toc-title')[0]?.body).toContain('letter-spacing: 0.04em');
  });
});
