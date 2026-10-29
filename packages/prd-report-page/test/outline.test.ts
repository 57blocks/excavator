import { describe, expect, it } from 'vitest';

import { headingId, isHeadingId } from '../src/lib/outline';

describe('headingId', () => {
  it('is the prefix and the source line, so it does not depend on the heading text', () => {
    expect(headingId('F3', 42)).toBe('F3-L42');
    expect(headingId('F3-verification', 7)).toBe('F3-verification-L7');
  });

  it('gives two headings with the same text different ids when their lines differ', () => {
    expect(headingId('overview', 3)).not.toBe(headingId('overview', 9));
  });

  it('is told apart from other ids by isHeadingId', () => {
    expect(isHeadingId('F3-L42')).toBe(true);
    expect(isHeadingId('finding-F3-1')).toBe(false);
    expect(isHeadingId('')).toBe(false);
  });
});
