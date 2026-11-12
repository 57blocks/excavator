import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { DEFAULT_THEME, THEME_KEY, THEME_LABELS, THEME_ORDER, THEME_PREVIEW, applyTheme, currentTheme, isTheme, readStoredTheme, writeStoredTheme } from '../src/lib/theme';
import type { ThemeStorage } from '../src/lib/theme';

function fakeRoot(initial?: string) {
  const attrs = new Map<string, string>(initial === undefined ? [] : [['data-theme', initial]]);
  return {
    style: { colorScheme: '' },
    setAttribute: (name: string, value: string) => { attrs.set(name, value); },
    getAttribute: (name: string) => attrs.get(name) ?? null,
  } as unknown as HTMLElement;
}

const throwing: () => ThemeStorage = () => { throw new Error('storage blocked'); };

describe('theme: the remembered choice', () => {
  it('defaults to Light Violet, not the system preference', () => {
    expect(DEFAULT_THEME).toBe('light');
    expect(currentTheme(fakeRoot())).toBe('light');
  });

  it('lists Light Violet first and previews each theme with three colours', () => {
    expect(THEME_ORDER).toEqual(['light', 'dark']);
    expect(THEME_ORDER.map((theme) => THEME_LABELS[theme])).toEqual(['Light Violet', 'Dark Violet']);
    for (const theme of THEME_ORDER) expect(THEME_PREVIEW[theme]).toHaveLength(3);
  });

  it('honours a stored dark choice over the default', () => {
    expect(readStoredTheme(() => ({ getItem: () => 'dark', setItem: () => {} }))).toBe('dark');
  });

  it('reads back what was written, under the documented key', () => {
    const store = new Map<string, string>();
    const storage = (): ThemeStorage => ({ getItem: (key) => store.get(key) ?? null, setItem: (key, value) => { store.set(key, value); } });
    expect(readStoredTheme(storage)).toBeNull();
    writeStoredTheme('light', storage);
    expect(store.get(THEME_KEY)).toBe('light');
    expect(THEME_KEY).toBe('excavator-prd-report-theme');
    expect(readStoredTheme(storage)).toBe('light');
  });

  it('ignores a stored value that is not a theme', () => {
    expect(readStoredTheme(() => ({ getItem: () => 'sepia', setItem: () => {} }))).toBeNull();
    expect(isTheme('dark') && isTheme('light') && !isTheme('system')).toBe(true);
  });

  it('works when the storage throws on access, read or write', () => {
    expect(readStoredTheme(throwing)).toBeNull();
    expect(() => writeStoredTheme('light', throwing)).not.toThrow();
    const failing = (): ThemeStorage => ({ getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } });
    expect(readStoredTheme(failing)).toBeNull();
    expect(() => writeStoredTheme('dark', failing)).not.toThrow();
  });
});

describe('theme: the document', () => {
  it('sets data-theme and color-scheme on the root element', () => {
    const root = fakeRoot();
    applyTheme('light', root);
    expect(root.getAttribute('data-theme')).toBe('light');
    expect(root.style.colorScheme).toBe('light');
    expect(currentTheme(root)).toBe('light');
    applyTheme('dark', root);
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(root.style.colorScheme).toBe('dark');
  });

  it('reads an unknown attribute as the default', () => {
    expect(currentTheme(fakeRoot('sepia'))).toBe('light');
  });
});

describe('theme: the stylesheet and the page shell', () => {
  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf-8');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf-8');

  it('keys its tokens on data-theme, never on the system preference', () => {
    expect(css).not.toContain('prefers-color-scheme');
    expect(css).toMatch(/:root\[data-theme="dark"\]/);
    expect(css).toMatch(/:root\[data-theme="light"\]/);
    expect(css).toContain('--accent: #7c5cff');
    expect(css).toContain('--accent: #6a4dff');
  });

  it('makes the light tokens the default of a document with no data-theme, and dark an override', () => {
    const rootBlock = css.slice(css.indexOf(':root,'), css.indexOf('}', css.indexOf(':root,')));
    expect(rootBlock).toContain(':root[data-theme="light"]');
    expect(rootBlock).toContain('--accent: #6a4dff');
    expect(css).toMatch(/\n:root\[data-theme="dark"\] \{/);
  });

  it('sets the remembered theme in the head before the first paint, behind the CSP marker', () => {
    expect(html.indexOf('<!-- xv:csp -->')).toBeLessThan(html.indexOf('<script>'));
    expect(html).toContain(`getItem('${THEME_KEY}')`);
  });

  it('falls back to light in the pre-paint script when nothing valid is stored', () => {
    expect(html).toContain("var theme = 'light';");
  });
});
