// The banned-words and value checks as functions, with the edge cases the CLI
// tests do not reach: where a hit is and is not a hit.
import { describe, expect, it } from 'vitest';

import { bannedFragments, outsideLabels } from '../../../skills/excavator-product-handbook/lib/banned-words.mjs';
import { labelOccurs, missingNumbers, numbersIn } from '../../../skills/excavator-product-handbook/lib/values.mjs';

const found = (text, options) => bannedFragments(text, options).map((hit) => `${hit.fragment}|${hit.category}`);

describe('bannedFragments', () => {
  it('finds one example of each class', () => {
    expect(found('role_admin')).toEqual(['role_admin|underscore identifier']);
    expect(found('userName')).toEqual(['userName|camelCase identifier']);
    expect(found('PayPal')).toEqual(['PayPal|multi-hump word']);
    expect(found('see /api/v1/users now')).toEqual(['/api/v1/users|path']);
    expect(found('main.go')).toEqual(['main.go|source file extension']);
    expect(found('call run(x)')).toEqual(['run(|call form']);
    expect(found('the member-repo service', { memberDirs: ['member-repo'] })).toEqual(['member-repo|member directory name']);
  });

  it('covers every listed source extension', () => {
    for (const ext of ['go', 'ts', 'tsx', 'js', 'jsx', 'java', 'py', 'sql', 'json', 'yaml', 'yml']) {
      expect(found(`open file.${ext} first`), ext).toEqual([`file.${ext}|source file extension`]);
    }
  });

  it('passes ordinary text', () => {
    for (const text of [
      'Approve and/or reject the request.', 'Hello World', 'HTTP and URLs and IDs', 'Version 2.5 of the plan', 'Visit 12/05/2024 or 1/2 of it',
      'e.g. an order. i.e. a sale', 'Total (in dollars)', 'The src folder', 'Yes/No question', 'TCP/IP link',
    ]) expect(found(text), text).toEqual([]);
  });

  it('matches a member directory only as a whole word', () => {
    expect(found('ledgerish and aledger and ledger-2', { memberDirs: ['ledger'] })).toEqual([]);
    expect(found('the ledger service', { memberDirs: ['ledger'] })).toHaveLength(1);
  });

  it('does not treat text in other scripts as a word character', () => {
    const text = `${String.fromCodePoint(0x91d1, 0x984d)}(${String.fromCodePoint(0x5143)})`;
    expect(found(text)).toEqual([]);
  });
});

describe('outsideLabels', () => {
  it('drops only the hits inside an occurrence of a verified label', () => {
    const text = 'Open WorkBoard or the WorkBoards page';
    const hits = bannedFragments(text);
    expect(hits.map((hit) => hit.fragment)).toEqual(['WorkBoard', 'WorkBoards']);
    expect(outsideLabels(hits, text, new Set(['WorkBoard'])).map((hit) => hit.fragment)).toEqual(['WorkBoards']);
    expect(outsideLabels(hits, text, new Set()).length).toBe(2);
  });

  it('finds a label written with different white space', () => {
    const text = 'Use Pay  Pal_x now';
    expect(outsideLabels(bannedFragments(text), text, new Set(['Pay Pal_x'])).length).toBe(1);
    const spaced = 'Use Pay Pal_x now';
    expect(bannedFragments(spaced).length).toBe(1);
    expect(outsideLabels(bannedFragments(spaced), spaced, new Set(['Pay Pal_x'])).length).toBe(0);
  });
});

describe('numbers and labels', () => {
  it('reads numbers with thousands commas, decimals and plain digits', () => {
    expect(numbersIn('At most 35,000 of 1,234,567.5 and 12 or 3.75')).toEqual(['35000', '1234567.5', '12', '3.75']);
    expect(numbersIn('1,2,3')).toEqual(['1', '2', '3']);
  });

  it('compares a number against the passages after removing commas and underscore separators', () => {
    expect(missingNumbers('35,000 items', ['max: 35000'])).toEqual([]);
    expect(missingNumbers('35000 items', ['max: 35,000'])).toEqual([]);
    expect(missingNumbers('100,000 bytes', ['MAX = 100_000'])).toEqual([]);
    expect(missingNumbers('35,001 items', ['max: 35000'])).toEqual(['35001']);
    expect(missingNumbers('3 and 3 and 4', ['x = 3'])).toEqual(['4']);
    expect(missingNumbers('no digits here', [])).toEqual([]);
    expect(missingNumbers('1 item', [])).toEqual(['1']);
  });

  it('matches a label after normalization', () => {
    expect(labelOccurs('Order Status', ['  label:  "Order\n Status" '])).toBe(true);
    expect(labelOccurs('Order Status', ['label: "Order State"'])).toBe(false);
    expect(labelOccurs('x', [])).toBe(false);
  });
});
