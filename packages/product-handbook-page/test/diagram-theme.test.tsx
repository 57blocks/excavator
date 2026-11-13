// @vitest-environment happy-dom
// The mermaid palette is the page's teal in both themes, and its font is the page's font, so CJK labels get a CJK face.
import { describe, expect, it } from 'vitest';

import { themeVariables } from '../src/components/Diagram';
import { declared, token } from './css';

describe('the diagram theme', () => {
  it('has no violet and keeps the page teal', () => {
    for (const dark of [false, true]) {
      const text = JSON.stringify(themeVariables(dark)).toLowerCase();
      for (const violet of ['#6a4dff', '#7c5cff', '#2b2557', '#e6e1ff']) expect(text).not.toContain(violet);
    }
    expect(themeVariables(false).primaryBorderColor).toBe('#1d5c63');
    expect(themeVariables(true).primaryBorderColor).toBe('#5fb4bc');
    expect(themeVariables(false).primaryColor).toBe('#dcebec');
    expect(themeVariables(true).primaryColor).toBe('#1f3a3e');
    expect(themeVariables(false).edgeLabelBackground).toBe('#ffffff');
    expect(themeVariables(true).sequenceNumberColor).toBe('#0d1517');
  });

  it('uses the page font family', () => {
    const family = token('--font-sans') as string;
    for (const dark of [false, true]) expect(themeVariables(dark).fontFamily).toBe(family);
    expect(declared('body', 'font-family')).toBe('var(--font-sans)');
  });
});
