import { describe, expect, it } from 'vitest';

import { normalizeRow } from '../unused';

const raw = (over: Record<string, unknown> = {}) => ({
  id: 'function:a.go:f()', name: 'f', language: 'go', file: 'a.go', lineRange: [3, 9], owner: 'class:a.go:T', visibility: 'private',
  reason: 'unreferenced', referrers: [], group: 0, confidence: 'low', signals: [], ...over,
});
describe('normalizeRow', () => {
  it('keeps what the product says and leaves the rest null', () => {
    const row = normalizeRow(raw({ visibility: null, owner: null, group: 4 }));
    expect(row).toMatchObject({ name: 'f', language: 'go', file: 'a.go', visibility: null, owner: null, group: 4, confidence: 'low' });
    expect(row.lineRange).toEqual([3, 9]);
    const bare = normalizeRow({ id: 'x' });
    expect(bare).toMatchObject({ name: null, owner: null, language: null, file: null, lineRange: null, visibility: null, reason: null, confidence: null, group: null });
    expect(bare.signals).toEqual([]);
  });

  it('does not take a malformed line range', () => {
    expect(normalizeRow(raw({ lineRange: 'x' })).lineRange).toBeNull();
    expect(normalizeRow(raw({ lineRange: [] })).lineRange).toBeNull();
  });
});

