// The scope words of the run's table (openspec change handbook-feature-findings, design D9): the table ships, and a
// word is found as a whole word, a phrase as a whole phrase.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import * as findingsCheck from '../../../skills/excavator-product-handbook/lib/findings-check.mjs';
import { MARK } from './helpers.mjs';

const WORDS = 'all,every,each,any,always,never,none,nobody,no one,only,whenever,whatever,every time,will not,won\'t,cannot,can\'t,does not,doesn\'t,instead of,rather than';
const CJK_SCOPE = String.fromCodePoint(0x6240, 0x6709);

describe('the scope words of the run\'s table', () => {
  it('ships md.findings.scopeWords as a comma-separated list of English words', () => {
    const shipped = JSON.parse(readFileSync(new URL('../../../skills/excavator-product-handbook/ui-strings.json', import.meta.url), 'utf-8')).strings;
    expect(shipped['md.findings.scopeWords']).toBe(WORDS);
    expect(findingsCheck.scopeWordsOf(shipped)).toEqual(WORDS.split(','));
  });

  it('matches a word written only in ASCII as a whole word ignoring case, a word of another script as a substring', () => {
    const words = ['all', 'every', 'no one', CJK_SCOPE];
    expect(findingsCheck.wordsIn('Overall the shipment is small, and a ball is not all.', words)).toEqual(['all']);
    expect(findingsCheck.wordsIn('Overall, every ball bounces.', words)).toEqual(['every']);
    expect(findingsCheck.wordsIn('ALL of it, and No One cares.', words)).toEqual(['all', 'no one']);
    expect(findingsCheck.wordsIn('Nothing about it.', ['no one', 'none'])).toEqual([]);
    expect(findingsCheck.wordsIn(`${MARK}x${CJK_SCOPE}y`, words)).toEqual([CJK_SCOPE]);
  });

  it('lists the words in the order of the table, each once', () => {
    expect(findingsCheck.wordsIn('Always, whatever happens, always and every one.', ['every', 'always', 'whatever'])).toEqual(['every', 'always', 'whatever']);
  });
});

describe('negative and contrasting words are scope words too (design D10 of handbook-system-findings)', () => {
  const NEW_WORDS = ['will not', "won't", 'cannot', "can't", 'does not', "doesn't", 'instead of', 'rather than'];
  const shipped = JSON.parse(readFileSync(new URL('../../../skills/excavator-product-handbook/ui-strings.json', import.meta.url), 'utf-8')).strings;
  const table = findingsCheck.scopeWordsOf(shipped);

  it('the shipped table holds them, after the earlier words and in this order', () => {
    expect(table.slice(-NEW_WORDS.length)).toEqual(NEW_WORDS);
    expect(table.slice(0, 13)).toEqual('all,every,each,any,always,never,none,nobody,no one,only,whenever,whatever,every time'.split(','));
    expect(new Set(table).size).toBe(table.length);
  });

  it('a phrase matches as a whole phrase: "rather than" is found, "rather" alone is not, nor is a longer word around it', () => {
    expect(findingsCheck.wordsIn('The list opens rather than the detail page.', table)).toEqual(['rather than']);
    expect(findingsCheck.wordsIn('The list is rather long, and a rather odd one.', table)).toEqual([]);
    expect(findingsCheck.wordsIn('It opens the list instead of the page.', table)).toEqual(['instead of']);
    expect(findingsCheck.wordsIn('It opens the list instead off the page and does nothing.', table)).toEqual([]);
  });

  it('the forms with an apostrophe match: won\'t, can\'t, doesn\'t, in any case, also with a typographic apostrophe', () => {
    const curly = String.fromCharCode(0x2019);
    expect(findingsCheck.wordsIn("The caller won't be asked.", table)).toEqual(["won't"]);
    expect(findingsCheck.wordsIn("It CAN'T be undone and doesn't ask.", table)).toEqual(["can't", "doesn't"]);
    expect(findingsCheck.wordsIn(`It won${curly}t be asked and can${curly}t be undone.`, table)).toEqual(["won't", "can't"]);
    expect(findingsCheck.wordsIn('A swon t is not a word, and cannot is one.', table)).toEqual(['cannot']);
  });

  it('a negative word is a whole word: "does not" and "will not" are found, "does nothing" and "willnot" are not', () => {
    expect(findingsCheck.wordsIn('It does not ask and will not answer.', table)).toEqual(['will not', 'does not']);
    expect(findingsCheck.wordsIn('It does nothing and willnot happen.', table)).toEqual([]);
  });

});
