import { describe, expect, it } from 'vitest';

import { planFullRun, checkProduct } from '../../deploy/run-excavator.mjs';

const HEAD = 'abc1234abc1234abc1234abc1234abc1234abc1';
const OTHER = 'def5678def5678def5678def5678def5678def5';
const DIGEST = 'digest-current';
const MODEL = 'eu.anthropic.claude-sonnet-5';

// The fact graph header as the Lazy pass leaves it; Full does not rewrite it.
function factGraph(factsDigest = DIGEST) {
  return { project: { pipelineVersion: 'lazy-fact-graph/14', factsDigest } };
}
function semanticGraph(overrides = {}) {
  return { factDigest: DIGEST, model: MODEL, layers: [], ...overrides };
}
function meta(commit) {
  return { gitCommitHash: commit };
}
function plan(overrides) {
  return planFullRun({
    graph: factGraph(), semanticGraph: semanticGraph(), meta: meta(HEAD), headSha: HEAD, force: false, ...overrides,
  });
}

describe('planFullRun (skip rule, design D5)', () => {
  it('skips when the semantic graph digest matches the fact graph and the commit matches HEAD', () => {
    expect(plan({}).action).toBe('skip');
  });

  it('does not skip a Lazy-only product even when its commit matches HEAD; forces a full rebuild', () => {
    const result = plan({ semanticGraph: null });
    expect(result.action).toBe('run');
    expect(result.flag).toBe('--full');
  });

  it('does not skip when there is no existing product at all', () => {
    const result = plan({ graph: null, semanticGraph: null, meta: null });
    expect(result.action).toBe('run');
    expect(result.flag).toBe('--full');
  });

  it('uses --mode=full when the semantic graph digest differs from the fact graph', () => {
    const result = plan({ semanticGraph: semanticGraph({ factDigest: 'digest-old' }) });
    expect(result.action).toBe('run');
    expect(result.flag).toBe('--mode=full');
  });

  it('uses --mode=full when a semantic graph exists but HEAD changed', () => {
    const result = plan({ meta: meta(OTHER) });
    expect(result.action).toBe('run');
    expect(result.flag).toBe('--mode=full');
  });

  it.each([
    ['without a factDigest', { factDigest: undefined }],
    ['with an empty factDigest', { factDigest: '' }],
    ['with a non-string factDigest', { factDigest: 7 }],
  ])('a semantic graph %s is not a full product: --full, no skip', (_name, overrides) => {
    const result = plan({ semanticGraph: semanticGraph(overrides) });
    expect(result.action).toBe('run');
    expect(result.flag).toBe('--full');
  });

  it('EXCAVATOR_FORCE always uses --full and is never skipped, even with a matching full product', () => {
    const result = plan({ force: true });
    expect(result.action).toBe('run');
    expect(result.flag).toBe('--full');
  });

  it('EXCAVATOR_FORCE with a changed-HEAD full product still uses --full, not --mode=full', () => {
    const result = plan({ force: true, meta: meta(OTHER) });
    expect(result.action).toBe('run');
    expect(result.flag).toBe('--full');
  });

  it('the fact graph pipelineVersion no longer decides anything', () => {
    // An annotate-era stamp on the fact graph does not make a product Full ...
    const stamped = plan({ graph: { project: { pipelineVersion: 'excavator-annotate/1', factsDigest: DIGEST } }, semanticGraph: null });
    expect(stamped.flag).toBe('--full');
    // ... and a Lazy stamp does not hide a Full one.
    expect(plan({ graph: factGraph() }).action).toBe('skip');
  });
});

describe('checkProduct (design D1, model from semantic-graph.json)', () => {
  const check = (overrides) => checkProduct({
    semanticGraph: semanticGraph(), meta: meta(HEAD), expectedHead: HEAD, expectedModel: MODEL, ...overrides,
  });

  it('passes when commit and the semantic graph model both match', () => {
    expect(check({}).ok).toBe(true);
  });

  it('fails when meta.gitCommitHash does not match the pre-run HEAD', () => {
    const result = check({ meta: meta(OTHER) });
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('gitCommitHash'))).toBe(true);
  });

  it('fails when the recorded model is "unknown", naming semantic-graph.json', () => {
    const result = check({ semanticGraph: semanticGraph({ model: 'unknown' }) });
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('semantic-graph.json') && r.includes('model'))).toBe(true);
  });

  it('fails when the recorded model does not match the requested one, naming semantic-graph.json', () => {
    const result = check({ semanticGraph: semanticGraph({ model: 'eu.anthropic.claude-opus-4' }) });
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('semantic-graph.json'))).toBe(true);
  });

  it('fails when the semantic graph has no model, naming semantic-graph.json', () => {
    const result = check({ semanticGraph: semanticGraph({ model: undefined }) });
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('semantic-graph.json'))).toBe(true);
  });

  it('fails when the semantic graph is missing or unreadable (null), naming semantic-graph.json', () => {
    const result = check({ semanticGraph: null });
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('semantic-graph.json'))).toBe(true);
  });

  it('ignores project.model of the fact graph', () => {
    const result = check({ graph: { project: { model: MODEL } }, semanticGraph: null });
    expect(result.ok).toBe(false);
  });
});
