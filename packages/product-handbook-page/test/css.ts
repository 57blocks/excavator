// A small reader of src/index.css for the tests: happy-dom does not load CSS, so a rule is checked as text.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const cssText = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/index.css'), 'utf-8');

export interface Rule { selector: string; body: string; at: string }

const squash = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** Every rule of `css` in source order, each with the at-rule prelude it sits in ('' at the top level). */
export function rulesOf(css: string = cssText): Rule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@import[^;]*;/g, '');
  const rules: Rule[] = [];
  const walk = (from: number, to: number, at: string): void => {
    let cursor = from;
    while (cursor < to) {
      const open = text.indexOf('{', cursor);
      if (open < 0 || open >= to) break;
      let depth = 1;
      let close = open + 1;
      while (close < to && depth > 0) {
        if (text[close] === '{') depth += 1;
        else if (text[close] === '}') depth -= 1;
        close += 1;
      }
      const head = squash(text.slice(cursor, open));
      const inner = text.slice(open + 1, close - 1);
      if (head.startsWith('@media') || head.startsWith('@supports')) walk(open + 1, close - 1, head);
      else rules.push({ selector: head, body: squash(inner), at });
      cursor = close;
    }
  };
  walk(0, text.length, '');
  return rules;
}

/** The rules whose selector list is `selector`, or has it as one of its selectors (whitespace-insensitive), optionally only inside the at-rule `at`. */
export function rulesFor(selector: string, at: string | null = null, css: string = cssText): Rule[] {
  return rulesOf(css).filter((rule) => (rule.selector === squash(selector) || rule.selector.split(',').map((part) => part.trim()).includes(squash(selector))) && (at === null || rule.at === squash(at)));
}

/** The value of `property` in the last rule for `selector`, or undefined. */
export function declared(selector: string, property: string, at: string | null = null): string | undefined {
  let value: string | undefined;
  for (const rule of rulesFor(selector, at)) {
    const found = new RegExp(`(?:^|;)\\s*${property.replace(/[-]/g, '\\-')}\\s*:\\s*([^;]+)`).exec(rule.body);
    if (found !== null) value = found[1].trim();
  }
  return value;
}

/** The value of a custom property in the light set (the first :root rule) or the dark set (the :root inside the dark media query). */
export function token(name: string, dark = false): string | undefined {
  const rule = rulesOf().find((item) => item.selector === ':root' && (dark ? item.at.includes('prefers-color-scheme: dark') : item.at === '' && item.body.includes(`${name}:`)));
  const found = rule === undefined ? null : new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`).exec(rule.body);
  return found === null ? undefined : found[1].trim();
}

const channel = (value: number): number => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
const luminance = (hex: string): number => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16 & 255) / 255) + 0.7152 * channel((n >> 8 & 255) / 255) + 0.0722 * channel((n & 255) / 255);
};

/** WCAG contrast ratio of two #rrggbb colours. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
