import { describe, expect, it } from 'vitest';

import { evidenceLocation, filterFindings, shortRevision } from '../src/lib/filter';
import { NO_FILTERS } from '../src/lib/route';
import type { Finding } from '../src/lib/types';

const finding = (id: string, feature: string, cls: 'product' | 'technical', statement: string, passages: string[]): Finding => ({
  id, class: cls, statement, feature, flows: [feature], verdict: 'anchor-checked',
  evidence: passages.map((passage, at) => ({ file: `src/${id}.js`, passage, line: at + 1 })),
});

const findings = [
  finding('F1-1', 'F1', 'product', 'The form rejects a quantity below 1.', ['if (quantity < 1) {']),
  finding('F1-2', 'F1', 'technical', 'createOrder keeps the quantity as given.', ["return { status: 'open' };"]),
  finding('F2-1', 'F2', 'technical', 'cancelOrder cancels a cancelled order.', ["order.status = 'cancelled';"]),
  finding('F2-2', 'F2', 'product', 'A second cancel reports nothing.', ['function cancelOrder(order) {']),
];
const ids = (list: Finding[]) => list.map((item) => item.id);

describe('filterFindings', () => {
  it('keeps everything, in order, with no filter', () => {
    expect(ids(filterFindings(findings, NO_FILTERS))).toEqual(['F1-1', 'F1-2', 'F2-1', 'F2-2']);
  });

  it('filters by class and the count equals the findings of that class', () => {
    expect(ids(filterFindings(findings, { ...NO_FILTERS, class: 'product' }))).toEqual(['F1-1', 'F2-2']);
    expect(filterFindings(findings, { ...NO_FILTERS, class: 'technical' })).toHaveLength(findings.filter((f) => f.class === 'technical').length);
  });

  it('filters by the owning feature', () => {
    expect(ids(filterFindings(findings, { ...NO_FILTERS, feature: 'F2' }))).toEqual(['F2-1', 'F2-2']);
    expect(filterFindings(findings, { ...NO_FILTERS, feature: 'F9' })).toEqual([]);
  });

  it('searches statements and passages without case, and trims the text', () => {
    expect(ids(filterFindings(findings, { ...NO_FILTERS, q: '  QUANTITY ' }))).toEqual(['F1-1', 'F1-2']);
    // "status" is only in a passage, "reports" only in a statement
    expect(ids(filterFindings(findings, { ...NO_FILTERS, q: 'status' }))).toEqual(['F1-2', 'F2-1']);
    expect(ids(filterFindings(findings, { ...NO_FILTERS, q: 'reports' }))).toEqual(['F2-2']);
  });

  it('combines the three filters with and', () => {
    expect(ids(filterFindings(findings, { class: 'technical', feature: 'F2', q: 'cancelled' }))).toEqual(['F2-1']);
    expect(filterFindings(findings, { class: 'product', feature: 'F2', q: 'quantity' })).toEqual([]);
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
