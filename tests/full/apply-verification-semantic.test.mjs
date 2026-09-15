// Slice D (full-semantic-isolation) — the Summary-Verifier's redirected
// target: prepareSemanticVerification / applySemanticVerification read and
// write semantic-cache.json entries, never a knowledge-graph.json node. Pure
// unit tests; the pre-existing prepareVerification/applyVerification (graph-
// node mode) are untouched and covered by their own existing test file.
import { describe, expect, it } from 'vitest';
import {
  prepareSemanticVerification,
  applySemanticVerification,
} from '../../skills/excavator/apply-verification.mjs';

const okClassifier = () => 'ok';

describe('apply-verification.mjs — prepareSemanticVerification', () => {
  it('selects only fact nodes with a non-empty cached summary, anchored to a real file+lineRange', () => {
    const factNodes = [
      { id: 'function:a.ts:run', filePath: 'a.ts', lineRange: [1, 3] },
      { id: 'function:a.ts:helper', filePath: 'a.ts', lineRange: [5, 7] }, // no cache entry
      { id: 'file:a.ts', filePath: 'a.ts' }, // no lineRange -> noAnchor even if cached
    ];
    const semanticCache = {
      entries: {
        'function:a.ts:run': { summary: 'Runs things.', semanticSourceHash: 'h1' },
        'file:a.ts': { summary: 'File summary.', semanticSourceHash: 'h1' },
      },
    };
    const { manifest, batches } = prepareSemanticVerification({ factNodes, semanticCache, classifyPath: okClassifier });

    expect(manifest.counts.summariesTotal).toBe(2); // run + file:a.ts have summaries
    expect(manifest.counts.candidates).toBe(1); // only run has a lineRange anchor
    expect(manifest.counts.noAnchor).toBe(1); // file:a.ts
    expect(manifest.selectedIds).toEqual(['function:a.ts:run']);
    expect(batches).toHaveLength(1);
    expect(batches[0].nodes[0]).toMatchObject({ id: 'function:a.ts:run', summary: 'Runs things.' });
  });

  it('refuses an out-of-scope path without reading it, same as the graph-based flow', () => {
    const factNodes = [{ id: 'function:a.ts:run', filePath: '../outside.ts', lineRange: [1, 2] }];
    const semanticCache = { entries: { 'function:a.ts:run': { summary: 'x', semanticSourceHash: 'h1' } } };
    const { manifest } = prepareSemanticVerification({
      factNodes, semanticCache, classifyPath: () => 'out-of-scope',
    });
    expect(manifest.counts.pathOutOfScope).toBe(1);
    expect(manifest.counts.candidates).toBe(0);
    expect(manifest.outOfScopePaths[0]).toContain('../outside.ts');
  });
});

describe('apply-verification.mjs — applySemanticVerification', () => {
  it('writes verdicts into semantic-cache entries, never into a knowledge-graph node', () => {
    const semanticCache = {
      version: '1.0.0',
      entries: {
        'function:a.ts:run': { summary: 'Runs things.', semanticSourceHash: 'h1' },
        'function:a.ts:helper': { summary: 'Helps.', semanticSourceHash: 'h1' },
      },
    };
    const manifest = { mode: 'full', selectedIds: ['function:a.ts:run', 'function:a.ts:helper'], counts: { pathOutOfScope: 0 } };
    const verdicts = [
      { id: 'function:a.ts:run', verdict: 'verified' },
      { id: 'function:a.ts:helper', verdict: 'contradicted', reason: 'source says otherwise' },
    ];

    const { semanticCache: updated, report, archive } = applySemanticVerification({ semanticCache, manifest, verdicts });

    expect(updated.entries['function:a.ts:run'].verification).toBe('verified');
    expect(updated.entries['function:a.ts:helper'].verification).toBe('contradicted');
    // The input object is not mutated in place.
    expect(semanticCache.entries['function:a.ts:run'].verification).toBeUndefined();

    expect(report.counts.verified).toBe(1);
    expect(report.counts.contradicted).toBe(1);
    expect(report.conserves).toBe(true);
    expect(archive).toHaveLength(1);
    expect(archive[0].id).toBe('function:a.ts:helper');
    expect(report.gaps.some((g) => g.kind === 'semantic-summary-contradicted')).toBe(true);
  });

  it('drops a verdict for a node id absent from semantic-cache.json, counted as unknown-node — never fabricates an entry', () => {
    const semanticCache = { entries: { 'function:a.ts:run': { summary: 'x', semanticSourceHash: 'h1' } } };
    const verdicts = [{ id: 'function:a.ts:ghost', verdict: 'verified' }];
    const { semanticCache: updated, report } = applySemanticVerification({ semanticCache, verdicts });

    expect(updated.entries['function:a.ts:ghost']).toBeUndefined();
    expect(report.counts.verdictUnknownNode).toBe(1);
    expect(report.counts.verdictsApplied).toBe(0);
  });

  it('never downgrades an existing contradicted marking with a later verified verdict', () => {
    const semanticCache = { entries: { 'function:a.ts:run': { summary: 'x', semanticSourceHash: 'h1', verification: 'contradicted' } } };
    const { semanticCache: updated, report } = applySemanticVerification({
      semanticCache, verdicts: [{ id: 'function:a.ts:run', verdict: 'verified' }],
    });
    expect(updated.entries['function:a.ts:run'].verification).toBe('contradicted');
    expect(report.counts.verificationPreserved).toBe(1);
  });
});
