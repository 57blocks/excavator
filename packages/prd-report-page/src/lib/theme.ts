import { useCallback, useSyncExternalStore } from 'react';

/** The two palettes of the page. Dark Violet is the default; the system preference is not consulted. */
export type Theme = 'dark' | 'light';

export const THEME_KEY = 'excavator-prd-report-theme';
export const DEFAULT_THEME: Theme = 'dark';

/** The names shown to the reader: themes are named by colour only. */
export const THEME_LABELS: Record<Theme, string> = { dark: 'Dark Violet', light: 'Light Violet' };

/** The subset of `Storage` the page uses, so a test can hand in a stub. */
export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function isTheme(value: unknown): value is Theme {
  return value === 'dark' || value === 'light';
}

/** The remembered theme, or null when nothing valid is stored or the storage throws (private windows, blocked site data). */
export function readStoredTheme(storage: () => ThemeStorage = () => window.localStorage): Theme | null {
  try {
    const value = storage().getItem(THEME_KEY);
    return isTheme(value) ? value : null;
  } catch {
    return null;
  }
}

/** Remember the choice; a storage that throws is ignored, the choice then lasts until the page closes. */
export function writeStoredTheme(theme: Theme, storage: () => ThemeStorage = () => window.localStorage): void {
  try {
    storage().setItem(THEME_KEY, theme);
  } catch {
    /* the page works without storage */
  }
}

/** Set the theme on <html>: the `data-theme` attribute the CSS tokens key on, and `color-scheme` for native controls. */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  root.setAttribute('data-theme', theme);
  root.style.colorScheme = theme;
}

/** The theme the document carries now; the default when the attribute is missing. */
export function currentTheme(root: HTMLElement = document.documentElement): Theme {
  const value = root.getAttribute('data-theme');
  return isTheme(value) ? value : DEFAULT_THEME;
}

/** Apply the remembered theme (or the default); called before the first render. */
export function initTheme(): Theme {
  const theme = readStoredTheme() ?? DEFAULT_THEME;
  applyTheme(theme);
  return theme;
}

const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => { listeners.delete(onChange); };
}

/** Switch the theme, remember it and tell every component that reads it. */
export function setTheme(theme: Theme): void {
  applyTheme(theme);
  writeStoredTheme(theme);
  listeners.forEach((listener) => listener());
}

/** The current theme and a setter; every reader re-renders on a switch. */
export function useTheme(): [Theme, (theme: Theme) => void] {
  const theme = useSyncExternalStore(subscribe, () => currentTheme(), () => DEFAULT_THEME);
  const set = useCallback((next: Theme) => setTheme(next), []);
  return [theme, set];
}
