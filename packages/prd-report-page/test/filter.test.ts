import { describe, expect, it } from 'vitest';

import { evidenceLocation, facetCounts, filterFindings, shortRevision } from '../src/lib/filter';
import { NO_FILTERS } from '../src/lib/route';
import type { Finding } from '../src/lib/types';

const finding = (
  id: string, feature: string, cls: 'product' | 'technical', statement: string, passages: string[],
  priority: Finding['priority'] = null,
): Finding => ({
  id, class: cls, statement, feature, flows: [feature], verdict: 'anchor-checked',
  priority, priorityReason: priority === null ? null : `Reason for ${id}.`,
  evidence: passages.map((passage, at) => ({ file: `src/${id}.js`, passage, line: at + 1 })),
});

const findings = [
  finding('F2-1', 'F2', 'technical', 'cancelOrder cancels a cancelled order.', ["order.status = 'cancelled';"], 'P0'),
  finding('F1-1', 'F1', 'product', 'The form rejects a quantity below 1.', ['if (quantity < 1) {'], 'P1'),
  finding('F1-2', 'F1', 'technical', 'createOrder keeps the quantity as given.', ["return { status: 'open' };"], 'P1'),
  finding('F2-2', 'F2', 'product', 'A second cancel reports nothing.', ['function cancelOrder(order) {'], 'P2'),
  finding('F3-1', 'F3', 'product', 'The export names no file.', ['export default {};']),
];
const ids = (list: Finding[]) => list.map((item) => item.id);

describe('filterFindings', () => {
  it('keeps everything, in order, with no filter', () => {
    expect(ids(filterFindings(findings, NO_FILTERS))).toEqual(['F2-1', 'F1-1', 'F1-2', 'F2-2', 'F3-1']);
  });

  it('filters by class and the count equals the findings of that class', () => {
    expect(ids(filterFindings(findings, { ...NO_FILTERS, class: 'product' }))).toEqual(['F1-1', 'F2-2', 'F3-1']);
    expect(filterFindings(findings, { ...NO_FILTERS, class: 'technical' })).toHaveLength(findings.filter((f) => f.class === 'technical').length);
  });

  it('filters by the owning feature', () => {
    expect(ids(filterFindings(findings, { ...NO_FILTERS, feature: 'F2' }))).toEqual(['F2-1', 'F2-2']);
    expect(filterFindings(findings, { ...NO_FILTERS, feature: 'F9' })).toEqual([]);
  });

  it('searches statements and passages without case, and trims the text', () => {
    expect(ids(filterFindings(findings, { ...NO_FILTERS, q: '  QUANTITY ' }))).toEqual(['F1-1', 'F1-2']);
    // "status" is only in a passage, "reports" only in a statement
    expect(ids(filterFindings(findings, { ...NO_FILTERS, q: 'status' }))).toEqual(['F2-1', 'F1-2']);
    expect(ids(filterFindings(findings, { ...NO_FILTERS, q: 'reports' }))).toEqual(['F2-2']);
  });

  it('filters by level and the count equals the findings of that level', () => {
    expect(ids(filterFindings(findings, { ...NO_FILTERS, priority: 'P0' }))).toEqual(['F2-1']);
    expect(ids(filterFindings(findings, { ...NO_FILTERS, priority: 'P1' }))).toEqual(['F1-1', 'F1-2']);
    expect(ids(filterFindings(findings, { ...NO_FILTERS, priority: 'P2' }))).toEqual(['F2-2']);
    for (const level of ['P0', 'P1', 'P2'] as const) {
      expect(filterFindings(findings, { ...NO_FILTERS, priority: level })).toHaveLength(findings.filter((f) => f.priority === level).length);
    }
  });

  it('treats unranked as a null priority and keeps a ranked finding out of it', () => {
    expect(ids(filterFindings(findings, { ...NO_FILTERS, priority: 'unranked' }))).toEqual(['F3-1']);
    expect(filterFindings(findings, { ...NO_FILTERS, priority: 'unranked' }).every((f) => f.priority === null)).toBe(true);
  });

  it('combines the filters with and', () => {
    expect(ids(filterFindings(findings, { ...NO_FILTERS, class: 'technical', feature: 'F2', q: 'cancelled' }))).toEqual(['F2-1']);
    expect(filterFindings(findings, { ...NO_FILTERS, class: 'product', feature: 'F2', q: 'quantity' })).toEqual([]);
    expect(ids(filterFindings(findings, { ...NO_FILTERS, priority: 'P1', class: 'technical' }))).toEqual(['F1-2']);
    expect(ids(filterFindings(findings, { ...NO_FILTERS, priority: 'P2', feature: 'F2' }))).toEqual(['F2-2']);
    expect(filterFindings(findings, { ...NO_FILTERS, priority: 'P0', feature: 'F1' })).toEqual([]);
    expect(ids(filterFindings(findings, { ...NO_FILTERS, priority: 'P1', q: 'QUANTITY' }))).toEqual(['F1-1', 'F1-2']);
    expect(filterFindings(findings, { ...NO_FILTERS, priority: 'unranked', class: 'technical' })).toEqual([]);
  });

  it('does not treat the search text as a pattern', () => {
    expect(ids(filterFindings(findings, { ...NO_FILTERS, q: '.*' }))).toEqual([]);
    expect(ids(filterFindings(findings, { ...NO_FILTERS, q: '(quantity|cancel)' }))).toEqual([]);
    expect(ids(filterFindings(findings, { ...NO_FILTERS, q: 'quantity < 1' }))).toEqual(['F1-1']);
  });
});

describe('evidenceLocation and shortRevision', () => {
  it('writes file:line, or the file alone when there is no line', () => {
    expect(evidenceLocation({ file: 'src/a.js', line: 12 })).toBe('src/a.js:12');
    expect(evidenceLocation({ file: 'src/a.js' })).toBe('src/a.js');
  });

  it('cuts a git hash to 8 characters and leaves other revisions alone', () => {
    expect(shortRevision('0123456789abcdef0123456789abcdef01234567')).toBe('01234567');
    expect(shortRevision('directory:synthetic')).toBe('directory:synthetic');
    expect(shortRevision('x'.repeat(40))).toBe(`${'x'.repeat(27)}...`);
  });
});

describe('facetCounts: the number on each segment under the other filters', () => {
  it('counts a class under the level, feature and text filters but not under the class filter itself', () => {
    const counts = facetCounts(findings, { ...NO_FILTERS, class: 'technical', priority: 'P1' });
    expect(counts.class).toEqual({ all: 2, product: 1, technical: 1 });
  });

  it('counts a level under the class, feature and text filters but not under the level filter itself', () => {
    const counts = facetCounts(findings, { ...NO_FILTERS, class: 'product', priority: 'P0' });
    expect(counts.priority).toEqual({ all: 3, P0: 0, P1: 1, P2: 1, unranked: 1 });
    expect(facetCounts(findings, NO_FILTERS).priority).toEqual({ all: 5, P0: 1, P1: 2, P2: 1, unranked: 1 });
  });

  it('applies the feature and the text filter to both', () => {
    const counts = facetCounts(findings, { ...NO_FILTERS, feature: 'F2', q: 'cancel' });
    expect(counts.class).toEqual({ all: 2, product: 1, technical: 1 });
    expect(counts.priority).toEqual({ all: 2, P0: 1, P1: 0, P2: 1, unranked: 0 });
  });
});
