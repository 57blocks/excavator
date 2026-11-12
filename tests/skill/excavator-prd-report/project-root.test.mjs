// The project root of every command that reads index.json comes from the
// caller's --project, never from the model-written index.projectRoot
// (openspec change prd-feature-pipeline, design D2, D3).
import { afterEach, describe, expect, it } from 'vitest';
import { symlinkSync } from 'node:fs';
import { join } from 'node:path';

import { makeLaneRun, runPrd } from './helpers.mjs';

const cleanups = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()();
});
function laneRun() {
  const run = makeLaneRun();
  cleanups.push(run.cleanup);
  return run;
}

/** Each command that reads index.json, with its arguments after <out>. */
const COMMANDS = {
  'check-index': [],
  'check-lane': ['F2'],
  aggregate: [],
  assemble: [],
  mark: ['F2', 'dispatched'],
};

describe('prd.mjs --project', () => {
  it('is required, and must be an existing directory', () => {
    const run = laneRun();
    for (const [command, rest] of Object.entries(COMMANDS)) {
      const none = runPrd([command, run.out, ...rest]);
      expect(none.status, command).toBe(2);
      expect(none.stderr, command).toContain('--project');
      const missing = runPrd([command, run.out, '--project', join(run.root, 'nowhere'), ...rest]);
      expect(missing.status, command).toBe(2);
      expect(missing.stderr, command).toContain(join(run.root, 'nowhere'));
      const file = runPrd([command, run.out, '--project', join(run.project, 'src/orders/routes.js'), ...rest]);
      expect(file.status, command).toBe(2);
    }
  });

  it('refuses an index whose projectRoot is not the --project root, and writes nothing', () => {
    const run = laneRun();
    expect(runPrd(['check-index', run.out, '--project', run.project]).status).toBe(0);
    expect(runPrd(['aggregate', run.out, '--project', run.project]).status).toBe(0);
    const index = run.readIndex();
    index.projectRoot = '/';
    index.features[1].seedFiles = ['etc/hosts'];
    run.writeIndex(index);
    const before = run.readText('index.json');
    for (const [command, rest] of Object.entries(COMMANDS)) {
      const out = runPrd([command, run.out, '--project', run.project, ...rest]);
      expect(out.status, `${command}: ${out.stderr}`).toBe(1);
      expect(out.stdout, command).toContain('index: projectRoot / is not the project given with --project');
      expect(run.readText('index.json'), command).toBe(before);
    }
  });

  it('accepts the same directory reached through a symlink', () => {
    const run = laneRun();
    const link = join(run.root, 'link');
    symlinkSync(run.project, link);
    expect(runPrd(['check-index', run.out, '--project', link]).status).toBe(0);
    expect(runPrd(['check-lane', run.out, '--project', link, 'F2']).status).toBe(0);
  });
});
