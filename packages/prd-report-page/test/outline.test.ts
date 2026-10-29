import { describe, expect, it } from 'vitest';

import { activeIndex, headingId, isHeadingId } from '../src/lib/outline';

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

describe('activeIndex', () => {
  const line = 80;

  it('is the first entry when every top is below the reading line', () => {
    expect(activeIndex([300, 500, 900], line)).toBe(0);
  });

  it('is the last entry whose top is at or above the reading line', () => {
    expect(activeIndex([-400, -20, 60, 300, 500], line)).toBe(2);
    expect(activeIndex([-400, -20, 60], line)).toBe(2);
  });

  it('counts a top exactly 2px below the line as reached, and 3px as not', () => {
    expect(activeIndex([-10, line + 2, 400], line)).toBe(1);
    expect(activeIndex([-10, line + 3, 400], line)).toBe(0);
  });

  it('stops at the first entry below the line even when a later top is above it', () => {
    expect(activeIndex([10, 300, 20], line)).toBe(0);
  });

  it('is -1 for an empty list', () => {
    expect(activeIndex([], line)).toBe(-1);
  });
});
