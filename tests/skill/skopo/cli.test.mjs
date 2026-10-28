/**
 * skopo.mjs as the skills call it: subcommands, exit codes and the source revision it reads from
 * the project itself (openspec change skopo-extension, design D5).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { cleanup, makeGitProject, makeOut, runSkopo } from './helpers.mjs';

const temps = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('skopo.mjs', () => {
  it('starts a run with the project revision, then reports it as started', () => {
    const project = makeGitProject();
    const parent = mkdtempSync(join(tmpdir(), 'skopo-cli-'));
    temps.push(project, parent);
    const out = join(parent, 'skopo');
    const started = runSkopo(['start', out, '--project', project, '--scope', 'src']);
    expect(started.code, started.stderr).toBe(0);
    const run = JSON.parse(readFileSync(join(out, 'run', 'run.json'), 'utf8'));
    expect(run.sourceRevision).toMatch(/^git:[0-9a-f]{40}$/);
    expect(run.plugin).toMatch(/^excavator@\d/);
    const status = runSkopo(['status', out, '--project', project, '--scope', 'src']);
    expect(JSON.parse(status.stdout)).toMatchObject({ state: 'started', currentSourceRevision: run.sourceRevision });
    expect(runSkopo(['start', out, '--project', project]).code).toBe(2);
  });

  it('exits 1 with each problem and the verdict line when a check fails', () => {
    const project = makeGitProject();
    temps.push(project);
    const out = makeOut('planned');
    const result = runSkopo(['verdict', out, '--stage', 'plan', '--project', project]);
    cleanup(out);
    expect(result.code).toBe(1);
    expect(result.stdout.trim().split('\n').at(-1)).toBe('verdict plan: 1 problems');
  });

  it('exits 2 on a missing value or an unknown command', () => {
    expect(runSkopo(['status', '/tmp/x', '--project']).code).toBe(2);
    expect(runSkopo(['lock', '/tmp/x']).code).toBe(2);
    expect(runSkopo(['verdict', '/tmp/x', '--project', '/tmp']).code).toBe(2);
  });
});
