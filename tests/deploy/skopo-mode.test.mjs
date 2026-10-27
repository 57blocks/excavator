/**
 * The runner's skopo modes (openspec: changes/skopo-extension, design D10, oracle O6): the
 * parameters they take, the prompt they start Claude Code with, how a verdict is read, and one
 * run end to end with a stand-in `claude` whose products the real `skopo.mjs verdict` judges.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildClaudeArgs, buildPromptArgs, MODES, parseConfig, RUNTIME_PARAMS } from '../../deploy/run-excavator.mjs';
import { buildSkopoPrompt, needsFacts, readVerdictResult } from '../../deploy/skopo-mode.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');
const runnerPath = resolve(repoRoot, 'deploy/run-excavator.mjs');
const fakeClaude = resolve(__dirname, '../fixtures/deploy/fake-claude-skopo.mjs');

const BEDROCK = { AWS_REGION: 'eu-central-1', ANTHROPIC_MODEL: 'm', EXCAVATOR_MAX_BUDGET_USD: '5' };

const temps = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const tmp = (prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
};

describe('skopo mode parameters', () => {
  it('adds the three modes and EXCAVATOR_SCOPE to the operator surface', () => {
    expect(MODES).toEqual(['lazy', 'full', 'skopo-plan', 'skopo-create', 'skopo-report']);
    expect(RUNTIME_PARAMS).toContain('EXCAVATOR_SCOPE');
  });

  it.each(['skopo-plan', 'skopo-create', 'skopo-report'])('%s needs region, model and budget like full', (mode) => {
    const parsed = parseConfig({ EXCAVATOR_MODE: mode });
    expect(parsed.ok).toBe(false);
    expect(parsed.errors).toEqual(['AWS_REGION is required', 'ANTHROPIC_MODEL is required', 'EXCAVATOR_MAX_BUDGET_USD is required']);
    expect(parseConfig({ EXCAVATOR_MODE: mode, ...BEDROCK }).ok).toBe(true);
  });

  it('keeps a scope for plan and create, normalized', () => {
    expect(parseConfig({ EXCAVATOR_MODE: 'skopo-create', EXCAVATOR_SCOPE: './services/billing/', ...BEDROCK }).config.scope).toBe('services/billing');
    expect(parseConfig({ EXCAVATOR_MODE: 'skopo-plan', ...BEDROCK }).config.scope).toBeNull();
  });

  it.each([
    ['skopo-create', '../other', /EXCAVATOR_SCOPE is invalid: scope must stay inside the project/],
    ['skopo-plan', '/abs', /EXCAVATOR_SCOPE is invalid: scope must be a path relative/],
    ['skopo-report', 'app', /EXCAVATOR_SCOPE applies only to skopo-plan and skopo-create, not to "skopo-report"/],
    ['full', 'app', /EXCAVATOR_SCOPE applies only to/],
    ['lazy', 'app', /EXCAVATOR_SCOPE applies only to/],
  ])('refuses EXCAVATOR_SCOPE=%s in %s', (mode, scope, expected) => {
    const parsed = parseConfig({ EXCAVATOR_MODE: mode, EXCAVATOR_SCOPE: scope, ...BEDROCK });
    expect(parsed.ok).toBe(false);
    expect(parsed.errors.join('\n')).toMatch(expected);
  });

  it('names every mode when the mode is wrong', () => {
    expect(parseConfig({ EXCAVATOR_MODE: 'skopo' }).errors[0]).toBe('EXCAVATOR_MODE must be one of "lazy", "full", "skopo-plan", "skopo-create", "skopo-report", got "skopo"');
  });
});

describe('skopo mode prompt', () => {
  it('runs the skill on the repository with its output under <out>/skopo, scoped when asked', () => {
    expect(buildSkopoPrompt({ mode: 'skopo-create', repoPath: '/work/repo', outDir: '/work/out', scope: 'app' }))
      .toBe('/excavator:skopo-create /work/repo --out /work/out/skopo --scope app');
    expect(buildSkopoPrompt({ mode: 'skopo-report', repoPath: '/work/repo', outDir: '/work/out', scope: 'app' }))
      .toBe('/excavator:skopo-report /work/repo --out /work/out/skopo');
  });

  it('starts Claude Code with exactly the isolation flags of full', () => {
    const full = buildClaudeArgs({ repoPath: '/r', pluginDir: '/p', fullFlagArg: '--full', model: 'm', maxBudgetUsd: 5 });
    const skopo = buildPromptArgs({ prompt: 'x', pluginDir: '/p', model: 'm', maxBudgetUsd: 5 });
    expect(skopo.slice(2)).toEqual(full.slice(2));
    expect(full.slice(0, 2)).toEqual(['-p', '/excavator:excavator /r --full']);
  });

  it('builds the facts unless they are fresh', () => {
    expect(needsFacts({ status: 'fresh' })).toBe(false);
    for (const status of ['stale', 'missing', 'unknown']) expect(needsFacts({ status })).toBe(true);
    expect(needsFacts(null)).toBe(true);
  });
});

describe('reading a verdict', () => {
  it('passes on exit 0, lists the problems on exit 1, and fails when it could not run', () => {
    expect(readVerdictResult({ status: 0, stdout: 'verdict create: ok\n' })).toEqual({ ok: true, reasons: [] });
    expect(readVerdictResult({ status: 1, stdout: 'lint: error L1 x\nverdict create: 1 problems\n' })).toEqual({ ok: false, reasons: ['lint: error L1 x'] });
    expect(readVerdictResult({ status: 2, stderr: 'skopo: --project <root> is required\n' }).reasons[0]).toMatch(/could not run \(exit 2\): skopo: --project/);
    expect(readVerdictResult({ status: null, stdout: '' }).ok).toBe(false);
  });
});

describe('a skopo-create run end to end', () => {
  function makeRepo() {
    const dir = tmp('skopo-runner-repo-');
    writeFileSync(join(dir, 'index.js'), 'module.exports = 1;\n');
    for (const args of [['init', '-q', '-b', 'main'], ['add', '-A'], ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'init']]) {
      execFileSync('git', args, { cwd: dir });
    }
    return dir;
  }

  function runRunner(scenario) {
    const repo = makeRepo();
    const out = tmp('skopo-runner-out-');
    const result = spawnSync(process.execPath, [runnerPath], {
      env: {
        PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...BEDROCK,
        EXCAVATOR_MODE: 'skopo-create',
        EXCAVATOR_REPO_ROOT_OVERRIDE: repo,
        EXCAVATOR_OUT_DIR_OVERRIDE: out,
        EXCAVATOR_PLUGIN_DIR_OVERRIDE: repoRoot,
        EXCAVATOR_CLAUDE_BIN_OVERRIDE: fakeClaude,
        FAKE_SKOPO_SCENARIO: scenario,
      },
      encoding: 'utf-8',
      timeout: 120_000,
    });
    return { result, repo, out, summary: JSON.parse(readFileSync(join(out, 'summary.json'), 'utf-8')) };
  }

  it('builds the facts first, then exits 0 when the verdict passes', () => {
    const { result, repo, summary } = runRunner('valid');
    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(join(repo, '.excavator'))).toBe(true);
    expect(summary).toMatchObject({ mode: 'skopo-create', exitCode: 0 });
    expect(summary.checks.product).toMatchObject({ status: 'passed' });
    expect(summary.checks.fabrication.status).toBe('not-applicable');
  }, 120_000);

  it('exits 4 and keeps the products when the skopository has a lint error', () => {
    const { result, out, summary } = runRunner('lint-error');
    expect(result.status).toBe(4);
    expect(summary.checks.product.status).toBe('failed');
    expect(summary.checks.product.reasons.some((r) => r.startsWith('lint: error '))).toBe(true);
    expect(existsSync(join(out, 'skopo', 'skopo', 'skopo.json'))).toBe(true);
  }, 120_000);
});
