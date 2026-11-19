// The candidates command's output for the synthetic entrypoint fixtures is
// byte-identical to the golden files frozen before the PRD report skill was
// removed (openspec change remove-prd-report, oracle O1). The only edit made
// to the captured text is that the absolute project root, which differs per
// machine, is written as <ROOT>.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ENTRYPOINT_FIXTURES, repoRoot, runHandbook } from './helpers.mjs';

const GOLDEN = join(repoRoot, 'tests/fixtures/entrypoints-golden');
const golden = (name) => readFileSync(join(GOLDEN, name), 'utf-8');

function candidatesOutput(root, extra = []) {
  const out = runHandbook(['candidates', root, ...extra]);
  expect(out.status, out.stderr).toBe(0);
  return out.stdout.split(root).join('<ROOT>');
}

describe('handbook candidates output is byte-identical to the frozen golden (O1)', () => {
  it.each([
    ['express-app', [], 'express-app.json'],
    ['gin-service', [], 'gin-service.json'],
    ['react-web', [], 'react-web.json'],
    ['express-app', ['--scope', 'src/routes'], 'express-app-scoped.json'],
  ])('fixture %s %j', (fixture, extra, file) => {
    // The command prints the realpath of the root; the fixture path is already one.
    expect(candidatesOutput(join(ENTRYPOINT_FIXTURES, fixture), extra)).toBe(golden(file));
  });
});
