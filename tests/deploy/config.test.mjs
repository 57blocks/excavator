import { describe, expect, it } from 'vitest';

import { parseConfig, RUNTIME_PARAMS, EXIT_CODES } from '../../deploy/run-excavator.mjs';

const LAZY_MINIMAL = Object.freeze({ EXCAVATOR_MODE: 'lazy' });
const FULL_MINIMAL = Object.freeze({
  EXCAVATOR_MODE: 'full',
  AWS_REGION: 'eu-central-1',
  ANTHROPIC_MODEL: 'eu.anthropic.claude-sonnet-5',
  EXCAVATOR_MAX_BUDGET_USD: '5',
});

describe('parseConfig (design D4, task 2.1)', () => {
  it('accepts the lazy mode with only EXCAVATOR_MODE set', () => {
    const result = parseConfig(LAZY_MINIMAL);
    expect(result.ok).toBe(true);
    expect(result.config.mode).toBe('lazy');
    // full-only fields stay unrequired/null for lazy.
    expect(result.config.region).toBeNull();
    expect(result.config.model).toBeNull();
    expect(result.config.maxBudgetUsd).toBeNull();
    // Defaults apply.
    expect(result.config.maxContradicted).toBe(0);
    expect(result.config.timeoutMinutes).toBe(180);
    expect(result.config.repoRoot).toBe('/work/repo');
    expect(result.config.outDir).toBe('/work/out');
    expect(result.config.pluginDir).toBe('/opt/excavator');
    expect(result.config.claudeBin).toBe('claude');
  });

  it('accepts a minimal full config', () => {
    const result = parseConfig(FULL_MINIMAL);
    expect(result.ok).toBe(true);
    expect(result.config.mode).toBe('full');
    expect(result.config.region).toBe('eu-central-1');
    expect(result.config.model).toBe('eu.anthropic.claude-sonnet-5');
    expect(result.config.maxBudgetUsd).toBe(5);
    expect(result.config.force).toBe(false);
  });

  it('rejects an invalid mode', () => {
    const result = parseConfig({ EXCAVATOR_MODE: 'turbo' });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('EXCAVATOR_MODE'))).toBe(true);
  });

  it('rejects a missing mode', () => {
    const result = parseConfig({});
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('EXCAVATOR_MODE'))).toBe(true);
  });

  it('rejects full mode missing AWS_REGION', () => {
    const { AWS_REGION, ...rest } = FULL_MINIMAL;
    const result = parseConfig(rest);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('AWS_REGION'))).toBe(true);
  });

  it('rejects full mode missing ANTHROPIC_MODEL', () => {
    const { ANTHROPIC_MODEL, ...rest } = FULL_MINIMAL;
    const result = parseConfig(rest);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('ANTHROPIC_MODEL'))).toBe(true);
  });

  it('rejects full mode missing EXCAVATOR_MAX_BUDGET_USD', () => {
    const { EXCAVATOR_MAX_BUDGET_USD, ...rest } = FULL_MINIMAL;
    const result = parseConfig(rest);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('EXCAVATOR_MAX_BUDGET_USD'))).toBe(true);
  });

  it('rejects a non-numeric EXCAVATOR_MAX_BUDGET_USD', () => {
    const result = parseConfig({ ...FULL_MINIMAL, EXCAVATOR_MAX_BUDGET_USD: 'five-dollars' });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('EXCAVATOR_MAX_BUDGET_USD'))).toBe(true);
  });

  it('rejects a zero or negative EXCAVATOR_MAX_BUDGET_USD', () => {
    expect(parseConfig({ ...FULL_MINIMAL, EXCAVATOR_MAX_BUDGET_USD: '0' }).ok).toBe(false);
    expect(parseConfig({ ...FULL_MINIMAL, EXCAVATOR_MAX_BUDGET_USD: '-1' }).ok).toBe(false);
  });

  it('reports every offending parameter at once, not just the first', () => {
    const result = parseConfig({ EXCAVATOR_MODE: 'full' });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('AWS_REGION'))).toBe(true);
    expect(result.errors.some((e) => e.includes('ANTHROPIC_MODEL'))).toBe(true);
    expect(result.errors.some((e) => e.includes('EXCAVATOR_MAX_BUDGET_USD'))).toBe(true);
  });

  it('parses EXCAVATOR_FORCE as a boolean flag and rejects garbage values', () => {
    expect(parseConfig({ ...LAZY_MINIMAL, EXCAVATOR_FORCE: '1' }).config.force).toBe(true);
    expect(parseConfig({ ...LAZY_MINIMAL, EXCAVATOR_FORCE: 'true' }).config.force).toBe(true);
    expect(parseConfig({ ...LAZY_MINIMAL, EXCAVATOR_FORCE: '0' }).config.force).toBe(false);
    const bad = parseConfig({ ...LAZY_MINIMAL, EXCAVATOR_FORCE: 'maybe' });
    expect(bad.ok).toBe(false);
  });

  it('rejects a non-integer EXCAVATOR_MAX_CONTRADICTED', () => {
    const result = parseConfig({ ...LAZY_MINIMAL, EXCAVATOR_MAX_CONTRADICTED: '1.5' });
    expect(result.ok).toBe(false);
  });

  it('rejects a non-positive EXCAVATOR_TIMEOUT_MINUTES', () => {
    const result = parseConfig({ ...LAZY_MINIMAL, EXCAVATOR_TIMEOUT_MINUTES: '0' });
    expect(result.ok).toBe(false);
  });

  it('exposes the exact operator-facing runtime parameter set used by docs/deploy.md', () => {
    expect([...RUNTIME_PARAMS].sort()).toEqual([
      'ANTHROPIC_MODEL', 'AWS_REGION', 'EXCAVATOR_FORCE', 'EXCAVATOR_MAX_BUDGET_USD',
      'EXCAVATOR_MAX_CONTRADICTED', 'EXCAVATOR_MODE', 'EXCAVATOR_TIMEOUT_MINUTES',
    ]);
  });

  it('EXIT_CODES.CONFIG_ERROR is 2, matching the spec’s fixed exit code table', () => {
    expect(EXIT_CODES.CONFIG_ERROR).toBe(2);
  });
});
