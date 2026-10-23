// The lock on index.json (openspec change prd-feature-pipeline, design D4):
// every command that reads, changes and writes index.json holds
// <out>/index.json.lock, so two commands on the same run never lose a write.
import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PRD_SCRIPT, makeLaneRun, runPrd } from './helpers.mjs';

let run;
afterEach(() => run?.cleanup());

/** Run prd.mjs without waiting; resolves to { status, stdout, stderr }. */
function startPrd(args, env = {}) {
  const child = spawn(process.execPath, [PRD_SCRIPT, ...args], { env: { ...process.env, ...env } });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const done = new Promise((resolve) => child.on('close', (status) => resolve({ status, stdout, stderr })));
  return { child, done };
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const lockOf = (out) => join(out, 'index.json.lock');

describe('prd.mjs index.json lock', () => {
  it('lets two concurrent dispatches of one feature both count', async () => {
    run = makeLaneRun();
    expect(runPrd(['check-index', run.out, '--project', run.project]).status).toBe(0);
    const results = await Promise.all([1, 2].map(() => startPrd(['mark', run.out, 'F1', 'dispatched', '--project', run.project]).done));
    expect(results.map((r) => r.status)).toEqual([0, 0]);
    expect(run.readIndex().features.find((f) => f.id === 'F1').attempts).toBe(2);
    expect(existsSync(lockOf(run.out))).toBe(false);
  });

  it('waits while another command holds the lock, then writes', async () => {
    run = makeLaneRun();
    expect(runPrd(['check-index', run.out, '--project', run.project]).status).toBe(0);
    writeFileSync(lockOf(run.out), '1\n');
    const mark = startPrd(['mark', run.out, 'F1', 'dispatched', '--project', run.project]);
    await pause(700);
    expect(mark.child.exitCode).toBe(null);
    expect(run.readIndex().features[0].attempts).toBe(0);
    rmSync(lockOf(run.out));
    const result = await mark.done;
    expect(result.status, result.stderr).toBe(0);
    expect(run.readIndex().features[0].attempts).toBe(1);
    expect(existsSync(lockOf(run.out))).toBe(false);
  });

  it('exits 2 naming the lock for every writing command when the lock is held past the timeout, and leaves index.json alone', () => {
    run = makeLaneRun();
    expect(runPrd(['check-index', run.out, '--project', run.project]).status).toBe(0);
    writeFileSync(lockOf(run.out), '4242\n');
    const before = run.readText('index.json');
    for (const args of [['check-index'], ['check-lane', 'F1'], ['aggregate'], ['mark', 'F1', 'dispatched']]) {
      const [command, ...rest] = args;
      const out = runPrd([command, run.out, ...rest, '--project', run.project], { env: { ...process.env, EXCAVATOR_PRD_LOCK_TIMEOUT_MS: '200' } });
      expect(out.status, command).toBe(2);
      expect(out.stderr, command).toContain(lockOf(run.out));
      expect(out.stderr, command).toContain('pid 4242');
    }
    expect(run.readText('index.json')).toBe(before);
    expect(existsSync(lockOf(run.out))).toBe(true);
  });

  it('removes the lock after a failed check and after a usage error', () => {
    run = makeLaneRun();
    const index = run.readIndex();
    index.features[1].entrypoints = [];
    run.writeIndex(index);
    expect(runPrd(['check-index', run.out, '--project', run.project]).status).toBe(1);
    expect(existsSync(lockOf(run.out))).toBe(false);
    expect(runPrd(['mark', run.out, 'F9', 'dispatched', '--project', run.project]).status).toBe(2);
    expect(existsSync(lockOf(run.out))).toBe(false);
  });
});
