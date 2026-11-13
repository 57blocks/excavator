// Step 1 of the page redesign: the visual system. happy-dom does not load CSS, so every rule is read from src/index.css as text.
import { describe, expect, it } from 'vitest';

import { contrast, cssText, declared, rulesOf, rulesFor, token } from './css';

describe('tokens', () => {
  it('adds the new tokens with their light and dark values', () => {
    expect(token('--accent-hover')).toBe('#174a50');
    expect(token('--accent-hover', true)).toBe('#79c3ca');
    expect(token('--rail-bg')).toBe(token('--bg'));
    expect(token('--rail-bg', true)).toBe(token('--bg', true));
    expect(token('--content-w')).toBe('760px');
    expect(token('--toc-w')).toBe('220px');
    expect(token('--radius-sm')).toBe('6px');
    expect(token('--radius-md')).toBe('8px');
    expect(token('--rail-w')).toBe('280px');
    expect(token('--radius')).toBe('10px');
  });

  it('keeps the teal palette: no violet anywhere in the stylesheet', () => {
    expect(cssText).not.toMatch(/#6a4dff|#7c5cff|#2b2557|#e6e1ff/i);
  });

  it('uses a radius token for every radius, except the round shapes (999px pills, 50% dots)', () => {
    const radii = Array.from(cssText.matchAll(/border-radius:\s*([^;}]+)/g), (match) => match[1].trim());
    const raw = radii.filter((value) => !/^var\(--radius(-sm|-md)?\)$/.test(value) && value !== '999px' && value !== '50%');
    expect(raw).toEqual([]);
  });

  it('keeps --text-3 at 4.5:1 or more on the rail background and the surface, in both themes', () => {
    for (const dark of [false, true]) {
      const text = token('--text-3', dark) as string;
      expect(contrast(text, token('--rail-bg', dark) as string)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(text, token('--surface', dark) as string)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('the rail', () => {
  it('has the rail background and a main column on the surface', () => {
    expect(declared('.rail', 'background')).toBe('var(--rail-bg)');
    expect(declared('.main', 'background')).toBe('var(--surface)');
  });

  it('marks the active link with a bar and weight, not a pill; hover is a faint wash', () => {
    const body = rulesFor('.rail-link[aria-current]')[0]?.body ?? '';
    expect(body).toContain('color: var(--accent-text)');
    expect(body).toContain('font-weight: 600');
    expect(body).toContain('background: transparent');
    expect(body).toContain('box-shadow: inset 2px 0 0 var(--accent)');
    expect(declared('.rail-link:hover', 'background')).toBe('color-mix(in srgb, var(--text) 6%, transparent)');
  });

  it('writes group names at 12px, weight 600, spaced 0.04em, in --text-3, uppercase', () => {
    expect(declared('.rail-group-name', 'font-size')).toBe('12px');
    expect(declared('.rail-group-name', 'font-weight')).toBe('600');
    expect(declared('.rail-group-name', 'letter-spacing')).toBe('0.04em');
    expect(declared('.rail-group-name', 'color')).toBe('var(--text-3)');
    expect(declared('.rail-group-name', 'text-transform')).toBe('uppercase');
  });
});

describe('type and headings', () => {
  it('sets the content width and the prose rhythm', () => {
    expect(declared('.page', 'max-width')).toBe('var(--content-w)');
    expect(declared('.prose', 'max-width')).toBe('var(--content-w)');
    expect(declared('.prose', 'line-height')).toBe('1.75');
    expect(declared('.prose h1', 'font-size')).toBe('clamp(26px, 4vw, 32px)');
    expect(declared('.page-title', 'font-size')).toBe('clamp(26px, 4vw, 32px)');
    expect(declared('.prose h2', 'font-size')).toBe('22px');
    expect(declared('.prose h3', 'font-size')).toBe('17px');
  });

  it('gives an h2 section title on a data page the look of a chapter h2, with the spacing it lacked', () => {
    expect(declared('h2.section-title', 'font-size')).toBe('22px');
    expect(declared('h2.section-title', 'border-top')).toBe('1px solid var(--line)');
    expect(declared('h2.section-title', 'margin')).toBe('36px 0 12px');
    expect(declared('h2.section-title', 'padding-top')).toBe('22px');
    expect(declared('.page-head + h2.section-title', 'margin-top')).toBe('0');
    // Inside a section the section already draws the rule, so the title does not draw a second one.
    expect(declared('.section > h2.section-title', 'border-top')).toBe('0');
    expect(declared('h3.section-title', 'font-size')).toBe('17px');
    expect(declared('h3.section-title', 'border-top')).toBeUndefined();
  });

  it('keeps a heading clear of the sticky bar when it is scrolled to', () => {
    const body = rulesOf().find((rule) => rule.selector.split(',').map((part) => part.trim()).includes('.prose h2') && rule.body.includes('scroll-margin-top'))?.body ?? '';
    expect(body).toContain('scroll-margin-top: calc(var(--topbar-h) + 16px)');
    const selectors = rulesOf().filter((rule) => rule.body.includes('scroll-margin-top')).flatMap((rule) => rule.selector.split(',').map((part) => part.trim()));
    for (const wanted of ['.prose h1', '.prose h2', '.prose h3', '.section-title', '.page-title']) expect(selectors).toContain(wanted);
  });
});

describe('the not-verified line, citations, links and buttons', () => {
  it('styles the chapter note without a box, and the not-passed note as a warning', () => {
    expect(declared('.prose .chapter-note', 'font-size')).toBe('14px');
    expect(declared('.prose .chapter-note', 'color')).toBe('var(--text-3)');
    expect(declared('.prose .chapter-note', 'margin')).toBe('0 0 24px');
    expect(declared('.prose .chapter-note', 'border')).toBeUndefined();
    expect(declared('.prose .chapter-note[data-part="not-passed"]', 'color')).toBe('var(--warn-text)');
  });

  it('draws a citation as quiet monospace text, not a chip', () => {
    expect(declared('.prose code.cite', 'border')).toBe('0');
    expect(declared('.prose code.cite', 'background')).toBe('transparent');
    expect(declared('.prose code.cite', 'color')).toBe('var(--text-3)');
    expect(declared('.prose code.cite', 'font-size')).toBe('12px');
    expect(declared('.prose code.cite', 'padding')).toBe('0 2px');
    expect(declared('.prose code.cite', 'font-family')).toContain('ui-monospace');
    expect(declared('.cite-lines', 'color')).toBe('var(--text-3)');
  });

  it('hovers a button by its own colour, never by a filter; the not-found button has room', () => {
    expect(declared('.button-link:hover', 'background')).toBe('var(--accent-hover)');
    expect(cssText).not.toMatch(/filter:\s*brightness/);
    expect(declared('.page[data-view="not-found"] .lede', 'margin-bottom')).toBe('24px');
    expect(declared('.page[data-view="not-found"] .button-link', 'min-height')).toBe('40px');
  });

  it('underlines a link in a soft colour that turns solid on hover, always 1px', () => {
    expect(declared('a', 'text-decoration-color')).toBe('color-mix(in srgb, currentColor 35%, transparent)');
    expect(declared('a:hover', 'text-decoration-color')).toBe('currentColor');
    expect(declared('a', 'text-decoration-thickness')).toBe('1px');
    expect(declared('a:hover', 'text-decoration-thickness')).toBeUndefined();
  });
});
