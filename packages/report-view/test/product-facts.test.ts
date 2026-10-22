import { describe, expect, it } from 'vitest';

import type { GraphNode } from '../src/data/graph';
import { nodeProductFacts, productsFor, type ProductSource } from '../src/lib/product-facts';

const file: GraphNode = { id: 'file:src/a.js', type: 'file', name: 'a.js', filePath: 'src/a.js' };
const fn: GraphNode = { id: 'function:src/a.js:run', type: 'function', name: 'run', filePath: 'src/a.js', lineRange: [1, 3] };

const product = (label: string, status: ProductSource['product']['status'], extra: Partial<ProductSource['product']> = {}): ProductSource['product'] => ({ label, status, command: `/excavator-${label}`, file: `${label}.json`, reason: null, revision: null, ...extra });
const notRun = (label: string): ProductSource => ({ product: product(label, 'not-run'), data: null });

const HOTSPOTS = { files: [{ path: 'src/a.js', commits: 9, authors: 2, score: 90 }, { path: 'src/zero.js', commits: 0, authors: 0, score: 0 }] };
const UNUSED = { unused: [{ id: fn.id, reason: 'unreferenced', confidence: 'high' }], testOnly: [{ id: 'function:src/a.js:spec', reason: 'unreferenced', confidence: 'low' }] };
const DOC_MAP = { units: [{ code: { evidence: [{ file: 'src/a.js', line: 4 }, { file: 'src/a.js', line: 9 }, { file: 'src/b.js', line: 1 }] } }, { code: { evidence: [{ file: 'src/a.js', line: 2 }] } }, { code: { evidence: [] } }] };

describe('productsFor', () => {
  it('has hotspots and doc-map speak about a file, unused-code about a function, and nothing about another node', () => {
    expect(productsFor(file)).toEqual(['hotspots', 'doc-map']);
    expect(productsFor(fn)).toEqual(['unused-code']);
    expect(productsFor({ type: 'class' })).toEqual([]);
  });
});

describe('a product that was not run', () => {
  it('says not run with the command that makes it, and shows no number for it', () => {
    const facts = nodeProductFacts(file, { hotspots: notRun('hotspots'), 'doc-map': notRun('doc-map') });
    expect(facts).toHaveLength(2);
    for (const fact of facts) {
      expect(fact.state).toBe('not-run');
      expect(fact).not.toHaveProperty('rows');
    }
    expect(facts[0]).toMatchObject({ name: 'hotspots', text: expect.stringMatching(/^Not run/), command: '/excavator-hotspots' });
    expect(JSON.stringify(facts)).not.toMatch(/\b0\b|none/i);
  });

  it('says not run for the unused-code product of a function', () => {
    expect(nodeProductFacts(fn, { 'unused-code': notRun('unused-code') })[0]).toMatchObject({ state: 'not-run', command: '/excavator-unused-code' });
  });

  it('says unreadable, with the reason, for a product that could not be read', () => {
    const source: ProductSource = { product: product('hotspots', 'unreadable', { reason: 'not JSON' }), data: null };
    expect(nodeProductFacts(file, { hotspots: source })[0]).toMatchObject({ state: 'unreadable', text: 'not JSON' });
  });
});

describe('a product that was run', () => {
  const hotspots: ProductSource = { product: product('hotspots', 'included'), data: HOTSPOTS };
  const docMap: ProductSource = { product: product('doc-map', 'included'), data: DOC_MAP };
  const unused: ProductSource = { product: product('unused-code', 'included'), data: UNUSED };
  const rows = (facts: ReturnType<typeof nodeProductFacts>, name: string) => {
    const fact = facts.find((f) => f.name === name);
    return fact?.state === 'facts' ? Object.fromEntries(fact.rows.map((r) => [r.label, r.value])) : null;
  };

  it("shows a file's commits, authors and score as the product states them", () => {
    expect(rows(nodeProductFacts(file, { hotspots }), 'hotspots')).toEqual({ Commits: '9', Authors: '2', Score: '90' });
  });

  it('shows a real zero as 0, and says in words that the product lists no history for a file it has no row for', () => {
    expect(rows(nodeProductFacts({ ...file, filePath: 'src/zero.js' }, { hotspots }), 'hotspots')).toEqual({ Commits: '0', Authors: '0', Score: '0' });
    expect(rows(nodeProductFacts({ ...file, filePath: 'src/other.js' }, { hotspots }), 'hotspots')).toEqual({ History: 'The product lists no history for this file.' });
  });

  it("counts the doc-map evidence passages that name the file, and the units they are in; a file with none has 0 of each", () => {
    expect(rows(nodeProductFacts(file, { 'doc-map': docMap }), 'doc-map')).toEqual({ Evidence: '3 passages in 2 units' });
    expect(rows(nodeProductFacts({ ...file, filePath: 'src/c.js' }, { 'doc-map': docMap }), 'doc-map')).toEqual({ Evidence: '0 passages in 0 units' });
  });

  it("shows a function's unused state, reason and confidence, and says when it is not listed", () => {
    expect(rows(nodeProductFacts(fn, { 'unused-code': unused }), 'unused-code')).toEqual({ State: 'Listed as unused', Reason: 'unreferenced', Confidence: 'high' });
    expect(rows(nodeProductFacts({ ...fn, id: 'function:src/a.js:spec' }, { 'unused-code': unused }), 'unused-code')).toMatchObject({ State: 'Listed as test only', Confidence: 'low' });
    expect(rows(nodeProductFacts({ ...fn, id: 'function:src/a.js:other' }, { 'unused-code': unused }), 'unused-code')).toEqual({ State: 'Not in the unused list' });
  });

  it('says a field the product lacks is not provided, and does not make it a number', () => {
    const partial: ProductSource = { product: product('hotspots', 'included'), data: { files: [{ path: 'src/a.js', commits: 4 }] } };
    expect(rows(nodeProductFacts(file, { hotspots: partial }), 'hotspots')).toEqual({ Commits: '4', Authors: 'not provided by the product', Score: 'not provided by the product' });
  });

  it('notes a product made at another revision', () => {
    const other: ProductSource = { product: product('hotspots', 'different-revision', { revision: 'git:abc' }), data: HOTSPOTS };
    const fact = nodeProductFacts(file, { hotspots: other })[0];
    expect(fact).toMatchObject({ state: 'facts', note: 'Made at git:abc, not at the source snapshot.' });
  });
});
