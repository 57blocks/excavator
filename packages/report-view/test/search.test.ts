import { describe, expect, it } from 'vitest';

import type { GraphNode } from '../src/data/graph';
import { buildSearchIndex, fuzzyScore, searchNodes } from '../src/lib/search';

const node = (id: string, name: string, filePath?: string, type = 'function'): GraphNode => ({ id, type, name, ...(filePath ? { filePath } : {}) });

describe('fuzzyScore', () => {
  it('ranks the whole text above a prefix, a run of characters, and a subsequence', () => {
    const whole = fuzzyScore('route', 'route') as number;
    const prefix = fuzzyScore('route', 'router') as number;
    const run = fuzzyScore('route', 'subroute') as number;
    const subsequence = fuzzyScore('route', 'reload_outer') as number;
    expect(whole).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(run);
    expect(run).toBeGreaterThan(subsequence);
    expect(subsequence).toBeGreaterThan(0);
  });

  it('matches characters in order only, and gives nothing for a text that lacks one', () => {
    expect(fuzzyScore('ab', 'a_b')).not.toBeNull();
    expect(fuzzyScore('ba', 'ab')).toBeNull();
    expect(fuzzyScore('abc', 'ab')).toBeNull();
    expect(fuzzyScore('', 'abc')).toBeNull();
  });

  it('prefers a tight subsequence and word starts to a scattered one', () => {
    expect(fuzzyScore('gh', 'get_header') as number).toBeGreaterThan(fuzzyScore('gh', 'gxxxxxxxxxxh') as number);
    expect(fuzzyScore('gh', 'big_house') as number).toBeGreaterThan(fuzzyScore('gh', 'bigahouse') as number);
  });
});

describe('searchNodes', () => {
  const entries = buildSearchIndex([
    node('f1', 'login.ts', 'src/auth/login.ts', 'file'),
    node('n1', 'login', 'src/auth/login.ts'),
    node('n2', 'loginRedirect', 'src/web/redirect.ts'),
    node('n3', 'logger', 'src/log/logger.ts'),
    node('n4', 'handle', 'src/auth/login.ts'),
    node('n5', 'relogin', 'src/auth/session.ts'),
    node('n6', 'lo_g_in', 'src/x.ts'),
  ]);

  it('ranks the exact name first, then names that start with the query, then runs, then subsequences', () => {
    expect(searchNodes(entries, 'login').map((h) => h.id).slice(0, 5)).toEqual(['n1', 'f1', 'n2', 'n5', 'n6']);
  });

  it('finds a node by its path when the name does not match, ranking the file above the nodes in it', () => {
    const hits = searchNodes(entries, 'auth/login');
    expect(hits.map((h) => h.id)).toEqual(['f1', 'n1', 'n4']);
    expect(hits.every((h) => h.field === 'path' || h.id === 'f1')).toBe(true);
  });

  it('needs every word of the query to match the name or the path', () => {
    expect(searchNodes(entries, 'login redirect').map((h) => h.id)).toEqual(['n2']);
    expect(searchNodes(entries, 'login zzz')).toEqual([]);
  });

  it('is case-insensitive, gives nothing for an empty query, and keeps to the limit', () => {
    expect(searchNodes(entries, 'LOGIN')[0].id).toBe('n1');
    expect(searchNodes(entries, '   ')).toEqual([]);
    expect(searchNodes(entries, 'o', 2)).toHaveLength(2);
  });

  it('breaks a tie by the shorter name, then the id', () => {
    const tied = buildSearchIndex([node('b', 'ab'), node('a', 'ab'), node('c', 'abc')]);
    expect(searchNodes(tied, 'a').map((h) => h.id)).toEqual(['a', 'b', 'c']);
  });
});
