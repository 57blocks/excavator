import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkRun, describeApiError } from '../../deploy/run-excavator.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = resolve(__dirname, '../fixtures/deploy');
const loadFixture = (name) => JSON.parse(readFileSync(join(fixturesDir, name), 'utf-8'));

describe('checkRun (task 2.3, design D4 "运行" / O3)', () => {
  it('passes the positive sample', () => {
    const result = checkRun({ resultEvent: loadFixture('result-good.json'), processExitCode: 0, timedOut: false });
    expect(result.ok).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it('fails when is_error is true', () => {
    const result = checkRun({ resultEvent: loadFixture('result-is-error.json'), processExitCode: 0, timedOut: false });
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('is_error'))).toBe(true);
  });

  it('fails when permission_denials is non-empty', () => {
    const result = checkRun({ resultEvent: loadFixture('result-permission-denials.json'), processExitCode: 0, timedOut: false });
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('permission denial'))).toBe(true);
  });

  it('fails when subagent_stats.failed is greater than zero', () => {
    const result = checkRun({ resultEvent: loadFixture('result-subagent-failed.json'), processExitCode: 0, timedOut: false });
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('subagent'))).toBe(true);
  });

  it('fails when the claude process exited non-zero even if the result event looks clean', () => {
    const result = checkRun({ resultEvent: loadFixture('result-good.json'), processExitCode: 1, timedOut: false });
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('exited with code 1'))).toBe(true);
  });

  it('fails when no result event was observed at all', () => {
    const result = checkRun({ resultEvent: null, processExitCode: null, timedOut: false });
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('no terminal result event'))).toBe(true);
  });

  it('fails on a wall-clock timeout regardless of process exit code', () => {
    const result = checkRun({ resultEvent: null, processExitCode: null, timedOut: true });
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('timeout'))).toBe(true);
  });

  // Claude Code is version-pinned (design D2/D5), so a missing field on the
  // result event means the pinned version's own contract changed under us —
  // that must fail loudly, never be read as "zero denials"/"zero failures"
  // (no fourth state: a check whose input is absent must fail, visibly).
  it('fails when permission_denials is not an array (missing field), not treated as zero denials', () => {
    const result = checkRun({ resultEvent: loadFixture('result-missing-permission-denials.json'), processExitCode: 0, timedOut: false });
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('permission_denials') && r.includes('missing'))).toBe(true);
  });

  it('fails when subagent_stats.failed is not a number (missing field), not treated as zero failures', () => {
    const result = checkRun({ resultEvent: loadFixture('result-missing-subagent-stats.json'), processExitCode: 0, timedOut: false });
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('subagent_stats.failed') && r.includes('missing'))).toBe(true);
  });

  // A terminal result can stop for a reason that does not set is_error (e.g.
  // hitting --max-budget-usd or a max-turns cap) — its subtype says so even
  // when everything else on the event looks clean. Treating "not is_error"
  // as "the run succeeded" would let a budget-capped, incomplete run pass
  // the run check.
  it('fails when subtype is not "success", even though is_error is false and everything else is clean', () => {
    const result = checkRun({ resultEvent: loadFixture('result-error-subtype.json'), processExitCode: 0, timedOut: false });
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('subtype') && r.includes('error_max_budget_usd'))).toBe(true);
  });

  // A real Bedrock 403 (account not subscribed to the model through AWS
  // Marketplace). Claude Code's result text leads with "AWS authentication
  // failed", which points the operator at credentials; the reason must carry
  // the provider's own message and status instead.
  it('reports the provider message and HTTP status of an api_error result', () => {
    const result = checkRun({ resultEvent: loadFixture('result-api-error.json'), processExitCode: 1, timedOut: false });
    expect(result.ok).toBe(false);
    const apiReason = result.reasons.find((r) => r.startsWith('model API error'));
    expect(apiReason).toBeDefined();
    expect(apiReason).toContain('(HTTP 403)');
    expect(apiReason).toContain('Model access is denied');
    expect(apiReason).toContain('AWS Marketplace');
    expect(apiReason).not.toContain('AWS authentication failed');
  });

  it('adds no API error reason when the result is not an API error', () => {
    const result = checkRun({ resultEvent: loadFixture('result-error-subtype.json'), processExitCode: 0, timedOut: false });
    expect(result.reasons.some((r) => r.startsWith('model API error'))).toBe(false);
  });
});

describe('describeApiError', () => {
  it('falls back to the whole result text when there is no "API Error:" marker, and truncates long messages', () => {
    const reason = describeApiError({ terminal_reason: 'api_error', result: 'x'.repeat(1000) });
    expect(reason.startsWith('model API error: ')).toBe(true);
    expect(reason.length).toBeLessThan(450);
  });

  it('returns null for a result without terminal_reason "api_error" or api_error_status', () => {
    expect(describeApiError({ terminal_reason: 'completed', result: 'API Error: nope' })).toBeNull();
    expect(describeApiError(null)).toBeNull();
  });
});
