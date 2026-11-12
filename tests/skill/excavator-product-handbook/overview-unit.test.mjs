// O1 (unit) of openspec change handbook-system-overview: mark runs on the unit id `overview`; the state is kept
// under `state.overview`, and a state file without that key is read as planned.
import { afterEach, describe, expect, it } from 'vitest';
import { checkedOverviewRun, overviewRun } from './overview-fixture.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const stateOf = (run) => run.readJson('state.json');

describe('state: the overview key is optional', () => {
  it('a state file without the key is read: mark counts attempt 1 from planned, load-run works', () => {
    const run = overviewRun(cleanups);
    expect(Object.hasOwn(stateOf(run), 'overview')).toBe(false);
    expect(run.run('mark', 'overview', 'dispatched').lines).toEqual(['overview: dispatched, attempts 1']);
    expect(stateOf(run).overview).toEqual({ status: 'dispatched', attempts: 1 });
    expect(Object.keys(stateOf(run).features)).toHaveLength(5);
  });

});
