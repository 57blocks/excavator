import { describe, expect, it } from 'vitest';

import { adviceTerms, findAdvice } from '../../../skills/excavator/tour-advice.mjs';

// The Chinese terms are built from code points so that no Chinese character is in this file.
const zh = (...codePoints) => String.fromCharCode(...codePoints);
const CHINESE_TERMS = [
  zh(0x5efa, 0x8bae), zh(0x5e94, 0x8be5), zh(0x5e94, 0x5f53), zh(0x6700, 0x597d),
  zh(0x63a8, 0x8350), zh(0x9700, 0x8981, 0x6539, 0x8fdb), zh(0x4e0d, 0x59a8), zh(0x53ef, 0x4ee5, 0x8003, 0x8651),
];
const ENGLISH_TERMS = [
  'should', 'recommend', 'consider', 'better to', 'ought to', 'needs to be improved', 'we suggest', 'you may want', 'it is advisable', 'best practice',
];

describe('adviceTerms', () => {
  it.each(ENGLISH_TERMS)('finds the English term "%s" in any case', (term) => {
    expect(adviceTerms(`The handler ${term.toUpperCase()} be split.`, 'en')).toEqual([term]);
    expect(adviceTerms(`The handler ${term} be split.`, undefined)).toEqual([term]);
  });

  it('matches whole words only', () => {
    for (const text of ['The shoulder of the road.', 'It was reconsidered.', 'A considerable cache.', 'The recommendation engine.', 'A betterment.']) {
      expect(adviceTerms(text, 'en'), text).toEqual([]);
    }
    expect(adviceTerms('It is not a best   practice.', 'en')).toEqual(['best practice']);
  });

  it('does not read inside a backtick span', () => {
    expect(adviceTerms('The method `shouldRetry` and `recommend` are names.', 'en')).toEqual([]);
    expect(adviceTerms('The method `recommend` is called. It should stop.', 'en')).toEqual(['should']);
  });

  it.each(CHINESE_TERMS)('finds a Chinese term in a zh draft, with no word boundary', (term) => {
    expect(adviceTerms(`abc${term}def`, 'zh')).toEqual([term]);
    expect(adviceTerms(`abc${term}def`, 'zh-CN')).toEqual([term]);
  });

  it('applies the Chinese list only to a zh draft, and the English list always', () => {
    const text = `abc${CHINESE_TERMS[0]}def`;
    expect(adviceTerms(text, 'en')).toEqual([]);
    expect(adviceTerms(text, 'fr')).toEqual([]);
    expect(adviceTerms(text, undefined)).toEqual([]);
    expect(adviceTerms('It should stop.', 'zh')).toEqual(['should']);
    expect(adviceTerms(`${CHINESE_TERMS[1]} and should`, 'zh').sort()).toEqual([CHINESE_TERMS[1], 'should'].sort());
  });

  it('does not take a language that only starts with zh for Chinese', () => {
    expect(adviceTerms(`abc${CHINESE_TERMS[0]}def`, 'zhx')).toEqual([]);
  });
});

describe('findAdvice', () => {
  it('names the title and the sentence ids of the lines that use advisory wording', () => {
    const steps = [
      { order: 1, title: 'Fine title', description: 'It reads. It writes.', languageLesson: 'A lesson.' },
      { order: 2, title: 'You should read this', description: 'It reads. It ought to retry. Fine.', languageLesson: 'Fine one. Better to return errors.' },
    ];
    expect(findAdvice(steps, 'en')).toEqual([
      { step: 2, id: 'title', terms: ['should'] },
      { step: 2, id: '2.d2', terms: ['ought to'] },
      { step: 2, id: '2.l2', terms: ['better to'] },
    ]);
  });

  it('finds nothing in a tour that only says what the code does', () => {
    expect(findAdvice([{ order: 1, title: 'Start-up', description: 'main calls Execute. Execute parses flags.' }], 'en')).toEqual([]);
  });
});
