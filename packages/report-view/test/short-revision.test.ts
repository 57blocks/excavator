import { describe, expect, it } from 'vitest';

import { shortRevision } from '../src/lib/format';

describe('shortRevision', () => {
  it('cuts a commit hash to its first eight digits and keeps the rest of the revision', () => {
    expect(shortRevision('multi-repo:1444d55919cac76bbcc0123456789abcdef01234')).toBe('multi-repo:1444d559');
    expect(shortRevision('git:1444d55919cac76bbcc0123456789abcdef01234')).toBe('git:1444d559');
  });

  it('leaves a revision with no long hash as it is', () => {
    expect(shortRevision('git:0')).toBe('git:0');
    expect(shortRevision('snapshot-2026-01')).toBe('snapshot-2026-01');
  });
});
