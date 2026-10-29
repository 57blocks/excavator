import { describe, expect, it } from 'vitest';

import { LEVELS, featureMatrix, groupByLevel, hasUnranked } from '../src/lib/matrix';
import type { Feature, Finding } from '../src/lib/types';

const feature = (id: string, chapter: number): Feature => ({
  id, name: `Feature ${id}`, kind: 'flow', chapter, status: 'verified', failure: null, attempts: 1,
  counts: { diagrams: 0, evidence: 0, findings: { product: 0, technical: 0, priority: { P0: 0, P1: 0, P2: 0, unranked: 0 } }, verification: null },
  entrypoints: [], actors: [], permissionRoles: [], flows: [], triggers: [], body: null, verificationReport: null,
});
const finding = (id: string, featureId: string, priority: Finding['priority']): Finding => ({
  id, class: 'product', statement: id, feature: featureId, flows: [], evidence: [], verdict: 'anchor-checked', priority, priorityReason: null,
});

const features = [feature('F1', 1), feature('F2', 2), feature('F3', 3)];
const findings = [
  finding('F2-1', 'F2', 'P0'), finding('F1-1', 'F1', 'P0'), finding('F2-2', 'F2', 'P0'),
  finding('F1-2', 'F1', 'P1'), finding('F2-3', 'F2', 'P2'), finding('F1-3', 'F1', null),
];

describe('featureMatrix', () => {
  const rows = featureMatrix(features, findings);

  it('has one row per feature, in the order given, with the four levels in order', () => {
    expect(rows.map((row) => row.feature.id)).toEqual(['F1', 'F2', 'F3']);
    expect(LEVELS).toEqual(['P0', 'P1', 'P2', 'unranked']);
    for (const row of rows) expect(row.cells.map((cell) => cell.level)).toEqual(['P0', 'P1', 'P2', 'unranked']);
  });

  it('counts each feature\'s findings per level; the cells of a row sum to its finding count', () => {
    expect(rows.map((row) => row.cells.map((cell) => cell.count))).toEqual([[1, 1, 0, 1], [2, 0, 1, 0], [0, 0, 0, 0]]);
    for (const row of rows) {
      expect(row.cells.reduce((sum, cell) => sum + cell.count, 0)).toBe(row.total);
      expect(row.total).toBe(findings.filter((item) => item.feature === row.feature.id).length);
    }
  });

  it('sums over all rows to the number of findings', () => {
    expect(rows.reduce((sum, row) => sum + row.total, 0)).toBe(findings.length);
  });

  it('links a non-zero cell to the findings page filtered by that feature and level, and a zero cell to nothing', () => {
    const f2 = rows[1];
    expect(f2.cells[0].href).toBe('#/findings?priority=P0&feature=F2');
    expect(f2.cells[1].href).toBeNull();
    expect(rows[0].cells[3].href).toBe('#/findings?priority=unranked&feature=F1');
    expect(rows[2].cells.every((cell) => cell.href === null)).toBe(true);
  });

  it('knows whether any finding is unranked', () => {
    expect(hasUnranked(rows)).toBe(true);
    expect(hasUnranked(featureMatrix(features, findings.filter((item) => item.priority !== null)))).toBe(false);
  });
});

describe('groupByLevel', () => {
  it('starts a group at every change of level, in the order given, and every finding is in exactly one group', () => {
    const ordered = [finding('a', 'F1', 'P0'), finding('b', 'F1', 'P0'), finding('c', 'F1', 'P1'), finding('d', 'F1', 'P2'), finding('e', 'F1', null), finding('f', 'F1', null)];
    const groups = groupByLevel(ordered);
    expect(groups.map((group) => [group.level, group.findings.map((item) => item.id)])).toEqual([
      ['P0', ['a', 'b']], ['P1', ['c']], ['P2', ['d']], ['unranked', ['e', 'f']],
    ]);
    expect(groups.map((group) => group.label)).toEqual(['P0', 'P1', 'P2', 'Unranked']);
    expect(groups.reduce((sum, group) => sum + group.findings.length, 0)).toBe(ordered.length);
  });

  it('opens a new group when a level comes back, so the order of the list is never rearranged', () => {
    const groups = groupByLevel([finding('a', 'F1', 'P1'), finding('b', 'F1', 'P0'), finding('c', 'F1', 'P1')]);
    expect(groups.map((group) => group.level)).toEqual(['P1', 'P0', 'P1']);
  });

  it('gives no group for an empty list', () => {
    expect(groupByLevel([])).toEqual([]);
  });
});
