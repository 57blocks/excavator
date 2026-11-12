// O1 of openspec change handbook-phase-gate: priority-items, remedy-facts,
// topic-lanes and outline-facts stop with exit 1 when the feature phase has
// started and a feature of the run is not written, and name the lanes to write.
import { afterEach, describe, expect, it } from 'vitest';

import { makeCheckedMapRun } from './helpers.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});

const COMMANDS = ['priority-items', 'remedy-facts', 'topic-lanes', 'outline-facts'];
const NEXT = 'Next: go back to Phase 4, write these lanes, then run this command again';

/** A checked-map run; `states` sets the state entries of features (and `findings` those of findings units). */
function runWith(features = {}, findings) {
  const run = makeCheckedMapRun();
  cleanups.push(run.cleanup);
  const state = run.readJson('state.json');
  for (const [id, entry] of Object.entries(features)) state.features[id] = { ...state.features[id], ...entry };
  if (findings !== undefined) state.findings = findings;
  run.writeJson(`${run.out}/state.json`, state);
  run.ids = Object.keys(state.features);
  return run;
}

for (const command of COMMANDS) {
  describe(`${command}: the gate`, () => {
    it('does not stop when the feature phase never started', () => {
      const run = runWith();
      const result = run.run(command);
      expect(result.stdout).not.toContain('Features not written');
      expect(result.status, result.stdout + result.stderr).toBe(0);
    });

    it('stops with the planned features and the Next line when some feature is written', () => {
      const run = runWith({ F1: { status: 'checked', attempts: 1 } });
      const result = run.run(command);
      expect(result.status).toBe(1);
      const planned = run.ids.filter((id) => id !== 'F1');
      expect(result.lines).toEqual([`Features not written: ${planned.join(' ')}`, NEXT]);
    });

    it('stops for a dispatched feature and for a failed one with one attempt, not for a failed one with two', () => {
      const others = (run) => Object.fromEntries(run.ids.slice(3).map((id) => [id, { status: 'checked', attempts: 1 }]));
      const base = runWith();
      const rest = others(base);
      const run = runWith({ F1: { status: 'dispatched', attempts: 1 }, F2: { status: 'failed', attempts: 1 }, F3: { status: 'failed', attempts: 2 }, ...rest });
      const result = run.run(command);
      expect(result.status).toBe(1);
      expect(result.lines[0]).toBe('Features not written: F1 F2');
      const done = runWith({ F1: { status: 'checked', attempts: 1 }, F2: { status: 'failed', attempts: 2 }, F3: { status: 'checked', attempts: 1 }, ...rest });
      expect(done.run(command).stdout).not.toContain('Features not written');
    });

    it('names an unwritten findings unit as <id>.findings once the findings phase started', () => {
      const base = runWith();
      const checked = Object.fromEntries(base.ids.map((id) => [id, { status: 'checked', attempts: 1 }]));
      const run = runWith(checked, { F2: { status: 'checked', attempts: 1 }, F1: { status: 'planned', attempts: 0 } });
      const result = run.run(command);
      expect(result.status).toBe(1);
      expect(result.lines[0]).toContain('F1.findings');
      expect(result.lines[0]).toContain('F3.findings');
      expect(result.lines[0]).not.toContain('F2.findings');
      expect(result.lines[1]).toBe(NEXT);
    });

    it('ignores findings units when none of them has an attempt', () => {
      const base = runWith();
      const checked = Object.fromEntries(base.ids.map((id) => [id, { status: 'checked', attempts: 1 }]));
      const run = runWith(checked);
      expect(run.run(command).stdout).not.toContain('Features not written');
    });

    it('looks only at the features of --features', () => {
      const run = runWith({ F1: { status: 'checked', attempts: 1 } });
      expect(run.run(command, '--features', 'F1').stdout).not.toContain('Features not written');
      const blocked = run.run(command, '--features', 'F1 F3');
      expect(blocked.status).toBe(1);
      expect(blocked.lines[0]).toBe('Features not written: F3');
    });

    it('exits 1 with a line for an unknown feature id', () => {
      const run = runWith({ F1: { status: 'checked', attempts: 1 } });
      const result = run.run(command, '--features', 'F1 F99');
      expect(result.status).toBe(1);
      expect(result.stdout).toContain('F99');
    });
  });
}
