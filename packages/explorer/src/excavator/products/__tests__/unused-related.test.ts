import { describe, expect, it } from 'vitest';

import { normalizeRow } from '../unused';
import { confidenceBars, groupMates, languageBars, referrerList } from '../unused-related';

const raw = (id: string, over: Record<string, unknown> = {}) => ({ id, name: id, file: 'src/a.js', lineRange: [1, 2], reason: 'unreferenced', confidence: 'high', group: 0, signals: [], referrers: [], ...over });

describe('the group of an unused function', () => {
  const groups = [
    { group: 0, entries: ['f:a'], members: ['f:a', 'f:b', 'f:c'] },
    { group: 1, entries: ['f:d'], members: ['f:d'] },
  ];

  it('lists the other members of its group, in the product\'s order, with the group\'s entries', () => {
    expect(groupMates(groups, normalizeRow(raw('f:b')))).toEqual({ state: 'listed', group: 0, entries: ['f:a'], others: ['f:a', 'f:c'] });
    expect(groupMates(groups, normalizeRow(raw('f:d', { group: 1 })))).toEqual({ state: 'listed', group: 1, entries: ['f:d'], others: [] });
  });

  it('says when the row has no group, and when the product lists no such group', () => {
    expect(groupMates(groups, normalizeRow(raw('f:x', { group: null })))).toEqual({ state: 'no-group' });
    expect(groupMates(groups, normalizeRow(raw('f:x', { group: 7 })))).toEqual({ state: 'not-listed', group: 7 });
    expect(groupMates(undefined, normalizeRow(raw('f:x', { group: 0 })))).toEqual({ state: 'not-listed', group: 0 });
  });
});

describe('the referrers of an unused function', () => {
  it('keeps each referrer with its edge, and says which are rows of the unused list', () => {
    const row = normalizeRow(raw('f:b', { referrers: [{ id: 'f:a', edge: 'calls', reverse: false }, { id: 'f:z', edge: 'imports', reverse: true }] }));
    expect(referrerList(row, new Set(['f:a', 'f:b']))).toEqual({
      state: 'listed',
      referrers: [{ id: 'f:a', edge: 'calls', reverse: false, listed: true }, { id: 'f:z', edge: 'imports', reverse: true, listed: false }],
    });
  });

  it('says the product does not provide them when the row has no referrers field', () => {
    const row = normalizeRow({ id: 'f:b', name: 'b' });
    expect(row.referrers).toBeNull();
    expect(referrerList(row, new Set())).toEqual({ state: 'not-provided' });
  });
});

describe('the distribution charts of the Unused page', () => {
  const counts = {
    byConfidence: { high: 4, medium: 0, low: 2 },
    byLanguage: { python: { unused: 1 }, go: { unused: 5 }, java: { candidates: 3 } },
  };

  it('takes the counts by confidence from the product, in confidence order', () => {
    expect(confidenceBars(counts)).toEqual({ rows: [{ key: 'high', label: 'high', value: 4 }, { key: 'medium', label: 'medium', value: 0 }, { key: 'low', label: 'low', value: 2 }], missing: [] });
  });

  it('takes the unused count of each language from the product, and names a language that has none', () => {
    expect(languageBars(counts)).toEqual({ rows: [{ key: 'go', label: 'go', value: 5 }, { key: 'python', label: 'python', value: 1 }], missing: ['java'] });
  });

  it('names every bar as missing when the product has no such counts, never 0', () => {
    expect(confidenceBars({})).toEqual({ rows: [], missing: ['high', 'medium', 'low'] });
    expect(languageBars({})).toEqual({ rows: [], missing: [] });
  });
});
