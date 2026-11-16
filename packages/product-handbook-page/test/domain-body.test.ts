// The filter that hides the hand-over list of a domain section (openspec change handbook-page-structure, task 11.1).
import { describe, expect, it } from 'vitest';

import { withoutHandoverList } from '../src/lib/domain-body';

const TABLE = '| Feature | Purpose |\n| --- | --- |\n| A | does a |';
const LIST = '- hands x over\n- receives y';
const MAIN = '```mermaid\nflowchart TD\n  A --> B\n```\n\n1. first\n2. second';

describe('withoutHandoverList', () => {
  it('keeps the features table and the main line and drops the section that is only a bullet list', () => {
    const text = `### One\n\n${TABLE}\n\n### Two\n\n${LIST}\n\n### Three\n\n${MAIN}\n`;
    const out = withoutHandoverList(text);
    expect(out).toContain('### One');
    expect(out).toContain(TABLE);
    expect(out).toContain('### Three');
    expect(out).toContain('```mermaid');
    expect(out).not.toContain('### Two');
    expect(out).not.toContain('hands x over');
  });

  it('recognises the list by its form, whatever the heading says', () => {
    expect(withoutHandoverList(`### Anything at all\n\n${LIST}\n\n### Next\n\ntext\n`)).toBe('### Next\n\ntext\n');
    expect(withoutHandoverList(`### One\n\ntext\n\n* star item\n`)).toBe('');
    expect(withoutHandoverList(`### One\n\ntext\n\n+ plus item\n\n### Two\n\nkept\n`)).toBe('### Two\n\nkept\n');
  });

  it('keeps a section that has a list and a table, or a list and a mermaid block', () => {
    const both = `### Mixed\n\n${TABLE}\n\n${LIST}\n`;
    expect(withoutHandoverList(`${both}\n### Other\n\n${LIST}\n`)).toContain('### Mixed');
    const chart = `### Flow\n\n${LIST}\n\n${MAIN}\n`;
    expect(withoutHandoverList(chart)).toBe(chart);
  });

  it('does not count a list item inside a fenced code block, nor a heading inside one', () => {
    const fenced = '### Code\n\n```text\n- not a list\n### not a heading\n```\n';
    expect(withoutHandoverList(`${fenced}\n### List\n\n${LIST}\n`)).toBe(fenced);
    expect(withoutHandoverList(`### A\n\n- real\n\n\`\`\`\n### inside\n\`\`\`\n`)).toBe('');
  });

  it('returns a body with no level-3 heading unchanged', () => {
    const text = `Some words.\n\n${LIST}\n\n## Level two\n\n- item\n`;
    expect(withoutHandoverList(text)).toBe(text);
    expect(withoutHandoverList('')).toBe('');
  });

  it('keeps the text before the first level-3 heading, even when it holds a list', () => {
    const out = withoutHandoverList(`Lead words.\n\n- lead item\n\n### List\n\n${LIST}\n\n### Table\n\n${TABLE}\n`);
    expect(out).toContain('Lead words.');
    expect(out).toContain('- lead item');
    expect(out).not.toContain('### List');
    expect(out).toContain('### Table');
  });

  it('keeps a section with a numbered list and no mermaid block', () => {
    const text = '### Steps\n\n1. one\n2. two\n';
    expect(withoutHandoverList(text)).toBe(text);
  });
});
