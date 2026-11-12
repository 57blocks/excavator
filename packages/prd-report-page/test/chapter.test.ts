import { describe, expect, it } from 'vitest';

import { dropDuplicateTitle } from '../src/lib/chapter';

const NAME = 'Order placement';
const REST = 'A customer fills in the form.\n\n## Rules\n\ntext';

describe('dropDuplicateTitle', () => {
  it('drops a first heading that equals the feature name, with the blank lines after it', () => {
    expect(dropDuplicateTitle(`## ${NAME}\n\n${REST}`, NAME)).toBe(REST);
    expect(dropDuplicateTitle(`# ${NAME}\n${REST}`, NAME)).toBe(REST);
  });

  it('drops it at any heading level, after blank lines, trimmed, with closing hashes', () => {
    expect(dropDuplicateTitle(`\n\n###   ${NAME}   ###\n\n${REST}`, NAME)).toBe(REST);
    expect(dropDuplicateTitle(`  ## ${NAME}  \n\n${REST}`, NAME)).toBe(REST);
    expect(dropDuplicateTitle(`## ${NAME}\n\n${REST}`, `  ${NAME} `)).toBe(REST);
  });

  it('drops a two-line (setext) heading too', () => {
    expect(dropDuplicateTitle(`${NAME}\n=====\n\n${REST}`, NAME)).toBe(REST);
    expect(dropDuplicateTitle(`${NAME}\n-----\n\n${REST}`, NAME)).toBe(REST);
  });

  it('keeps a first heading with other text, or another case', () => {
    const different = `## Order placement flow\n\n${REST}`;
    expect(dropDuplicateTitle(different, NAME)).toBe(different);
    const cased = `## order placement\n\n${REST}`;
    expect(dropDuplicateTitle(cased, NAME)).toBe(cased);
    const marked = `## **${NAME}**\n\n${REST}`;
    expect(dropDuplicateTitle(marked, NAME)).toBe(marked);
  });

  it('keeps a heading that is not the first block', () => {
    const later = `Intro text.\n\n## ${NAME}\n\n${REST}`;
    expect(dropDuplicateTitle(later, NAME)).toBe(later);
  });

  it('keeps a first block that only looks like the name: a paragraph, a code line, a table', () => {
    for (const body of [`${NAME}\n\n${REST}`, `\`\`\`\n# ${NAME}\n\`\`\`\n\n${REST}`, `${NAME}\n\n---\n\n${REST}`, `    # ${NAME}\n\n${REST}`]) {
      expect(dropDuplicateTitle(body, NAME), body).toBe(body);
    }
  });

  it('drops only the first of two equal headings, and leaves an empty body empty', () => {
    expect(dropDuplicateTitle(`## ${NAME}\n\n## ${NAME}\n\ntext`, NAME)).toBe(`## ${NAME}\n\ntext`);
    expect(dropDuplicateTitle('', NAME)).toBe('');
    expect(dropDuplicateTitle(`## ${NAME}`, NAME)).toBe('');
  });
});
