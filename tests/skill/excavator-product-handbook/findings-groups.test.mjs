// O1 (grouping) of openspec change handbook-system-findings, design D7: two
// findings are in one group when their category is the same and a passage of
// each is in the same file with overlapping line ranges; grouping is
// transitive; the groups and the findings in them keep the order of the input
// (features in map order, then the system units, then the order inside a unit).
import { describe, expect, it } from 'vitest';

import { groupFindings, rangesOverlap } from '../../../skills/excavator-product-handbook/lib/findings-groups.mjs';

const cite = (file, startLine, endLine = startLine) => ({ file, startLine, endLine });
const row = (id, category, ...citations) => ({ id, category, citations });
const ids = (groups) => groups.map((group) => group.map((one) => one.id));

describe('rangesOverlap', () => {
  it('is true for ranges that share a line, ends included, and false for ranges that only touch', () => {
    expect(rangesOverlap(cite('a', 5, 9), cite('a', 9, 12))).toBe(true);
    expect(rangesOverlap(cite('a', 5, 9), cite('a', 6, 7))).toBe(true);
    expect(rangesOverlap(cite('a', 5, 5), cite('a', 5, 5))).toBe(true);
    expect(rangesOverlap(cite('a', 5, 9), cite('a', 10, 12))).toBe(false);
    expect(rangesOverlap(cite('a', 10, 12), cite('a', 5, 9))).toBe(false);
  });

  it('is false for another file, however the lines lie, and for a passage that could not be located', () => {
    expect(rangesOverlap(cite('a', 5, 9), cite('b', 5, 9))).toBe(false);
    expect(rangesOverlap(cite('a', null, null), cite('a', 5, 9))).toBe(false);
    expect(rangesOverlap(cite('a', null, null), cite('a', null, null))).toBe(false);
  });
});

describe('groupFindings', () => {
  it('puts two findings of the same category with overlapping passages in the same file in one group', () => {
    const groups = groupFindings([row('F1.findings[0]', 'display', cite('x.js', 270, 280)), row('F8.findings[0]', 'display', cite('x.js', 276, 276))]);
    expect(ids(groups)).toEqual([['F1.findings[0]', 'F8.findings[0]']]);
  });

  it('does not group findings of different categories, whatever their passages', () => {
    const groups = groupFindings([row('F1.findings[0]', 'display', cite('x.js', 276)), row('F8.findings[0]', 'time', cite('x.js', 276))]);
    expect(ids(groups)).toEqual([['F1.findings[0]'], ['F8.findings[0]']]);
  });

  it('does not group findings in the same file whose line ranges do not overlap, nor ones in different files at the same lines', () => {
    expect(ids(groupFindings([row('a', 'display', cite('x.js', 10, 20)), row('b', 'display', cite('x.js', 21, 30))]))).toEqual([['a'], ['b']]);
    expect(ids(groupFindings([row('a', 'display', cite('x.js', 10, 20)), row('b', 'display', cite('y.js', 10, 20))]))).toEqual([['a'], ['b']]);
  });

  it('is transitive: a overlaps b, b overlaps c, a does not overlap c, and the three are one group', () => {
    const groups = groupFindings([
      row('a', 'security', cite('x.js', 10, 20)),
      row('b', 'security', cite('x.js', 20, 30), cite('y.js', 1, 3)),
      row('c', 'security', cite('y.js', 3, 5)),
    ]);
    expect(rangesOverlap(cite('x.js', 10, 20), cite('y.js', 3, 5))).toBe(false);
    expect(ids(groups)).toEqual([['a', 'b', 'c']]);
  });

  it('is transitive whatever the order of the input: the member that joins the two others comes last', () => {
    const groups = groupFindings([row('a', 'other', cite('x.js', 1, 2)), row('c', 'other', cite('x.js', 5, 6)), row('b', 'other', cite('x.js', 2, 5))]);
    expect(ids(groups)).toEqual([['a', 'c', 'b']]);
  });

  it('a finding with several passages is joined by any one of them', () => {
    const groups = groupFindings([row('a', 'contract', cite('x.js', 1, 2), cite('y.js', 40, 41)), row('b', 'contract', cite('z.js', 9), cite('y.js', 41, 44))]);
    expect(ids(groups)).toEqual([['a', 'b']]);
  });

  it('a group across a feature unit and a system unit: the order of the input is kept, the first is the representative', () => {
    const groups = groupFindings([
      row('F1.findings[0]', 'notification', cite('mail.js', 10, 12)),
      row('F2.findings[0]', 'time', cite('job.js', 4)),
      row('app1.system[0]', 'notification', cite('mail.js', 12, 14)),
      row('app1.system[1]', 'time', cite('cal.js', 7)),
    ]);
    expect(ids(groups)).toEqual([['F1.findings[0]', 'app1.system[0]'], ['F2.findings[0]'], ['app1.system[1]']]);
  });

  it('orders the groups by their first member, so a later finding that joins an earlier group does not move it', () => {
    const groups = groupFindings([row('a', 'other', cite('x.js', 1)), row('b', 'other', cite('y.js', 1)), row('c', 'other', cite('x.js', 1))]);
    expect(ids(groups)).toEqual([['a', 'c'], ['b']]);
  });

  it('keeps a finding whose passages could not be located in a group of its own, and returns the rows themselves', () => {
    const lost = row('lost', 'display', cite('x.js', null, null));
    const groups = groupFindings([lost, row('b', 'display', cite('x.js', 1, 9))]);
    expect(ids(groups)).toEqual([['lost'], ['b']]);
    expect(groups[0][0]).toBe(lost);
  });

  it('returns no group for no finding, and is the same from the same input', () => {
    expect(groupFindings([])).toEqual([]);
    const rows = [row('a', 'other', cite('x.js', 1)), row('b', 'other', cite('x.js', 1))];
    expect(groupFindings(rows)).toEqual(groupFindings(rows));
  });
});
