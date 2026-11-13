// Step 2 of the page redesign: motion and touch. CSS is read as text (happy-dom loads none).
import { describe, expect, it } from 'vitest';

import { cssText, declared, rulesFor, rulesOf, token } from './css';

const HOVER = '@media (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)';
const NO_PREF = '@media (prefers-reduced-motion: no-preference)';
const REDUCE = '@media (prefers-reduced-motion: reduce)';
const TOUCH = '@media (max-width: 899px), (pointer: coarse)';
const NARROW = '@media (max-width: 899px)';
const SET = ['.rail-link', '.view-switch-link', '.menu-btn', '.button-link', '.chapter-link', '.data-sort', '.pager button', '.field-control', '.toc-link'];

describe('the motion block', () => {
  it('is one block at the end of the file, and the old rail transition and reduced-motion rules are gone', () => {
    expect(cssText.split('/* Motion and touch */').length).toBe(2);
    const after = cssText.slice(cssText.indexOf('/* Motion and touch */'));
    expect(after).toContain('@media (prefers-reduced-motion: reduce)');
    expect(cssText).not.toMatch(/transition: transform 0\.2s ease/);
    expect(rulesFor('.rail', REDUCE)).toEqual([]);
    expect(rulesOf().filter((rule) => rule.at === REDUCE).map((rule) => rule.selector)).toEqual(['.topbar *, .shell *, .skip-link']);
  });

  it('defines the motion tokens', () => {
    const body = rulesOf().filter((rule) => rule.selector === ':root' && rule.at === '').map((rule) => rule.body).join(' ');
    expect(body).toContain('--ease: cubic-bezier(.2,.8,.2,1)');
    for (const [name, value] of [['--m-in', '150ms'], ['--m-out', '120ms'], ['--m-press', '90ms'], ['--m-panel', '200ms']]) expect(body).toContain(`${name}: ${value}`);
    expect(token('--m-panel')).toBe('200ms');
  });

  it('transitions only colour-like properties, the interactive controls ease out slowly and in fast, and nothing uses `all`', () => {
    expect(cssText).not.toMatch(/transition[^;{}]*\ball\b/);
    const allowed = new Set(['color', 'background-color', 'border-color', 'box-shadow', 'text-decoration-color', 'transform', 'opacity', 'visibility']);
    for (const rule of rulesOf()) {
      const found = /(?:^|;) ?transition-property: ([^;]+)/.exec(rule.body);
      if (found !== null) for (const property of found[1].split(',')) expect(allowed.has(property.trim())).toBe(true);
    }
    const base = rulesOf().find((rule) => rule.at === '' && rule.selector === SET.join(', '));
    expect(base?.body).toContain('transition-duration: var(--m-out)');
    expect(base?.body).toContain('transition-timing-function: var(--ease)');
    expect(base?.body).toContain('transition-property: color, background-color, border-color, box-shadow, text-decoration-color, transform, opacity');
    const hovered = rulesOf().find((rule) => rule.at === '' && rule.selector === SET.map((name) => `${name}:hover`).join(', '));
    expect(hovered?.body).toBe('transition-duration: var(--m-in);');
  });

  it('moves things on hover only for a fine hovering pointer that accepts motion', () => {
    expect(declared('.chapter-link:hover', 'transform', HOVER)).toBe('translateY(-2px)');
    expect(declared('.chapter-link:hover', 'border-color', HOVER)).toBe('var(--accent)');
    for (const selector of ['.button-link:hover', '.data-sort:hover', '.pager button:hover:not(:disabled)']) expect(declared(selector, 'transform', HOVER)).toBe('translateY(-1px)');
    // Nowhere else is a transform written, except the drawer, the press and the hover blocks.
    const outside = rulesOf().filter((rule) => /(?:^|;) ?transform:/.test(rule.body) && rule.at !== HOVER && rule.at !== NO_PREF);
    expect(outside.map((rule) => rule.selector)).toEqual(['.rail', '.rail[data-open="true"]']);
    expect(declared('.chapter-link', 'border-color')).toBe('var(--line-strong)');
  });

  it('presses a control down a little, for readers who accept motion', () => {
    const rule = rulesFor('.chapter-link:active, .button-link:active, .data-sort:active, .pager button:active:not(:disabled), .menu-btn:active, .view-switch-link:active, .rail-link:active, .toc-link:active', NO_PREF)[0];
    expect(rule?.body).toContain('transform: translateY(1px) scale(.985)');
    expect(rule?.body).toContain('transition-duration: var(--m-press)');
  });

  it('shows the focus ring at once, never through a transition', () => {
    expect(declared(':focus-visible', 'outline')).toBe('2px solid var(--accent)');
    expect(declared(':focus-visible', 'outline-offset')).toBe('2px');
    expect(cssText).not.toMatch(/transition-property:[^;]*outline/);
  });

  it('opens the drawer with the panel timing and fades the scrim in', () => {
    expect(declared('.rail', 'transition', NARROW)).toBe('transform var(--m-panel) var(--ease), visibility 0s linear var(--m-panel)');
    expect(declared('.rail[data-open="true"]', 'transition', NARROW)).toBe('transform var(--m-panel) var(--ease)');
    expect(declared('.scrim', 'animation')).toBe('scrim-in var(--m-panel) var(--ease)');
    expect(cssText).toMatch(/@keyframes scrim-in \{\s*from \{ opacity: 0; \}\s*to \{ opacity: 1; \}\s*\}/);
  });

  it('turns every transition and animation off for a reader who asks for less motion, without touching any transform', () => {
    const rule = rulesFor('.topbar *, .shell *, .skip-link', REDUCE)[0];
    expect(rule?.body).toBe('transition: none !important; animation: none !important;');
  });
});

describe('touch targets', () => {
  it('makes the controls 44px on a narrow or coarse screen, and the table of contents is not shown there', () => {
    expect(declared('.menu-btn', 'width', TOUCH)).toBe('44px');
    expect(declared('.menu-btn', 'height', TOUCH)).toBe('44px');
    for (const selector of ['.view-switch-link', '.rail-link', '.data-sort', '.pager button']) expect(declared(selector, 'min-height', TOUCH)).toBe('44px');
    expect(declared('.view-switch-link', 'display', TOUCH)).toBe('inline-flex');
    expect(declared('.view-switch-link', 'align-items', TOUCH)).toBe('center');
    expect(declared('.rail-link', 'display', TOUCH)).toBe('flex');
    expect(declared('.rail-link', 'align-items', TOUCH)).toBe('center');
    expect(declared('.field-control', 'height', TOUCH)).toBe('44px');
    expect(declared('.toc', 'display', TOUCH)).toBe('none');
  });

  it('lets the view switch and the title shrink so nothing overflows at 320px', () => {
    expect(declared('.view-switch-link', 'padding', '@media (max-width: 480px)')).toBe('3px 10px');
    expect(declared('.view-switch-link', 'padding', TOUCH)).toBe('0 10px');
    expect(declared('.brand-title', 'overflow', TOUCH)).toBe('hidden');
    expect(declared('.brand-title', 'text-overflow', TOUCH)).toBe('ellipsis');
  });
});
