import { describe, expect, it } from 'vitest';

import { byChapter, filterNav, groupFeatures, neighbours } from '../src/lib/nav';
import type { Feature } from '../src/lib/types';

const feature = (id: string, name: string, kind: string, chapter: number): Feature => ({
  id, name, kind, chapter, status: 'verified', failure: null, attempts: 1,
  counts: { diagrams: 0, evidence: 0, findings: { product: 0, technical: 0, priority: { P0: 0, P1: 0, P2: 0, unranked: 0 } }, verification: null },
  entrypoints: [], actors: [], permissionRoles: [], flows: [], triggers: [], body: null, verificationReport: null,
});

// Deliberately not in chapter order, with kinds in a scrambled order and two kinds the page does not know (zeta comes first in chapter order, alpha last).
const features = [
  feature('F6', 'Glossary', 'reference', 6),
  feature('F2', 'Order cancel', 'flow', 2),
  feature('F5', 'Nightly sweep', 'automated', 5),
  feature('F9', 'Zeta thing', 'zeta', 8),
  feature('F1', 'Order create', 'flow', 1),
  feature('F8', 'Alpha thing', 'alpha', 9),
  feature('F4', 'Order export', 'flow', 4),
  feature('F7', 'Reopen job', 'automated', 7),
];

describe('groupFeatures: the left rail', () => {
  it('orders the groups flow, automated, reference, then the other kinds by name', () => {
    expect(groupFeatures(features).map((group) => group.kind)).toEqual(['flow', 'automated', 'reference', 'alpha', 'zeta']);
  });

  it('labels the known kinds and keeps the other names as written', () => {
    expect(groupFeatures(features).map((group) => group.label)).toEqual(['Flows', 'Automated', 'Reference', 'alpha', 'zeta']);
  });

  it('lists each feature in exactly one group, in chapter order inside the group', () => {
    const groups = groupFeatures(features);
    expect(groups.map((group) => group.features.map((item) => item.id))).toEqual([['F1', 'F2', 'F4'], ['F5', 'F7'], ['F6'], ['F8'], ['F9']]);
    expect(groups.flatMap((group) => group.features.map((item) => item.id)).sort()).toEqual(features.map((item) => item.id).sort());
  });

  it('leaves out a kind with no feature and does not mutate its input', () => {
    const before = features.map((item) => item.id);
    expect(groupFeatures(features.filter((item) => item.kind === 'flow')).map((group) => group.kind)).toEqual(['flow']);
    expect(groupFeatures([])).toEqual([]);
    expect(features.map((item) => item.id)).toEqual(before);
  });
});

describe('filterNav', () => {
  it('keeps every feature for an empty or blank query', () => {
    expect(filterNav(features, '')).toHaveLength(features.length);
    expect(filterNav(features, '   ')).toHaveLength(features.length);
  });

  it('matches an id or a name, without case', () => {
    expect(filterNav(features, 'f2').map((item) => item.id)).toEqual(['F2']);
    expect(filterNav(features, 'ORDER').map((item) => item.id)).toEqual(['F2', 'F1', 'F4'].sort((a, b) => features.findIndex((x) => x.id === a) - features.findIndex((x) => x.id === b)));
    expect(filterNav(features, ' sweep ').map((item) => item.id)).toEqual(['F5']);
    expect(filterNav(features, 'nothing like it')).toEqual([]);
  });
});

describe('byChapter and neighbours', () => {
  it('sorts by chapter number without mutating', () => {
    expect(byChapter(features).map((item) => item.id)).toEqual(['F1', 'F2', 'F4', 'F5', 'F6', 'F7', 'F9', 'F8']);
    expect(features[0].id).toBe('F6');
  });

  it('gives the previous and next feature in chapter order, none at the ends', () => {
    expect(neighbours(features, 'F4')).toEqual({ previous: features.find((item) => item.id === 'F2'), next: features.find((item) => item.id === 'F5') });
    expect(neighbours(features, 'F1').previous).toBeNull();
    expect(neighbours(features, 'F8').next).toBeNull();
    expect(neighbours(features, 'nope')).toEqual({ previous: null, next: null });
  });
});
