import { describe, expect, it } from 'vitest';

import { planFullRun, checkProduct, PIPELINE_VERSION } from '../../deploy/run-excavator.mjs';

const HEAD = 'abc1234abc1234abc1234abc1234abc1234abc1';
const OTHER = 'def5678def5678def5678def5678def5678def5';
const LAZY_PIPELINE_VERSION = 'lazy-fact-graph/2';

function fullGraph(commit) {
  return { project: { pipelineVersion: PIPELINE_VERSION } };
}
function fullMeta(commit) {
  return { gitCommitHash: commit };
}

describe('planFullRun (skip rule, design D3/D4, task 2.3/2.5)', () => {
  it('skips when a full product already matches HEAD and force is not set', () => {
    const plan = planFullRun({ graph: fullGraph(HEAD), meta: fullMeta(HEAD), headSha: HEAD, force: false, pipelineVersion: PIPELINE_VERSION });
    expect(plan.action).toBe('skip');
  });

  it('does not skip a Lazy-only product even when its commit matches HEAD; forces a full rebuild', () => {
    const graph = { project: { pipelineVersion: LAZY_PIPELINE_VERSION } };
    const meta = { gitCommitHash: HEAD };
    const plan = planFullRun({ graph, meta, headSha: HEAD, force: false, pipelineVersion: PIPELINE_VERSION });
    expect(plan.action).toBe('run');
    expect(plan.flag).toBe('--full');
  });

  it('does not skip when there is no existing product at all', () => {
    const plan = planFullRun({ graph: null, meta: null, headSha: HEAD, force: false, pipelineVersion: PIPELINE_VERSION });
    expect(plan.action).toBe('run');
    expect(plan.flag).toBe('--full');
  });

  it('uses --mode=full when a full product exists but HEAD changed', () => {
    const plan = planFullRun({ graph: fullGraph(OTHER), meta: fullMeta(OTHER), headSha: HEAD, force: false, pipelineVersion: PIPELINE_VERSION });
    expect(plan.action).toBe('run');
    expect(plan.flag).toBe('--mode=full');
  });

  it('EXCAVATOR_FORCE always uses --full and is never skipped, even with a matching full product', () => {
    const plan = planFullRun({ graph: fullGraph(HEAD), meta: fullMeta(HEAD), headSha: HEAD, force: true, pipelineVersion: PIPELINE_VERSION });
    expect(plan.action).toBe('run');
    expect(plan.flag).toBe('--full');
  });

  it('EXCAVATOR_FORCE with a changed-HEAD full product still uses --full, not --mode=full', () => {
    const plan = planFullRun({ graph: fullGraph(OTHER), meta: fullMeta(OTHER), headSha: HEAD, force: true, pipelineVersion: PIPELINE_VERSION });
    expect(plan.action).toBe('run');
    expect(plan.flag).toBe('--full');
  });
});

describe('checkProduct (task 2.3, design D4 "产物")', () => {
  it('passes when commit and model both match', () => {
    const result = checkProduct({
      graph: { project: { model: 'eu.anthropic.claude-sonnet-5' } },
      meta: { gitCommitHash: HEAD },
      expectedHead: HEAD, expectedModel: 'eu.anthropic.claude-sonnet-5',
    });
    expect(result.ok).toBe(true);
  });

  it('fails when meta.gitCommitHash does not match the pre-run HEAD', () => {
    const result = checkProduct({
      graph: { project: { model: 'eu.anthropic.claude-sonnet-5' } },
      meta: { gitCommitHash: OTHER },
      expectedHead: HEAD, expectedModel: 'eu.anthropic.claude-sonnet-5',
    });
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('gitCommitHash'))).toBe(true);
  });

  it('fails when the recorded model is "unknown"', () => {
    const result = checkProduct({
      graph: { project: { model: 'unknown' } },
      meta: { gitCommitHash: HEAD },
      expectedHead: HEAD, expectedModel: 'eu.anthropic.claude-sonnet-5',
    });
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('model'))).toBe(true);
  });

  it('fails when the recorded model does not match the requested one', () => {
    const result = checkProduct({
      graph: { project: { model: 'eu.anthropic.claude-opus-4' } },
      meta: { gitCommitHash: HEAD },
      expectedHead: HEAD, expectedModel: 'eu.anthropic.claude-sonnet-5',
    });
    expect(result.ok).toBe(false);
  });
});
