// @vitest-environment happy-dom
// The search (openspec change handbook-page-domain-map, task 4.4): the shortcuts that open and close it, the dialog, the arrows
// and Enter, going to a chapter and to a heading (also one whose chapter loads later), the results and the line for no match.
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppView } from '../src/App';
import { jumpToHeading } from '../src/lib/heading-jump';
import { MAX_RESULTS, searchResults } from '../src/lib/search';
import { parseHash } from '../src/lib/route';
import type { SearchItem } from '../src/lib/types';
import { cleanup, mount, settle, typeInto } from './dom';
import { domainData } from './domains-fixture';
import { d, marked } from './page-fixture';

afterEach(() => { cleanup(); window.location.hash = ''; });
beforeEach(() => { window.location.hash = ''; });

const page = (hash = '#/product'): HTMLElement => mount(<AppView data={domainData()} route={parseHash(hash)} />);
const press = (init: KeyboardEventInit, target: EventTarget = window): void => { act(() => { target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })); }); };
const dialog = (): HTMLElement | null => document.querySelector('[role="dialog"]');
const input = (): HTMLInputElement => document.querySelector('[role="dialog"] input') as HTMLInputElement;
const options = (): string[] => Array.from(document.querySelectorAll('[role="option"]')).map((one) => one.querySelector('.search-title')?.textContent ?? '');
const selected = (): string | null => document.querySelector('[role="option"][aria-selected="true"]')?.querySelector('.search-title')?.textContent ?? null;

describe('opening and closing', () => {
  it('opens with Cmd+K, with Ctrl+K and with the button, as a modal dialog with an input and a list', () => {
    const host = page();
    expect(dialog()).toBeNull();
    press({ key: 'k', metaKey: true });
    expect(dialog()?.getAttribute('aria-modal')).toBe('true');
    expect(input().type).toBe('search');
    expect(document.querySelector('[role="listbox"]')).not.toBeNull();
    expect(document.activeElement).toBe(input());
    press({ key: 'Escape' }, input());
    expect(dialog()).toBeNull();
    press({ key: 'K', ctrlKey: true });
    expect(dialog()).not.toBeNull();
    press({ key: 'Escape' }, input());
    act(() => (host.querySelector('.search-btn') as HTMLElement).click());
    expect(dialog()).not.toBeNull();
  });

  it('opens with a slash unless the focus is in an input, a textarea, a select or an editable element', () => {
    const host = page();
    for (const tag of ['input', 'textarea', 'select']) {
      const field = document.createElement(tag);
      host.appendChild(field);
      press({ key: '/' }, field);
      expect(dialog(), tag).toBeNull();
    }
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    host.appendChild(editable);
    press({ key: '/' }, editable);
    expect(dialog()).toBeNull();
    press({ key: '/' }, host);
    expect(dialog()).not.toBeNull();
  });

  it('closes on Escape and on a click on the backdrop, and gives the focus back to what opened it; a click in the box does not close it', () => {
    const host = page();
    const opener = host.querySelector('.search-btn') as HTMLElement;
    act(() => opener.focus());
    press({ key: 'k', metaKey: true });
    expect(document.activeElement).toBe(input());
    act(() => (document.querySelector('.search-box') as HTMLElement).click());
    expect(dialog()).not.toBeNull();
    press({ key: 'Escape' }, input());
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(opener);
    press({ key: 'k', metaKey: true });
    act(() => (document.querySelector('.search') as HTMLElement).click());
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('stays one dialog when the shortcut is pressed again, and a slash typed in the input is a character', () => {
    page();
    press({ key: 'k', metaKey: true });
    press({ key: 'k', metaKey: true });
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    press({ key: '/' }, input());
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  });
});

describe('the results', () => {
  it('list the domains, then the reference chapters, for an empty query, with a mark for a domain and the context on the right', () => {
    page();
    press({ key: 'k', metaKey: true });
    expect(options()).toEqual([d('Platform'), d('Orders'), d('Billing'), d('Support'), d('System chapter')]);
    const rows = Array.from(document.querySelectorAll('[role="option"]'));
    expect(rows[0].querySelector('.mark')).not.toBeNull();
    expect(rows[4].querySelector('.mark')).toBeNull();
    expect(rows[0].querySelector('small')?.textContent).toBe(marked['page.nav.domains']);
    expect(rows[4].querySelector('small')?.textContent).toBe(marked['page.nav.references']);
  });

  it('match the title as a case-insensitive substring, with the domain name for a chapter and the chapter title for a heading', () => {
    page();
    press({ key: 'k', metaKey: true });
    typeInto(input(), 'ORDER');
    expect(options()).toEqual([d('Orders'), d('Order entry'), d('Order entry first'), d('Order entry second')]);
    const rows = Array.from(document.querySelectorAll('[role="option"]'));
    expect(rows.map((one) => one.querySelector('small')?.textContent)).toEqual([marked['page.nav.domains'], d('Orders'), d('Order entry'), d('Order entry')]);
    expect(rows.every((one) => one.querySelector('.mark') !== null)).toBe(true);
  });

  it('say so when nothing matches', () => {
    page();
    press({ key: 'k', metaKey: true });
    typeInto(input(), 'zzzz');
    expect(document.querySelector('[role="option"]')).toBeNull();
    expect(document.querySelector('.none')?.textContent).toBe(marked['page.search.none']);
  });

  it('cut at forty and keep the order of the index', () => {
    const items: SearchItem[] = Array.from({ length: 60 }, (_, at) => ({ kind: 'heading', title: `Item ${at}`, chapter: 'F1', domain: null, heading: at }));
    const all = searchResults({ query: 'item', groups: [], items, references: [], referencesLabel: 'refs', domainsLabel: 'domains' });
    expect(all).toHaveLength(MAX_RESULTS);
    expect(all.map((one) => one.title)).toEqual(items.slice(0, 40).map((one) => one.title));
    expect(searchResults({ query: '  ', groups: [], items, references: [], referencesLabel: '', domainsLabel: '' })).toEqual([]);
  });
});

describe('moving and going', () => {
  it('moves the selection with the arrows, without leaving the list, and Enter goes to the selected chapter', () => {
    page();
    press({ key: 'k', metaKey: true });
    typeInto(input(), 'order');
    expect(selected()).toBe(d('Orders'));
    press({ key: 'ArrowDown' }, input());
    expect(selected()).toBe(d('Order entry'));
    press({ key: 'ArrowDown' }, input());
    press({ key: 'ArrowDown' }, input());
    press({ key: 'ArrowDown' }, input());
    expect(selected()).toBe(d('Order entry second'));
    press({ key: 'ArrowUp' }, input());
    expect(selected()).toBe(d('Order entry first'));
    press({ key: 'ArrowUp' }, input());
    press({ key: 'ArrowUp' }, input());
    press({ key: 'ArrowUp' }, input());
    expect(selected()).toBe(d('Orders'));
    press({ key: 'ArrowDown' }, input());
    press({ key: 'Enter' }, input());
    expect(window.location.hash).toBe('#/product/chapter/F2');
    expect(dialog()).toBeNull();
  });

  it('goes to a domain page with a click, and keeps the view in the address', () => {
    page('#/technical');
    press({ key: 'k', metaKey: true });
    act(() => (document.querySelectorAll('[role="option"]')[2] as HTMLElement).click());
    expect(window.location.hash).toBe('#/technical/domain/d3');
    expect(dialog()).toBeNull();
  });

  it('goes to a heading: the chapter, then the heading is scrolled to and focused', async () => {
    const scrolled: string[] = [];
    const proto = globalThis.HTMLElement.prototype as unknown as { scrollIntoView: (options?: unknown) => void };
    const saved = proto.scrollIntoView;
    proto.scrollIntoView = function scroll(this: HTMLElement) { scrolled.push(this.id); };
    try {
      page('#/product/chapter/F2');
      press({ key: 'k', metaKey: true });
      typeInto(input(), 'order entry second');
      expect(options()).toEqual([d('Order entry second')]);
      press({ key: 'Enter' }, input());
      expect(window.location.hash).toBe('#/product/chapter/F2');
      await settle();
      expect(scrolled.filter((id) => id.startsWith('h-'))).toEqual(['h-1']);
      expect(document.activeElement?.id).toBe('h-1');
    } finally {
      proto.scrollIntoView = saved;
    }
  });
});

describe('going to a heading whose chapter is not on the page yet', () => {
  it('waits for the heading to appear in that chapter, and ignores a heading with the same number in another chapter', async () => {
    const scrolled: string[] = [];
    const proto = globalThis.HTMLElement.prototype as unknown as { scrollIntoView: (options?: unknown) => void };
    const saved = proto.scrollIntoView;
    proto.scrollIntoView = function scroll(this: HTMLElement) { scrolled.push(`${this.closest('[data-chapter]')?.getAttribute('data-chapter')}:${this.id}`); };
    try {
      const host = document.createElement('div');
      document.body.appendChild(host);
      host.innerHTML = '<article data-chapter="F1"><h2 id="h-1" tabindex="-1">other</h2></article>';
      const stop = jumpToHeading('F2', 1, 2000);
      await settle();
      expect(scrolled).toEqual([]);
      host.innerHTML = '<article data-chapter="F2"><h2 id="h-0" tabindex="-1">a</h2></article>';
      await settle();
      expect(scrolled).toEqual([]);
      host.innerHTML = '<article data-chapter="F2"><h2 id="h-0" tabindex="-1">a</h2><h2 id="h-1" tabindex="-1">b</h2></article>';
      await settle();
      expect(scrolled).toEqual(['F2:h-1']);
      stop();
    } finally {
      proto.scrollIntoView = saved;
    }
  });

  it('gives up quietly after its timeout and when stopped', async () => {
    const proto = globalThis.HTMLElement.prototype as unknown as { scrollIntoView: (options?: unknown) => void };
    const saved = proto.scrollIntoView;
    const calls: number[] = [];
    proto.scrollIntoView = () => { calls.push(1); };
    try {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const stop = jumpToHeading('F2', 0, 5);
      await settle();
      host.innerHTML = '<article data-chapter="F2"><h2 id="h-0" tabindex="-1">a</h2></article>';
      await settle();
      expect(calls).toEqual([]);
      stop();
    } finally {
      proto.scrollIntoView = saved;
    }
  });
});
