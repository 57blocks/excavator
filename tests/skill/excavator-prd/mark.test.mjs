// prd.mjs mark (openspec change prd-feature-pipeline, design D4, D6): the
// orchestrator records a lane's dispatch and a lane's failure through this
// command, never by editing index.json itself.
import { afterEach, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

import { makeLaneRun, runPrd } from './helpers.mjs';

let run;
afterEach(() => run?.cleanup());

const feature = (index, id) => index.features.find((f) => f.id === id);

describe('prd.mjs mark', () => {
  it('counts a dispatch on the feature and keeps its status', () => {
    run = makeLaneRun();
    expect(runPrd(['check-index', run.out, '--project', run.project]).status).toBe(0);
    const first = runPrd(['mark', run.out, '--project', run.project, 'F2', 'dispatched']);
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toBe('F2: attempts 1\n');
    const second = runPrd(['mark', run.out, '--project', run.project, 'F2', 'dispatched']);
    expect(second.stdout).toBe('F2: attempts 2\n');
    const index = run.readIndex();
    expect(feature(index, 'F2').attempts).toBe(2);
    expect(feature(index, 'F2').status).toBe('planned');
    expect(feature(index, 'F1').attempts).toBe(0);
  });

  it('refuses a third dispatch with exit 1 and leaves index.json alone', () => {
    run = makeLaneRun();
    for (let i = 0; i < 2; i += 1) expect(runPrd(['mark', run.out, '--project', run.project, 'F1', 'dispatched']).status).toBe(0);
    const before = run.readText('index.json');
    const third = runPrd(['mark', run.out, '--project', run.project, 'F1', 'dispatched']);
    expect(third.status).toBe(1);
    expect(third.stdout).toBe('F1: attempts is already 2, the most a lane gets\n');
    expect(run.readText('index.json')).toBe(before);
    expect(runPrd(['check-index', run.out, '--project', run.project]).status).toBe(0);
  });

  it('counts from 0 when the index has no attempts yet', () => {
    run = makeLaneRun();
    expect(runPrd(['mark', run.out, '--project', run.project, 'F1', 'dispatched']).stdout).toBe('F1: attempts 1\n');
    expect(feature(run.readIndex(), 'F1').attempts).toBe(1);
  });

  it('records a failure with its step and reasons, and aggregate keeps a lane failure', () => {
    run = makeLaneRun();
    expect(runPrd(['check-index', run.out, '--project', run.project]).status).toBe(0);
    for (const rel of ['features/F2.md', 'findings/F2.json']) rmSync(join(run.out, rel));
    const out = runPrd(['mark', run.out, '--project', run.project, 'F2', 'failed', 'lane', 'lane-wrote-nothing']);
    expect(out.status, out.stderr).toBe(0);
    expect(out.stdout).toBe('F2: failed at lane: lane-wrote-nothing\n');
    const marked = feature(run.readIndex(), 'F2');
    expect(marked.status).toBe('failed');
    expect(marked.failure).toEqual({ step: 'lane', reasons: ['lane-wrote-nothing'] });
    expect(runPrd(['aggregate', run.out, '--project', run.project]).status).toBe(0);
    expect(feature(run.readIndex(), 'F2')).toMatchObject({ status: 'failed', attempts: 0, failure: { step: 'lane', reasons: ['lane-wrote-nothing'] } });
  });

  it('keeps each further argument as one reason', () => {
    run = makeLaneRun();
    const out = runPrd(['mark', run.out, '--project', run.project, 'F1', 'failed', 'check-lane', 'first reason', 'second reason']);
    expect(out.status, out.stderr).toBe(0);
    expect(feature(run.readIndex(), 'F1').failure).toEqual({ step: 'check-lane', reasons: ['first reason', 'second reason'] });
  });

  it('writes stable 2-space JSON: the same mark twice gives the same bytes', () => {
    run = makeLaneRun();
    expect(runPrd(['check-index', run.out, '--project', run.project]).status).toBe(0);
    const args = ['mark', run.out, '--project', run.project, 'F1', 'failed', 'lane', 'lane-wrote-nothing'];
    expect(runPrd(args).status).toBe(0);
    const once = run.readText('index.json');
    expect(once).toBe(`${JSON.stringify(JSON.parse(once), null, 2)}\n`);
    expect(runPrd(args).status).toBe(0);
    expect(run.readText('index.json')).toBe(once);
  });

  it('exits 2 and leaves index.json alone for an unknown id, event or step, or no reason', () => {
    run = makeLaneRun();
    expect(runPrd(['check-index', run.out, '--project', run.project]).status).toBe(0);
    const before = run.readText('index.json');
    for (const args of [
      ['F9', 'dispatched'],
      ['F1', 'started'],
      ['F1', 'failed', 'publish', 'why'],
      ['F1', 'failed', 'lane'],
      ['F1', 'failed', 'lane', '  '],
      ['F1', 'dispatched', 'extra'],
      ['F1'],
    ]) {
      const out = runPrd(['mark', run.out, '--project', run.project, ...args]);
      expect(out.status, args.join(' ')).toBe(2);
      expect(out.stderr, args.join(' ')).not.toBe('');
    }
    expect(runPrd(['mark', run.out, '--project', run.project, 'F9', 'dispatched']).stderr).toContain('F9');
    expect(run.readText('index.json')).toBe(before);
  });

  it('exits 1 with the reason when index.json is not valid JSON', () => {
    run = makeLaneRun();
    run.writeText('index.json', '{');
    const out = runPrd(['mark', run.out, '--project', run.project, 'F1', 'dispatched']);
    expect(out.status).toBe(1);
    expect(out.stdout).toMatch(/index: index\.json is not valid JSON/);
  });
});
