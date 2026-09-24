import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PIPELINE_VERSION } from '../../skills/excavator/annotate-graph.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');
const runnerPath = resolve(repoRoot, 'deploy/run-excavator.mjs');
const fakeClaudePath = resolve(__dirname, '../fixtures/deploy/fake-claude.mjs');
const fakePluginDirValidateFailure = resolve(__dirname, '../fixtures/deploy/fake-plugin-dir-validate-failure');

const cleanup = [];
afterEach(() => { while (cleanup.length) cleanup.pop()(); });

function mkTmp(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A tiny real git repo, so `git rev-parse HEAD` (used by run-excavator.mjs) works for real. */
function makeSyntheticRepo() {
  const dir = mkTmp('excavator-e2e-repo-');
  writeFileSync(join(dir, 'index.js'), 'module.exports = 1;\n');
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'e2e@excavator.local'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Excavator E2E'], { cwd: dir });
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'initial'], { cwd: dir });
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf-8' }).trim();
  return { dir, head };
}

function runRunner(env, { timeoutMs = 20_000 } = {}) {
  const result = spawnSync(process.execPath, [runnerPath], {
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env },
    encoding: 'utf-8',
    timeout: timeoutMs,
  });
  return result;
}

function baseEnv({ repoDir, outDir, scenario, head, timeoutMinutes, graceSeconds }) {
  return {
    EXCAVATOR_MODE: 'full',
    AWS_REGION: 'eu-central-1',
    ANTHROPIC_MODEL: 'fake-model-e2e',
    EXCAVATOR_MAX_BUDGET_USD: '5',
    EXCAVATOR_REPO_ROOT_OVERRIDE: repoDir,
    EXCAVATOR_OUT_DIR_OVERRIDE: outDir,
    EXCAVATOR_PLUGIN_DIR_OVERRIDE: repoRoot,
    EXCAVATOR_CLAUDE_BIN_OVERRIDE: fakeClaudePath,
    EXCAVATOR_TIMEOUT_MINUTES: String(timeoutMinutes ?? 5),
    EXCAVATOR_TIMEOUT_GRACE_SECONDS_OVERRIDE: String(graceSeconds ?? 30),
    FAKE_CLAUDE_SCENARIO: scenario,
    FAKE_CLAUDE_HEAD_SHA: head,
    EXCAVATOR_IMAGE_COMMIT: 'e2e-test-commit',
    EXCAVATOR_IMAGE_CLAUDE_CODE_VERSION: '2.1.281',
  };
}

function readSummary(outDir) {
  return JSON.parse(readFileSync(join(outDir, 'summary.json'), 'utf-8'));
}

describe('run-excavator.mjs end to end, against a fake claude executable (task 2.5)', () => {
  it('config error: exits 2, writes nothing, nothing on stdout', () => {
    const outDir = mkTmp('excavator-e2e-out-');
    const result = runRunner({ EXCAVATOR_MODE: 'not-a-mode', EXCAVATOR_OUT_DIR_OVERRIDE: outDir });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/EXCAVATOR_MODE/);
    expect(existsSync(join(outDir, 'summary.json'))).toBe(false);
  });

  it('success: exits 0, checks all pass, tokens and cache warning present', () => {
    const { dir: repoDir, head } = makeSyntheticRepo();
    const outDir = mkTmp('excavator-e2e-out-');
    const result = runRunner(baseEnv({ repoDir, outDir, scenario: 'success', head }));
    expect(result.status).toBe(0);

    const summary = readSummary(outDir);
    expect(summary.exitCode).toBe(0);
    expect(summary.skipped).toBe(false);
    expect(summary.mode).toBe('full');
    expect(summary.model).toBe('fake-model-e2e');
    expect(summary.imageCommit).toBe('e2e-test-commit');
    expect(summary.imageClaudeCodeVersion).toBe('2.1.281');
    expect(summary.repoHead).toBe(head);
    expect(summary.checks.load.status).toBe('passed');
    expect(summary.checks.run.status).toBe('passed');
    expect(summary.checks.product.status).toBe('passed');
    expect(summary.checks.integrity.status).toBe('passed');
    expect(summary.checks.fabrication.status).toBe('passed');
    expect(summary.tokens.inputTokens).toBe(100);
    expect(summary.tokens.cacheReadInputTokens).toBe(0);
    expect(summary.cacheWarning).toBe(true); // fake-claude always reports zero cache reads
    expect(existsSync(join(outDir, 'run.jsonl'))).toBe(true);
    expect(existsSync(join(outDir, 'validated-graph.json'))).toBe(true);
    expect(existsSync(join(outDir, 'validation.json'))).toBe(true);
  });

  it('skip: a matching full product short-circuits before claude is ever invoked', () => {
    const { dir: repoDir, head } = makeSyntheticRepo();
    const outDir = mkTmp('excavator-e2e-out-');
    // Pre-seed a full product for the current HEAD, importing the real
    // PIPELINE_VERSION (same source the runner itself imports) rather than
    // a literal, so this fixture cannot silently drift from it.
    const dataDir = join(repoDir, '.excavator');
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'knowledge-graph.json'), JSON.stringify({
      project: { pipelineVersion: PIPELINE_VERSION, gitCommitHash: head, model: 'fake-model-e2e', verification: 'verified' },
      nodes: [], edges: [], layers: [], coverage: {}, gaps: [],
    }, null, 2));
    writeFileSync(join(dataDir, 'meta.json'), JSON.stringify({ gitCommitHash: head }, null, 2));

    // Point at a nonexistent claude binary: if the runner tried to spawn it
    // anyway, the run would fail with a spawn error instead of exiting 0.
    const result = runRunner({
      ...baseEnv({ repoDir, outDir, scenario: 'success', head }),
      EXCAVATOR_CLAUDE_BIN_OVERRIDE: '/no/such/claude-binary',
    });
    expect(result.status).toBe(0);
    const summary = readSummary(outDir);
    expect(summary.skipped).toBe(true);
    expect(existsSync(join(outDir, 'run.jsonl'))).toBe(false);
  });

  it('run failure: exits 3, load passed, run failed', () => {
    const { dir: repoDir, head } = makeSyntheticRepo();
    const outDir = mkTmp('excavator-e2e-out-');
    const result = runRunner(baseEnv({ repoDir, outDir, scenario: 'run-failure', head }));
    expect(result.status).toBe(3);
    const summary = readSummary(outDir);
    expect(summary.checks.load.status).toBe('passed');
    expect(summary.checks.run.status).toBe('failed');
  });

  it('load failure: exits 4 even though the result event looks clean', () => {
    const { dir: repoDir, head } = makeSyntheticRepo();
    const outDir = mkTmp('excavator-e2e-out-');
    const result = runRunner(baseEnv({ repoDir, outDir, scenario: 'load-failure', head }));
    expect(result.status).toBe(4);
    const summary = readSummary(outDir);
    expect(summary.checks.load.status).toBe('failed');
  });

  it('fabrication: exits 5 when verification was skipped, even with a clean run and correct product fields', () => {
    const { dir: repoDir, head } = makeSyntheticRepo();
    const outDir = mkTmp('excavator-e2e-out-');
    const result = runRunner(baseEnv({ repoDir, outDir, scenario: 'fabrication-skipped', head }));
    expect(result.status).toBe(5);
    const summary = readSummary(outDir);
    expect(summary.checks.load.status).toBe('passed');
    expect(summary.checks.run.status).toBe('passed');
    expect(summary.checks.product.status).toBe('passed');
    expect(summary.checks.fabrication.status).toBe('failed');
    expect(summary.checks.fabrication.verificationSkipped).toBe(true);
  });

  it('wall-clock timeout escalates SIGINT then SIGTERM and is a run failure', () => {
    const { dir: repoDir, head } = makeSyntheticRepo();
    const outDir = mkTmp('excavator-e2e-out-');
    // ~0.6s timeout, ~0.6s grace: fake-claude's 'timeout' scenario survives
    // SIGINT and only dies on SIGTERM, so this proves the escalation runs.
    const result = runRunner(
      baseEnv({ repoDir, outDir, scenario: 'timeout', head, timeoutMinutes: 0.01, graceSeconds: 0.5 }),
      { timeoutMs: 15_000 },
    );
    expect(result.status).toBe(3);
    const summary = readSummary(outDir);
    expect(summary.checks.run.status).toBe('failed');
    expect(summary.checks.run.reasons.some((r) => r.includes('timeout'))).toBe(true);
  }, 20_000);

  // Acceptor review finding: a reused /work/out must never let a stale
  // validation.json/validated-graph.json from a PRIOR run be read as this
  // run's verdict, and a real validate-graph.mjs failure must be an
  // integrity failure (exit 4), not silently ignored. Uses a fake plugin
  // dir whose validate-graph.mjs always fails, so the failure path is
  // deterministic and does not depend on the real script's own behavior.
  it('a stale validation report in a reused out dir is deleted, and a validate-graph failure is an integrity failure (exit 4)', () => {
    const { dir: repoDir, head } = makeSyntheticRepo();
    const outDir = mkTmp('excavator-e2e-out-');
    writeFileSync(join(outDir, 'validation.json'), JSON.stringify({ issues: [], sentinel: 'STALE-SHOULD-BE-DELETED' }));
    writeFileSync(join(outDir, 'validated-graph.json'), JSON.stringify({ sentinel: 'STALE-SHOULD-BE-DELETED', nodes: [], edges: [], project: {} }));

    const result = runRunner({
      ...baseEnv({ repoDir, outDir, scenario: 'success', head }),
      EXCAVATOR_PLUGIN_DIR_OVERRIDE: fakePluginDirValidateFailure,
    });
    expect(result.status).toBe(4);

    // Neither stale file survives, and the failing fake script never wrote
    // fresh ones either — proving the stale content was never read as this
    // run's verdict.
    expect(existsSync(join(outDir, 'validation.json'))).toBe(false);
    expect(existsSync(join(outDir, 'validated-graph.json'))).toBe(false);

    const summary = readSummary(outDir);
    expect(summary.checks.load.status).toBe('passed');
    expect(summary.checks.run.status).toBe('passed');
    expect(summary.checks.product.status).toBe('passed');
    expect(summary.checks.integrity.status).toBe('failed');
    expect(summary.checks.integrity.reasons.some((r) => r.includes('simulated crash'))).toBe(true);
    expect(summary.checks.fabrication.status).toBe('failed');
  });
});
