// @vitest-environment happy-dom
// Step 3: the skip link is the first thing a keyboard reaches; it moves the focus to the main column and never touches the hash.
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { AppView } from '../src/App';
import { parseHash } from '../src/lib/route';
import { cleanup, mount } from './dom';
import { declared, rulesFor } from './css';
import { marked, pageData, shipped } from './page-fixture';

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

describe('the skip link', () => {
  it('has a shipped text and is the first focusable element of the page', () => {
    expect(shipped.strings['page.skip']).toBe('Skip to the content');
    const host = mount(<AppView data={pageData()} route={parseHash('#/technical/chapter/F1')} />);
    const first = host.querySelector(FOCUSABLE);
    expect(first?.classList.contains('skip-link')).toBe(true);
    expect(first?.textContent).toBe(marked['page.skip']);
    expect(host.querySelector('.app')?.firstElementChild).toBe(first);
    expect(host.querySelector('main')?.getAttribute('id')).toBe('main');
    expect(host.querySelector('main')?.getAttribute('tabindex')).toBe('-1');
  });

  it('moves the focus to main on a click and leaves the hash alone', () => {
    window.location.hash = '#/technical/chapter/F1';
    const host = mount(<AppView data={pageData()} route={parseHash('#/technical/chapter/F1')} />);
    const link = host.querySelector('.skip-link') as HTMLAnchorElement;
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    act(() => { link.dispatchEvent(click); });
    expect(click.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(host.querySelector('main'));
    expect(window.location.hash).toBe('#/technical/chapter/F1');
  });

  it('is hidden until it has the focus, then sits above the bar as the primary button', () => {
    expect(declared('.skip-link:not(:focus)', 'clip-path')).toBe('inset(50%)');
    expect(declared('.skip-link', 'z-index')).toBe('60');
    expect(declared('.skip-link', 'background')).toBe('var(--accent)');
    expect(declared('.topbar', 'z-index')).toBe('40');
    expect(rulesFor('.skip-link:hover')[0]?.body).toContain('background: var(--accent-hover)');
  });
});
