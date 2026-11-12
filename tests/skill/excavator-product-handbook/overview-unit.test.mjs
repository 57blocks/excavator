// O1 (unit) of openspec change handbook-system-overview: mark runs on the unit id `overview`; the state is kept
// under `state.overview`, and a state file without that key is read as planned.
import { afterEach, describe, expect, it } from 'vitest';
import { clone } from './helpers.mjs';
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

  it('check-map still compares only the features with the map: an overview key does not change that', () => {
    const run = checkedOverviewRun(cleanups);
    const map = clone(run.map);
    map.features = map.features.slice(0, 4);
    map.unassigned = [...map.unassigned, ...run.map.features[4].candidates.map((candidate) => ({ candidate, reason: 'No reader uses it.' }))];
    run.writeMap(map);
    const result = run.run('check-map');
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/state\.json lists the features F1, F2, F3, F4, F5 but map\.json has F1, F2, F3, F4/);
  });

});
