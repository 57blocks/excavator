import { describe, expect, it } from 'vitest';

import { JUMP_LIMIT, matchJump } from '../src/lib/jump';
import type { JumpItem } from '../src/lib/jump';
import type { Feature, Finding } from '../src/lib/types';

const feature = (id: string, name: string, chapter: number): Feature => ({
  id, name, kind: 'flow', chapter, status: 'verified', failure: null, attempts: 1,
  counts: { diagrams: 0, evidence: 0, findings: { product: 0, technical: 0, priority: { P0: 0, P1: 0, P2: 0, unranked: 0 } }, verification: null },
  entrypoints: [], actors: [], permissionRoles: [], flows: [], triggers: [], body: null, verificationReport: null,
});
const finding = (id: string, featureId: string, statement: string): Finding => ({
  id, class: 'product', statement, feature: featureId, flows: [], evidence: [], verdict: 'anchor-checked', priority: null, priorityReason: null,
});
const label = (item: JumpItem) => (item.type === 'feature' ? `feature ${item.feature.id}` : `finding ${item.finding.id}`);

const features = [
  feature('F1', 'Order create', 1), feature('F10', 'Report export', 2), feature('F11', 'Cancel F1 orders', 3), feature('F2', 'Order cancel', 4),
];
const findings = [
  finding('F1-1', 'F1', 'The form rejects a quantity below 1.'),
  finding('F2-1', 'F2', 'cancelOrder cancels a cancelled order.'),
  finding('F10-1', 'F10', 'The export names no file.'),
  finding('F1-2', 'F1', 'createOrder keeps the quantity as given.'),
];

describe('matchJump', () => {
  it('puts an id that equals the query first, then id prefixes, then name or statement containing it', () => {
    const { items } = matchJump(features, findings, 'f1');
    expect(items.map(label)).toEqual([
      'feature F1', // exact id
      'feature F10', 'feature F11', 'finding F1-1', 'finding F10-1', 'finding F1-2', // id prefix: features first, then findings, each in input order
    ]);
  });

  it('matches case-insensitively and ranks a name or statement substring last', () => {
    const { items } = matchJump(features, findings, 'CANCEL');
    expect(items.map(label)).toEqual(['feature F11', 'feature F2', 'finding F2-1']);
    expect(matchJump(features, findings, 'quantity').items.map(label)).toEqual(['finding F1-1', 'finding F1-2']);
  });

  it('puts an exact finding id above a feature that only contains the text', () => {
    const { items } = matchJump(features, findings, 'f1-2');
    expect(items.map(label)).toEqual(['finding F1-2']);
    const withNameHit = [...features, feature('F9', 'About f1-2', 9)];
    expect(matchJump(withNameHit, findings, 'f1-2').items.map(label)).toEqual(['finding F1-2', 'feature F9']);
  });

  it('lists features before findings inside one rank', () => {
    const { items } = matchJump([feature('F1', 'x', 1)], [finding('F1-1', 'F1', 'x')], 'x');
    expect(items.map(label)).toEqual(['feature F1', 'finding F1-1']);
  });

  it('caps the list at 50 and reports the total number of matches', () => {
    const many = Array.from({ length: 80 }, (_, at) => finding(`F1-${at + 1}`, 'F1', 'same words'));
    const result = matchJump(features, many, 'same');
    expect(JUMP_LIMIT).toBe(50);
    expect(result.items).toHaveLength(50);
    expect(result.total).toBe(80);
    expect(matchJump(features, findings, 'f1').total).toBe(6);
  });

  it('gives the features in chapter order, and no findings, for an empty query', () => {
    const result = matchJump([...features].reverse(), findings, '  ');
    expect(result.items.map(label)).toEqual(['feature F1', 'feature F10', 'feature F11', 'feature F2']);
    expect(result.total).toBe(4);
  });

  it('gives nothing for a query that matches nothing', () => {
    expect(matchJump(features, findings, 'zzz')).toEqual({ items: [], total: 0 });
  });
});
