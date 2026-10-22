import { describe, expect, it } from 'vitest';

import { splitSentences } from '../../../skills/excavator/tour-sentences.mjs';

// Fullwidth marks are built at runtime so no non-ASCII character is in this file.
const FULL_STOP = String.fromCharCode(0x3002);
const WIDE_QUESTION = String.fromCharCode(0xff1f);
const CJK_TEXT = String.fromCharCode(0x542f, 0x52a8);

describe('splitSentences', () => {
  it('splits at . ! ? followed by whitespace or the end of the text', () => {
    expect(splitSentences('One. Two! Three? Four')).toEqual(['One.', 'Two!', 'Three?', 'Four']);
  });

  it('does not split inside a file name, a number or a version', () => {
    expect(splitSentences('It calls main.go at version 3.5 and reads a.b.c. Then it stops.')).toEqual([
      'It calls main.go at version 3.5 and reads a.b.c.',
      'Then it stops.',
    ]);
  });

  it('does not split after e.g., i.e., vs. or cf.', () => {
    expect(splitSentences('It reads files, e.g. the config, and caches them. It is fast vs. the old one, i.e. much faster.')).toEqual([
      'It reads files, e.g. the config, and caches them.',
      'It is fast vs. the old one, i.e. much faster.',
    ]);
  });

  it('does not split inside a backtick span', () => {
    expect(splitSentences('It runs `a. b? c!` once. Then it ends.')).toEqual(['It runs `a. b? c!` once.', 'Then it ends.']);
  });

  it('keeps closing quotes and brackets and runs of marks with their sentence', () => {
    expect(splitSentences('He said "stop." (Really?!) Then left.')).toEqual(['He said "stop."', '(Really?!)', 'Then left.']);
  });

  it('ends a sentence at a fullwidth mark with no space after it', () => {
    expect(splitSentences(`${CJK_TEXT}${FULL_STOP}${CJK_TEXT}${WIDE_QUESTION}${CJK_TEXT}`)).toEqual([`${CJK_TEXT}${FULL_STOP}`, `${CJK_TEXT}${WIDE_QUESTION}`, CJK_TEXT]);
  });

  it('collapses whitespace and newlines, and returns nothing for empty text', () => {
    expect(splitSentences('  One\n\n  line.\tTwo.  ')).toEqual(['One line.', 'Two.']);
    expect(splitSentences('   ')).toEqual([]);
    expect(splitSentences(undefined)).toEqual([]);
  });
});
