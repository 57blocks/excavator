// The self-check of `aggregate` (openspec change prd-report-finding-priority,
// design D5): the four level counts of every feature and of all features must
// add up to the findings, else aggregate fails and names the feature. The
// counting function is replaced by a double that is off by one on demand, to
// prove the check is what fails the run.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { aggregate } from '../../../skills/excavator-prd-report/lib/aggregate.mjs';
import { makeLaneRun, rankEntry, writeLaneFindings, writeRanks } from './helpers.mjs';

const broken = vi.hoisted(() => ({ feature: null, by: 0 }));
vi.mock('../../../skills/excavator-prd-report/lib/priorities.mjs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    // Off by `by` in the P0 count of the findings of `feature` only.
    priorityCounts: (findings, ranks) => {
      const counts = actual.priorityCounts(findings, ranks);
      return findings[0]?.id.startsWith(`${broken.feature}-`) ? { ...counts, P0: counts.P0 + broken.by } : counts;
    },
  };
});

const cleanups = [];
afterEach(() => {
  broken.feature = null;
  broken.by = 0;
  while (cleanups.length > 0) cleanups.pop()();
});

function rankedRun() {
  const run = makeLaneRun();
  cleanups.push(run.cleanup);
  writeLaneFindings(run, 'F1', 2);
  writeLaneFindings(run, 'F2', 2);
  writeRanks(run, 'F1', [rankEntry('F1-1', 'P0'), rankEntry('F1-2', 'P1')]);
  writeRanks(run, 'F2', [rankEntry('F2-1', 'P2'), rankEntry('F2-2', 'P1')]);
  return run;
}

describe('aggregate: the level counts must add up to the findings', () => {
  it('passes while the counts are right (the control for the double)', () => {
    const run = rankedRun();
    const outcome = aggregate(run.out, run.project);
    expect(outcome.status).toBe(0);
    expect(outcome.result.findings.priority).toEqual({ P0: 1, P1: 2, P2: 1, unranked: 0 });
  });

  it.each([1, -1])('fails with a line naming the feature when its counts are off by %i, and writes no findings.json', (by) => {
    const run = rankedRun();
    broken.feature = 'F2';
    broken.by = by;
    const outcome = aggregate(run.out, run.project);
    expect(outcome.status).toBe(1);
    expect(outcome.lines).toContain(`F2: the priority counts add up to ${2 + by}, not 2 findings`);
    expect(outcome.lines.some((line) => line.startsWith('F1:'))).toBe(false);
    expect(outcome.lines).toContain(`index: the priority counts add up to ${4 + by}, not 4 findings`);
    expect(existsSync(join(run.out, 'findings.json'))).toBe(false);
  });
});
