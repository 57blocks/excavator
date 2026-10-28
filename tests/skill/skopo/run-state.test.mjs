/**
 * The output directory's state decides whether a skopo skill starts, resumes or stops (openspec
 * change skopo-extension, design D4, oracle O3): each directory is in exactly one state, start
 * refuses anything but an empty one, and fresh never deletes a directory that is not a skopo run's.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { freshOut, normalizeScope, RunStateError, runState, startRun, STATES } from '../../../skills/skopo-create/lib/run-state.mjs';
import { cleanup, makeOut, REVISION } from './helpers.mjs';

const outs = [];
const track = (out) => {
  outs.push(out);
  return out;
};
afterEach(() => {
  for (const out of outs.splice(0)) cleanup(out);
});

describe('runState', () => {
  it('names each of the seven states for its own fixture', () => {
    const empty = track(join(mkdtempSync(join(tmpdir(), 'skopo-out-')), 'skopo'));
    const foreign = track(join(mkdtempSync(join(tmpdir(), 'skopo-out-')), 'skopo'));
    mkdirSync(foreign, { recursive: true });
    writeFileSync(join(foreign, 'notes.txt'), 'mine');
    const cases = [
      ['none', runState(empty, { revision: REVISION })],
      ['foreign', runState(foreign, { revision: REVISION })],
      ['stale', runState(track(makeOut('planned')), { revision: 'git:2222222222222222222222222222222222222222' })],
      ['other-scope', runState(track(makeOut('planned')), { revision: REVISION, scope: 'services/billing' })],
      ['started', runState(track(makeOut('started')), { revision: REVISION })],
      ['planned', runState(track(makeOut('planned')), { revision: REVISION })],
      ['created', runState(track(makeOut('created')), { revision: REVISION })],
    ];
    for (const [expected, result] of cases) expect(result.state, expected).toBe(expected);
    expect(cases.map(([s]) => s).sort()).toEqual([...STATES].sort());
  });

  it('reports the research a resumed run already has', () => {
    const out = track(makeOut('started'));
    writeFileSync(join(out, 'run', 'research', 'world.md'), 'report');
    expect(runState(out, { revision: REVISION })).toMatchObject({ state: 'started', research: ['world.md'] });
  });

  it('treats a run record of another format as foreign', () => {
    const out = track(makeOut('planned', { run: { format: 'something-else/1' } }));
    expect(runState(out, { revision: REVISION }).state).toBe('foreign');
  });

  it('matches scopes written differently', () => {
    const out = track(makeOut('planned', { run: { scope: 'services/billing' } }));
    expect(runState(out, { revision: REVISION, scope: './services/billing/' }).state).toBe('planned');
  });
});

describe('normalizeScope', () => {
  it('keeps a relative path and refuses one that leaves the project', () => {
    expect(normalizeScope('.')).toBeNull();
    expect(normalizeScope('a/./b/')).toBe('a/b');
    expect(() => normalizeScope('../other')).toThrow(RunStateError);
    expect(() => normalizeScope('a/../../b')).toThrow(RunStateError);
    expect(() => normalizeScope('/abs')).toThrow(RunStateError);
  });
});

describe('startRun', () => {
  it('creates the run record in an empty directory', () => {
    const out = track(join(mkdtempSync(join(tmpdir(), 'skopo-out-')), 'skopo'));
    const dir = startRun(out, { projectRoot: '/project', revision: REVISION, scope: 'app/', plugin: 'excavator@test', now: new Date('2026-10-27T00:00:00Z') });
    const run = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8'));
    expect(run).toMatchObject({ format: 'excavator-skopo/1', sourceRevision: REVISION, scope: 'app', runId: '20261027T000000Z', endedAt: null, phases: [], lintPasses: [] });
    expect(existsSync(join(dir, 'research'))).toBe(true);
    expect(existsSync(join(dir, 'lint'))).toBe(true);
  });

  it('refuses a directory that is not empty', () => {
    const out = track(makeOut('started'));
    expect(() => startRun(out, { projectRoot: '/p', revision: REVISION, plugin: 'x' })).toThrow(/state is started/);
  });
});

describe('freshOut', () => {
  it('deletes a skopo run', () => {
    const out = track(makeOut('created'));
    expect(freshOut(out)).toBe(true);
    expect(existsSync(out)).toBe(false);
  });

  it('refuses a foreign directory and leaves every file in place', () => {
    const out = track(join(mkdtempSync(join(tmpdir(), 'skopo-out-')), 'skopo'));
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'keep.md'), 'mine');
    expect(() => freshOut(out)).toThrow(RunStateError);
    expect(readFileSync(join(out, 'keep.md'), 'utf8')).toBe('mine');
  });

  it('removes nothing when the directory does not exist', () => {
    const out = track(join(mkdtempSync(join(tmpdir(), 'skopo-out-')), 'skopo'));
    expect(freshOut(out)).toBe(false);
    rmSync(out, { recursive: true, force: true });
  });
});
