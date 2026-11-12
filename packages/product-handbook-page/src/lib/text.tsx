import { createContext, useContext } from 'react';

/** Looks up a fixed text of the page in the data's ui table. */
export type Text = (key: string, values?: Record<string, string | number>) => string;

const has = (object: object, key: string): boolean => Object.prototype.hasOwnProperty.call(object, key);
const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

/** Replace each `{name}` of `template` by its value; a name without a value stays as written. */
export function fill(template: string, values: Record<string, string | number> = {}): string {
  return template.replace(PLACEHOLDER, (whole, name: string) => (has(values, name) ? String(values[name]) : whole));
}

/** The lookup over a strings table. A key the table lacks shows as the key itself, which a check on the table (check-ui) rules out. */
export function makeText(strings: Record<string, string>): Text {
  return (key, values) => (has(strings, key) ? fill(strings[key], values) : key);
}

export const TextContext = createContext<Text>((key) => key);

/** The page's one source of fixed text. */
export const useText = (): Text => useContext(TextContext);

/** What the page shows for the system: its verified name, or the fixed text that says the code gives none. */
export const systemName = (project: string | null, t: Text): string => project ?? t('page.systemNameMissing');
