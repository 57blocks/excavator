import { describe, expect, it } from 'vitest';

import { flowIndexRows } from '../src/lib/flow-index';
import { parseHash } from '../src/lib/route';
import type { Feature, Status } from '../src/lib/types';

const NO_COUNTS = { diagrams: 0, evidence: 0, findings: { product: 0, technical: 0, priority: { P0: 0, P1: 0, P2: 0, unranked: 0 } }, verification: null };

function feature(id: string, chapter: number, over: Partial<Feature> = {}): Feature {
  return {
    id, name: `Feature ${id}`, kind: 'flow', chapter, status: 'verified' as Status, failure: null, attempts: 1, counts: NO_COUNTS,
    entrypoints: [], actors: [], permissionRoles: [], flows: [], triggers: [], body: `## Feature ${id}`, verificationReport: null,
    ...over,
  };
}

describe('flowIndexRows (design D4 and D10)', () => {
  it('has one row for a reference feature, numbered by its id and named by the feature', () => {
    const rows = flowIndexRows([feature('F3', 1, { kind: 'reference', name: 'Roles and permissions' })]);
    expect(rows).toEqual([{ number: 'F3', flow: 'Roles and permissions', feature: 'F3 Roles and permissions', featureId: 'F3', kind: 'reference', href: '#/feature/F3' }]);
  });

  it('has one row for each flow of the other features, numbered <id>.<n> from 1, repeated titles included', () => {
    const rows = flowIndexRows([feature('F2', 1, { kind: 'automated', flows: ['Cancel an order', 'Cancel an order', 'Refund'] })]);
    expect(rows.map((row) => [row.number, row.flow, row.kind])).toEqual([
      ['F2.1', 'Cancel an order', 'automated'], ['F2.2', 'Cancel an order', 'automated'], ['F2.3', 'Refund', 'automated'],
    ]);
    expect(rows.every((row) => row.feature === 'F2 Feature F2')).toBe(true);
  });

  it('ignores the flows a reference feature lists and the chapter of a feature without flows', () => {
    const rows = flowIndexRows([feature('F1', 1, { kind: 'reference', flows: ['Stray'] }), feature('F2', 2, { flows: [] })]);
    expect(rows.map((row) => row.number)).toEqual(['F1']);
  });

  it('follows the chapter order, not the order of the list or the ids', () => {
    const rows = flowIndexRows([
      feature('F10', 3, { flows: ['c'] }), feature('F2', 2, { flows: ['b'] }), feature('F9', 2, { flows: ['b2'] }), feature('F1', 1, { kind: 'reference' }),
    ]);
    expect(rows.map((row) => row.number)).toEqual(['F1', 'F2.1', 'F9.1', 'F10.1']);
  });

  it('leaves out features that are not written: failed and planned have no chapter', () => {
    const rows = flowIndexRows([
      feature('F1', 1, { flows: ['kept'] }),
      feature('F2', 2, { status: 'failed', body: null, flows: ['lost'] }),
      feature('F3', 3, { status: 'planned', body: null, flows: ['lost too'] }),
      feature('F4', 4, { kind: 'reference', status: 'failed', body: null }),
    ]);
    expect(rows.map((row) => row.number)).toEqual(['F1.1']);
  });

  it('has none for a run without a written flow', () => {
    expect(flowIndexRows([])).toEqual([]);
    expect(flowIndexRows([feature('F1', 1, { status: 'failed', body: null })])).toEqual([]);
  });

  it('links every row to the page of its feature, never to a heading anchor', () => {
    const rows = flowIndexRows([feature('F1', 1, { kind: 'reference' }), feature('F2', 2, { flows: ['a', 'a'] }), feature('F12', 3, { flows: ['b'] })]);
    expect(rows.map((row) => row.href)).toEqual(['#/feature/F1', '#/feature/F2', '#/feature/F2', '#/feature/F12']);
    for (const row of rows) {
      expect(row.href).not.toMatch(/^#[^/]/);
      expect(parseHash(row.href)).toEqual({ name: 'feature', id: row.featureId });
    }
  });
});
