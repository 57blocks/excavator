import { describe, expect, it } from 'vitest';

import { sortRows } from '../src/lib/table';
import { distinct, filterRows, KEYS, languageOf, normalizeRow, queryHead, signalsText, signalsTitle, type UnusedRow } from '../src/lib/unused';

const raw = (over: Record<string, unknown> = {}) => ({
  id: 'function:a.go:f()', name: 'f', language: 'go', file: 'a.go', lineRange: [3, 9], owner: 'class:a.go:T', visibility: 'private',
  reason: 'unreferenced', referrers: [], group: 0, confidence: 'low', signals: [], ...over,
});
const rows = (list: Record<string, unknown>[]) => list.map((r) => normalizeRow(raw(r)));

function random(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

describe('filterRows', () => {
  const list = rows([
    { id: '1', name: 'Alpha', confidence: 'high', reason: 'unreferenced', language: 'go', file: 'svc/a.go', group: 1 },
    { id: '2', name: 'beta', confidence: 'medium', reason: 'only-reachable-from-unused', language: 'typescript', file: 'ui/b.ts', owner: 'class:ui/b.ts:Widget', group: 1 },
    { id: '3', name: 'gamma', confidence: 'low', reason: 'unreferenced', language: null, file: 'x/c.js', group: 2 },
    { id: '4', name: 'delta', confidence: 'low', reason: 'unreferenced', language: 'go', file: 'svc/d.go', group: 3 },
  ]);
  const ids = (matching: UnusedRow[]) => matching.map((r) => r.id);

  it('keeps every row when nothing is chosen', () => {
    expect(ids(filterRows(list, {}))).toEqual(['1', '2', '3', '4']);
    expect(ids(filterRows(list, { confidence: [], reason: [], language: [], text: '  ', group: null }))).toEqual(['1', '2', '3', '4']);
  });

  it('filters by one or several values of a field', () => {
    expect(ids(filterRows(list, { confidence: ['high'] }))).toEqual(['1']);
    expect(ids(filterRows(list, { confidence: ['high', 'medium'] }))).toEqual(['1', '2']);
    expect(ids(filterRows(list, { reason: ['only-reachable-from-unused'] }))).toEqual(['2']);
    expect(ids(filterRows(list, { language: ['go'] }))).toEqual(['1', '4']);
  });

  it('counts a row without a language under unknown', () => {
    expect(ids(filterRows(list, { language: ['unknown'] }))).toEqual(['3']);
    expect(distinct(list, languageOf)).toEqual(['go', 'typescript', 'unknown']);
  });

  it('combines fields with and, values of one field with or', () => {
    expect(ids(filterRows(list, { confidence: ['low'], language: ['go'] }))).toEqual(['4']);
    expect(ids(filterRows(list, { confidence: ['high'], language: ['typescript'] }))).toEqual([]);
  });

  it('searches the name, the owner and the file, ignoring case', () => {
    expect(ids(filterRows(list, { text: 'ALPHA' }))).toEqual(['1']);
    expect(ids(filterRows(list, { text: 'widget' }))).toEqual(['2']);
    expect(ids(filterRows(list, { text: 'svc/' }))).toEqual(['1', '4']);
    expect(ids(filterRows(list, { text: 'no such thing' }))).toEqual([]);
  });

  it('does not match the search against other fields', () => {
    expect(ids(filterRows(list, { text: 'medium' }))).toEqual([]);
    expect(ids(filterRows(list, { text: 'typescript' }))).toEqual([]);
  });

  it('filters by group, including group 0', () => {
    const zero = rows([{ id: 'z', group: 0 }, { id: 'o', group: 1 }]);
    expect(ids(filterRows(zero, { group: 0 }))).toEqual(['z']);
    expect(ids(filterRows(zero, { group: null }))).toEqual(['z', 'o']);
  });

  it('keeps the order of the rows and does not change them', () => {
    const before = list.map((r) => r.id);
    filterRows(list, { confidence: ['low'] });
    expect(list.map((r) => r.id)).toEqual(before);
  });
});

describe('choosing only high gives the high count of the product', () => {
  it('on a fixture', () => {
    const product = { counts: { byConfidence: { high: 2, medium: 1, low: 3 } } };
    const list = rows([
      { id: '1', confidence: 'high' }, { id: '2', confidence: 'low' }, { id: '3', confidence: 'high' },
      { id: '4', confidence: 'medium' }, { id: '5', confidence: 'low' }, { id: '6', confidence: 'low' },
    ]);
    expect(filterRows(list, { confidence: ['high'] })).toHaveLength(product.counts.byConfidence.high);
    expect(filterRows(list, { confidence: ['medium'] })).toHaveLength(product.counts.byConfidence.medium);
    expect(filterRows(list, { confidence: ['low'] })).toHaveLength(product.counts.byConfidence.low);
  });

  it('over random rows, for each level and for the three together', () => {
    const next = random(2026);
    const levels = ['high', 'medium', 'low'];
    for (let round = 0; round < 100; round++) {
      const list = rows(Array.from({ length: Math.floor(next() * 300) }, (_, i) => ({
        id: String(i), confidence: levels[Math.floor(next() * 3)], language: ['go', 'java', null][Math.floor(next() * 3)], group: Math.floor(next() * 5),
      })));
      const counts: Record<string, number> = { high: 0, medium: 0, low: 0 };
      list.forEach((r) => { counts[r.confidence as string] += 1; });
      for (const level of levels) expect(filterRows(list, { confidence: [level] })).toHaveLength(counts[level]);
      expect(filterRows(list, { confidence: levels })).toHaveLength(list.length);
      const sum = levels.reduce((n, level) => n + filterRows(list, { confidence: [level], language: ['go'] }).length, 0);
      expect(sum).toBe(filterRows(list, { language: ['go'] }).length);
    }
  });
});

describe('sort keys', () => {
  const sorted = (column: keyof typeof KEYS, list: UnusedRow[], dir: 1 | -1 = 1) => sortRows(list, KEYS[column], dir).map((r) => r.id);

  it('orders confidence by level, not by the word', () => {
    const list = rows([{ id: 'l', confidence: 'low' }, { id: 'h', confidence: 'high' }, { id: 'm', confidence: 'medium' }]);
    expect(sorted('confidence', list, -1)).toEqual(['h', 'm', 'l']);
    expect(sorted('confidence', list, 1)).toEqual(['l', 'm', 'h']);
  });

  it('orders groups as numbers and puts a row without a group last', () => {
    const list = rows([{ id: 'a', group: 10 }, { id: 'b', group: 9 }, { id: 'c', group: null }, { id: 'd', group: 0 }]);
    expect(sorted('group', list)).toEqual(['d', 'b', 'a', 'c']);
    expect(sorted('group', list, -1)).toEqual(['a', 'b', 'd', 'c']);
  });

  it('orders a location by file and then by first line as a number', () => {
    const list = rows([
      { id: 'a', file: 'b.go', lineRange: [100, 120] }, { id: 'b', file: 'a.go', lineRange: [20, 30] },
      { id: 'c', file: 'a.go', lineRange: [3, 4] }, { id: 'd', file: null, lineRange: null },
    ]);
    expect(sorted('location', list)).toEqual(['c', 'b', 'a', 'd']);
  });

  it('orders by the number of signals', () => {
    const list = rows([{ id: 'a', signals: [{ signal: 'x' }, { signal: 'y' }] }, { id: 'b', signals: [] }, { id: 'c', signals: [{ signal: 'x' }] }]);
    expect(sorted('signals', list)).toEqual(['b', 'c', 'a']);
  });

  it('sorts every column without losing a row', () => {
    const list = rows([{ id: '1' }, { id: '2', name: null, owner: null, language: null, visibility: 'public' }, { id: '3', name: 'z' }]);
    for (const column of Object.keys(KEYS) as (keyof typeof KEYS)[]) expect(sorted(column, list).slice().sort()).toEqual(['1', '2', '3']);
  });
});

describe('signal wording', () => {
  const sig = (...names: string[]) => names.map((signal) => ({ signal }));

  it('shows the first two signal names and how many more there are', () => {
    expect(signalsText(sig('capped'))).toBe('capped');
    expect(signalsText(sig('capped', 'name-elsewhere'))).toBe('capped, name-elsewhere');
    expect(signalsText(sig('capped', 'test-only-referrer', 'a', 'b'))).toBe('capped, test-only-referrer +2');
    expect(signalsText(sig('a', 'b', 'c'))).toBe('a, b +1');
  });

  it('has no text for no signals', () => {
    expect(signalsText([])).toBeNull();
    expect(signalsText(undefined)).toBeNull();
    expect(signalsTitle([])).toBeNull();
  });

  it('gives every signal, with everything it records, in the title', () => {
    const signals = [{ signal: 'capped', from: 'medium', by: 'function:x' }, { signal: 'name-elsewhere', count: 2, samples: [{ file: 'a', line: 1 }] }];
    expect(JSON.parse(signalsTitle(signals) as string)).toEqual(signals);
  });
});

describe('queryHead', () => {
  it('keeps a short one-line query whole', () => {
    expect(queryHead('.a | .b')).toEqual({ head: '.a | .b', rest: false });
  });

  it('cuts a long first line at 60 characters and says something is left out', () => {
    expect(queryHead('x'.repeat(100))).toEqual({ head: `${'x'.repeat(60)}...`, rest: true });
  });

  it('takes the first line of a multi-line query', () => {
    expect(queryHead('def f: .a;\n.b | f')).toEqual({ head: 'def f: .a;', rest: true });
  });

  it('does not cut a line of exactly 60 characters', () => {
    expect(queryHead('y'.repeat(60))).toEqual({ head: 'y'.repeat(60), rest: false });
  });
});
