import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { aggregateModelUsage, buildSummary, resolveExitCode, EXIT_CODES } from '../../deploy/run-excavator.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, '../fixtures/deploy');
const loadFixture = (name) => JSON.parse(readFileSync(join(fixturesDir, name), 'utf-8'));

describe('resolveExitCode (design D4, task 2.5)', () => {
  it('skip always wins with exit 0', () => {
    expect(resolveExitCode({ skipped: true, loadOk: false, runOk: false, productOk: false, fabricationOk: false })).toBe(EXIT_CODES.OK);
  });

  it('all checks passed is exit 0', () => {
    expect(resolveExitCode({ skipped: false, loadOk: true, runOk: true, productOk: true, fabricationOk: true })).toBe(EXIT_CODES.OK);
  });

  it('load failure wins over run/product/fabrication failure (checked first)', () => {
    expect(resolveExitCode({ skipped: false, loadOk: false, runOk: false, productOk: false, fabricationOk: false })).toBe(EXIT_CODES.LOAD_OR_PRODUCT_FAILURE);
  });

  it('run failure is reported when load passed but run failed', () => {
    expect(resolveExitCode({ skipped: false, loadOk: true, runOk: false, productOk: false, fabricationOk: false })).toBe(EXIT_CODES.RUN_FAILURE);
  });

  it('product/integrity failure is reported when load and run both passed', () => {
    expect(resolveExitCode({ skipped: false, loadOk: true, runOk: true, productOk: false, fabricationOk: false })).toBe(EXIT_CODES.LOAD_OR_PRODUCT_FAILURE);
  });

  it('fabrication is reported only once load, run and product all passed', () => {
    expect(resolveExitCode({ skipped: false, loadOk: true, runOk: true, productOk: true, fabricationOk: false })).toBe(EXIT_CODES.FABRICATION);
  });
});

describe('aggregateModelUsage', () => {
  it('sums the four token kinds and cost across every model used', () => {
    const usage = {
      modelA: { inputTokens: 10, outputTokens: 2, cacheReadInputTokens: 5, cacheCreationInputTokens: 1, costUSD: 0.1 },
      modelB: { inputTokens: 20, outputTokens: 3, cacheReadInputTokens: 0, cacheCreationInputTokens: 4, costUSD: 0.2 },
    };
    expect(aggregateModelUsage(usage)).toEqual({
      inputTokens: 30, outputTokens: 5, cacheReadInputTokens: 5, cacheCreationInputTokens: 5, costUsd: 0.30000000000000004,
    });
  });

  it('returns all zeros for an empty or missing modelUsage', () => {
    expect(aggregateModelUsage({})).toEqual({ inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUsd: 0 });
    expect(aggregateModelUsage(undefined)).toEqual({ inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUsd: 0 });
  });
});

describe('buildSummary (spec "每次运行恰好落入一个可见结果", task 2.5)', () => {
  const base = {
    imageCommit: 'deadbeef', imageClaudeCodeVersion: '2.1.281', repoHead: 'abc123',
    mode: 'full', model: 'eu.anthropic.claude-sonnet-5',
  };

  it('carries every field the spec requires for a successful run', () => {
    const resultEvent = loadFixture('result-good.json');
    const loadCheck = { ok: true, reasons: [] };
    const runCheck = { ok: true, reasons: [] };
    const productCheck = { ok: true, reasons: [] };
    const fabricationCheck = { integrityOk: true, issuesCount: 0, fabricationOk: true, contradictedCount: 0, unverifiedCount: 0, verificationSkipped: false, maxContradicted: 0 };
    const summary = buildSummary({
      ...base, skipped: false, skipReason: null, loadCheck, runCheck, productCheck, fabricationCheck,
      modelUsage: resultEvent.modelUsage, exitCode: EXIT_CODES.OK,
    });

    expect(summary.imageCommit).toBe('deadbeef');
    expect(summary.imageClaudeCodeVersion).toBe('2.1.281');
    expect(summary.repoHead).toBe('abc123');
    expect(summary.mode).toBe('full');
    expect(summary.model).toBe('eu.anthropic.claude-sonnet-5');
    expect(summary.exitCode).toBe(0);
    expect(summary.checks.load.status).toBe('passed');
    expect(summary.checks.run.status).toBe('passed');
    expect(summary.checks.product.status).toBe('passed');
    expect(summary.checks.integrity.status).toBe('passed');
    expect(summary.checks.fabrication.status).toBe('passed');
    expect(summary.tokens).toEqual({
      inputTokens: 12000, outputTokens: 3400, cacheCreationInputTokens: 500, cacheReadInputTokens: 8000,
    });
    expect(summary.estimatedCostUsd).toBeCloseTo(0.42);
    expect(summary.contradictedCount).toBe(0);
    expect(summary.unverifiedCount).toBe(0);
    expect(summary.cacheWarning).toBe(false);
  });

  it('sets cacheWarning when cache-read tokens are zero on a real model run', () => {
    const resultEvent = loadFixture('result-no-cache-read.json');
    const summary = buildSummary({
      ...base, skipped: false, skipReason: null,
      loadCheck: { ok: true, reasons: [] }, runCheck: { ok: true, reasons: [] },
      productCheck: { ok: true, reasons: [] },
      fabricationCheck: { integrityOk: true, issuesCount: 0, fabricationOk: true, contradictedCount: 0, unverifiedCount: 0, verificationSkipped: false, maxContradicted: 0 },
      modelUsage: resultEvent.modelUsage, exitCode: EXIT_CODES.OK,
    });
    expect(summary.tokens.cacheReadInputTokens).toBe(0);
    expect(summary.cacheWarning).toBe(true);
  });

  it('does not raise a spurious cache warning when no model was ever called (lazy/skip)', () => {
    const summary = buildSummary({
      ...base, mode: 'lazy', model: null, skipped: false, skipReason: null,
      loadCheck: null, runCheck: { ok: true, reasons: [] }, productCheck: null, fabricationCheck: null,
      modelUsage: {}, exitCode: EXIT_CODES.OK,
    });
    expect(summary.cacheWarning).toBe(false);
    expect(summary.checks.load.status).toBe('not-applicable');
    expect(summary.checks.product.status).toBe('not-applicable');
    expect(summary.checks.fabrication.status).toBe('not-applicable');
  });

  it('marks a skipped run with skipped:true and a reason, no checks evaluated', () => {
    const summary = buildSummary({
      ...base, skipped: true, skipReason: 'existing full product already matches HEAD',
      loadCheck: null, runCheck: null, productCheck: null, fabricationCheck: null,
      modelUsage: {}, exitCode: EXIT_CODES.OK,
    });
    expect(summary.skipped).toBe(true);
    expect(summary.skipReason).toBe('existing full product already matches HEAD');
    expect(summary.exitCode).toBe(0);
  });

  it('still records every check that could be evaluated even when the run failed', () => {
    const summary = buildSummary({
      ...base, skipped: false, skipReason: null,
      loadCheck: { ok: true, reasons: [] },
      runCheck: { ok: false, reasons: ['claude process exited with code 1'] },
      productCheck: null, fabricationCheck: null,
      modelUsage: {}, exitCode: EXIT_CODES.RUN_FAILURE,
    });
    expect(summary.checks.load.status).toBe('passed');
    expect(summary.checks.run.status).toBe('failed');
    expect(summary.checks.run.reasons).toEqual(['claude process exited with code 1']);
    expect(summary.checks.product.status).toBe('not-applicable');
    expect(summary.exitCode).toBe(3);
  });
});
