// @vitest-environment happy-dom
// Step 4: the filter at the top of the rail. It narrows the links by their title, hides a group with no match, says so when nothing
// matches, clears on Esc (without closing the drawer), goes to the first match on Enter, survives navigation, and "/" focuses it.
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { App, AppView } from '../src/App';
import { parseHash } from '../src/lib/route';
import { cleanup, mount, press, settle, typeInto } from './dom';
import { declared } from './css';
import { d, marked, pageData, shipped } from './page-fixture';

beforeEach(() => { window.location.hash = '#/technical/chapter/F1'; });
afterEach(() => {
  cleanup();
  window.location.hash = '';
  delete (window as { matchMedia?: unknown }).matchMedia;
});

const view = () => mount(<AppView data={pageData()} route={parseHash('#/technical/chapter/F1')} />);
const input = (host: HTMLElement) => host.querySelector('input[data-part="rail-filter"]') as HTMLInputElement;
const links = (host: HTMLElement) => Array.from(host.querySelectorAll('.rail-link'), (link) => link.textContent);
const groups = (host: HTMLElement) => Array.from(host.querySelectorAll('.rail-group-name'), (name) => name.textContent);
const keydown = (target: Element | Document, key: string, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  act(() => { target.dispatchEvent(event); });
  return event;
};

describe('the rail filter', () => {
  it('has shipped texts, a search input above the scroll area with a hidden label and the same placeholder', () => {
    expect(shipped.strings['page.nav.filter']).toBe('Filter chapters');
    expect(shipped.strings['page.nav.filterEmpty']).toBe('No chapter matches the filter.');
    const host = view();
    const field = input(host);
    expect(field.type).toBe('search');
    expect(field.classList.contains('field-control')).toBe(true);
    expect(field.placeholder).toBe(marked['page.nav.filter']);
    const label = host.querySelector(`label[for="${field.id}"]`);
    expect(label?.textContent).toBe(marked['page.nav.filter']);
    expect(label?.classList.contains('visually-hidden')).toBe(true);
    const rail = host.querySelector('.rail') as HTMLElement;
    expect(field.closest('.rail-scroll')).toBeNull();
    expect(rail.firstElementChild?.contains(field)).toBe(true);
  });

  it('narrows the links by a case-insensitive substring of the title and hides the groups with no match', () => {
    const host = view();
    expect(links(host).length).toBe(7);
    typeInto(input(host), 'REMIND');
    expect(links(host)).toEqual([d('Reminders')]);
    expect(groups(host)).toEqual([d('Features')]);
    typeInto(input(host), '');
    expect(links(host).length).toBe(7);
    // The coverage link is filtered like the others.
    typeInto(input(host), 'coverage');
    expect(links(host)).toEqual([marked['page.nav.coverage']]);
    expect(groups(host)).toEqual([]);
  });

  it('matches after Unicode normalisation (a full-width letter finds its plain letter)', () => {
    const host = view();
    typeInto(input(host), String.fromCharCode(0xff52, 0xff45, 0xff4d, 0xff49, 0xff4e, 0xff44));
    expect(links(host)).toEqual([d('Reminders')]);
  });

  it('says so when nothing matches', () => {
    const host = view();
    typeInto(input(host), 'zzzz');
    expect(links(host)).toEqual([]);
    const empty = host.querySelector('p.muted[data-part="rail-filter-empty"]');
    expect(empty?.textContent).toBe(marked['page.nav.filterEmpty']);
    typeInto(input(host), '');
    expect(host.querySelector('[data-part="rail-filter-empty"]')).toBeNull();
  });

  it('clears on Esc and does not close the drawer; with nothing typed Esc closes the drawer as before', () => {
    const host = view();
    act(() => { (host.querySelector('.menu-btn') as HTMLElement).click(); });
    const rail = host.querySelector('.rail') as HTMLElement;
    expect(rail.getAttribute('data-open')).toBe('true');
    typeInto(input(host), 'remind');
    const first = keydown(input(host), 'Escape');
    expect(first.defaultPrevented).toBe(true);
    expect(input(host).value).toBe('');
    expect(links(host).length).toBe(7);
    expect(rail.getAttribute('data-open')).toBe('true');
    keydown(input(host), 'Escape');
    expect(rail.getAttribute('data-open')).toBe('false');
  });

  it('goes to the first match on Enter, by the hash, and closes the drawer', () => {
    const host = view();
    act(() => { (host.querySelector('.menu-btn') as HTMLElement).click(); });
    typeInto(input(host), 'e');
    const target = (host.querySelector('.rail-link') as HTMLAnchorElement).getAttribute('href');
    expect(target).toBe('#/technical/chapter/system');
    typeInto(input(host), 'remind');
    keydown(input(host), 'Enter');
    expect(window.location.hash).toBe('#/technical/chapter/F2');
    expect((host.querySelector('.rail') as HTMLElement).getAttribute('data-open')).toBe('false');
    // Nothing matches: Enter goes nowhere.
    typeInto(input(host), 'zzzz');
    keydown(input(host), 'Enter');
    expect(window.location.hash).toBe('#/technical/chapter/F2');
  });

  it('keeps the filter text when the route changes', async () => {
    const host = mount(<App data={pageData()} />);
    await settle();
    typeInto(input(host), 'remind');
    act(() => { window.location.hash = '#/technical/chapter/F2'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
    await settle();
    expect(host.querySelector('.rail-link[aria-current="page"]')?.textContent).toBe(d('Reminders'));
    expect(input(host).value).toBe('remind');
    expect(links(host)).toEqual([d('Reminders')]);
  });
});

describe('the "/" key', () => {
  it('focuses the filter from anywhere, and not while typing in a field or with a modifier', async () => {
    const host = view();
    const other = document.createElement('input');
    document.body.appendChild(other);
    keydown(document.body, '/', { ctrlKey: true });
    expect(document.activeElement).not.toBe(input(host));
    act(() => other.focus());
    const typed = keydown(other, '/');
    expect(typed.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(other);
    act(() => other.blur());
    const event = keydown(document.body, '/');
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input(host));
    // Typing "/" in the filter itself is an ordinary character.
    expect(keydown(input(host), '/').defaultPrevented).toBe(false);
    await press(input(host), 'a');
  });

  it('on a narrow screen opens the drawer first, then focuses the filter', async () => {
    (window as unknown as { matchMedia: unknown }).matchMedia = (query: string) => ({ matches: query === '(max-width: 899px)', media: query, addEventListener() {}, removeEventListener() {} });
    const host = view();
    const rail = host.querySelector('.rail') as HTMLElement;
    expect(rail.getAttribute('data-open')).toBe('false');
    keydown(document.body, '/');
    await settle();
    expect(rail.getAttribute('data-open')).toBe('true');
    expect(document.activeElement).toBe(input(host));
  });
});

describe('the rail filter styles', () => {
  it('keeps the filter in place above a scrolling list, and hides the label from the eye only', () => {
    expect(declared('.rail', 'display')).toBe('flex');
    expect(declared('.rail', 'flex-direction')).toBe('column');
    expect(declared('.rail-filter', 'flex')).toBe('none');
    expect(declared('.rail-scroll', 'flex')).toBe('1 1 auto');
    expect(declared('.rail-scroll', 'min-height')).toBe('0');
    expect(declared('.visually-hidden', 'clip-path')).toBe('inset(50%)');
  });
});
