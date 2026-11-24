import { describe, expect, it } from 'vitest';

import { joinChecks, type DocMapCheck } from '../docmap';

// The pure parts of the report view's doc map test; the unit detail test renders the retired view page and is not copied.
const evidence = (file: string, line: number, code = 'code') => ({ file, line, code });
const unit = (over: Record<string, unknown> = {}) => ({
  document: 'a.md', id: 'A', title: 'Submit', quote: 'the quote', line: 10, page: null,
  code: { status: 'found', evidence: [evidence('x.go', 5), evidence('y.go', 7)], searched: [] }, ...over,
});

describe('joinChecks', () => {
  const units = [
    unit(),
    unit({ id: 'B', code: { status: 'found', evidence: [evidence('x.go', 5)], searched: [] } }),
    unit({ id: 'C', code: { status: 'not-found', evidence: [], searched: [{ pattern: 'leave', paths: ['src'] }] } }),
    unit({ id: 'D', code: null }),
  ];
  const checks: DocMapCheck[] = [
    { unit: 1, file: 'x.go', line: 5, verdict: 'does', reason: 'creates it' },
    { unit: 1, file: 'y.go', line: 7, verdict: 'not', reason: 'a test' },
    { unit: 2, file: 'x.go', line: 5, verdict: 'none', reason: null },
  ];

  it('gives each piece of evidence the check with the same unit, file and line', () => {
    const { rows, hasChecks, unmatched, duplicates } = joinChecks(units, checks);
    expect(hasChecks).toBe(true);
    expect(unmatched).toBe(0);
    expect(duplicates).toBe(0);
    expect(rows[0].evidence.map((e) => e.check)).toEqual([{ verdict: 'does', reason: 'creates it' }, { verdict: 'not', reason: 'a test' }]);
    expect(rows[1].evidence[0].check).toEqual({ verdict: 'none', reason: null });
  });

  it('keeps a check on the unit it names, not on another unit that cites the same place', () => {
    const { rows } = joinChecks(units, [{ unit: 2, file: 'x.go', line: 5, verdict: 'not', reason: 'r' }]);
    expect(rows[0].evidence[0].check).toBeNull();
    expect(rows[1].evidence[0].check?.verdict).toBe('not');
  });

  it('summarises the verdicts of a unit', () => {
    const { rows } = joinChecks(units, checks);
    expect(rows.map((r) => r.verdictText)).toEqual(['does 1 / not 1 / none 0', 'does 0 / not 0 / none 1', null, null]);
    expect(rows[0].verdicts).toEqual({ does: 1, not: 1, none: 0, unchecked: 0, other: 0 });
  });

  it('says not checked for evidence that has no check, and counts it beside the others when only some have one', () => {
    const { rows } = joinChecks(units, [checks[0]]);
    expect(rows[0].verdictText).toBe('does 1 / not 0 / none 0 / not checked 1');
    expect(rows[1].verdictText).toBe('not checked');
  });

  it('shows every unit with evidence as not checked when there are no checks at all', () => {
    const { rows, hasChecks } = joinChecks(units, null);
    expect(hasChecks).toBe(false);
    expect(rows.map((r) => r.verdictText)).toEqual(['not checked', 'not checked', null, null]);
    expect(rows.flatMap((r) => r.evidence).every((e) => e.check === null)).toBe(true);
  });

  it('counts a check that names no evidence, and a repeated check', () => {
    const { unmatched, duplicates, rows } = joinChecks(units, [...checks, { unit: 9, file: 'z.go', line: 1, verdict: 'does', reason: 'r' }, { ...checks[0], verdict: 'not' }]);
    expect(unmatched).toBe(1);
    expect(duplicates).toBe(1);
    expect(rows[0].evidence[0].check?.verdict).toBe('does');
  });

  it('keeps a verdict it does not know apart from the three it does', () => {
    const { rows } = joinChecks(units, [{ unit: 2, file: 'x.go', line: 5, verdict: 'maybe', reason: 'r' }]);
    expect(rows[1].verdictText).toBe('does 0 / not 0 / none 0 / other 1');
  });

  it('numbers units from 1 and treats a unit without code as not checked', () => {
    const { rows } = joinChecks(units, checks);
    expect(rows.map((r) => r.number)).toEqual([1, 2, 3, 4]);
    expect(rows.map((r) => r.codeStatus)).toEqual(['found', 'found', 'not-found', 'not-checked']);
    expect(rows[3].evidence).toEqual([]);
  });

  it('does not join a line that differs, or a file that differs only by case', () => {
    const { rows, unmatched } = joinChecks([unit()], [{ unit: 1, file: 'X.go', line: 5, verdict: 'does', reason: 'r' }, { unit: 1, file: 'x.go', line: 6, verdict: 'does', reason: 'r' }]);
    expect(rows[0].verdictText).toBe('not checked');
    expect(unmatched).toBe(2);
  });

  it('copes with a unit that is missing fields', () => {
    const { rows } = joinChecks([{}], []);
    expect(rows[0]).toMatchObject({ document: null, id: null, title: null, quote: null, line: null, page: null, codeStatus: 'not-checked' });
  });
});

