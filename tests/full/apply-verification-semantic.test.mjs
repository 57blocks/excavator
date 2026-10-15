// Slice D (full-semantic-isolation) — the Summary-Verifier's redirected
// target: prepareSemanticVerification / applySemanticVerification read and
// write semantic-cache.json entries, never a knowledge-graph.json node. Pure
// unit tests; the pre-existing prepareVerification/applyVerification (graph-
// node mode) are untouched and covered by their own existing test file.
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  prepareSemanticVerification,
  applySemanticVerification,
  readVerdictFiles,
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

  it('selects only entries without a verdict, so a re-run verifies only what is left', () => {
    const ids = ['verified', 'unverified', 'contradicted', 'dirty', 'none'];
    const factNodes = ids.map((v, i) => ({ id: `function:a.ts:${v}`, filePath: 'a.ts', lineRange: [i + 1, i + 1] }));
    const entries = {};
    for (const v of ids) {
      entries[`function:a.ts:${v}`] = { summary: `S ${v}.`, ...(v === 'none' ? {} : { verification: v }) };
    }
    const { manifest } = prepareSemanticVerification({
      factNodes, semanticCache: { entries }, classifyPath: okClassifier,
    });
    expect(manifest.selectedIds).toEqual(['function:a.ts:dirty', 'function:a.ts:none']);
    expect(manifest.counts.alreadyChecked).toBe(3);
    expect(manifest.counts.summariesTotal).toBe(5);
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

describe('apply-verification.mjs — per-batch commit and the closing apply', () => {
  const entry = (summary, verification) => ({ summary, semanticSourceHash: 'h1', ...(verification ? { verification } : {}) });

  it('a batch commit writes only the ids its batch lists and leaves unanswered ones unmarked', () => {
    const semanticCache = { entries: { 'n:a': entry('A.'), 'n:b': entry('B.'), 'n:c': entry('C.') } };
    const { semanticCache: updated, report } = applySemanticVerification({
      semanticCache,
      batchIds: ['n:a', 'n:b'],
      verdicts: [
        { id: 'n:a', verdict: 'verified' },
        { id: 'n:c', verdict: 'contradicted', reason: 'stale file' },
      ],
    });
    expect(updated.entries['n:a'].verification).toBe('verified');
    expect(updated.entries['n:b'].verification).toBeUndefined(); // re-selected next run, not unverified
    expect(updated.entries['n:c'].verification).toBeUndefined(); // not in this batch
    expect(report.counts.verdictNotSelected).toBe(1);
    expect(report.counts.verdictMissing).toBe(0);
    expect(report.gaps.some((g) => g.kind === 'semantic-summary-verdict-not-selected')).toBe(true);
  });

  it('the closing apply accepts only selected ids, so an old verdict cannot land on a regenerated summary', () => {
    // n:old was regenerated earlier and is not in this run's selection; a
    // verdict for it can only come from a file some other run left behind.
    const semanticCache = { entries: { 'n:new': entry('New.'), 'n:old': entry('Regenerated.') } };
    const manifest = { mode: 'full', selectedIds: ['n:new'], batches: [{ batchIndex: 0, nodeCount: 1 }], counts: {} };
    const { semanticCache: updated, report } = applySemanticVerification({
      semanticCache, manifest,
      verdicts: [{ id: 'n:old', verdict: 'contradicted', reason: 'about the previous text' }],
    });
    expect(updated.entries['n:old'].verification).toBeUndefined();
    expect(updated.entries['n:new'].verification).toBe('unverified'); // selected, no verdict
    expect(report.counts.verdictNotSelected).toBe(1);
    expect(report.counts.verdictMissing).toBe(1);
  });

  it('gaps count markings already in the cache, not only this call\'s verdicts', () => {
    const semanticCache = { entries: { 'n:a': entry('A.', 'contradicted'), 'n:b': entry('B.', 'unverified') } };
    const { report } = applySemanticVerification({ semanticCache, manifest: { selectedIds: [], batches: [] } });
    const kinds = Object.fromEntries(report.gaps.map((g) => [g.kind, g.count]));
    expect(kinds['semantic-summary-contradicted']).toBe(1);
    expect(kinds['semantic-summary-unverified']).toBe(1);
  });

  it('carries earlier contradicted records forward only while the entry still holds that summary', () => {
    // n:redone was regenerated and its new text also judged contradicted:
    // the old record's reason is about text the entry no longer holds.
    const semanticCache = { entries: { 'n:kept': entry('Same.', 'contradicted'), 'n:redone': entry('New text.', 'contradicted') } };
    const previousArchive = [
      { id: 'n:kept', summary: 'Same.', reason: 'r1' },
      { id: 'n:redone', summary: 'Old text.', reason: 'r2' },
    ];
    const { archive } = applySemanticVerification({ semanticCache, batchIds: [], previousArchive });
    expect(archive).toEqual([{ id: 'n:kept', summary: 'Same.', reason: 'r1' }]);
  });

  it('reads only the verdict files of the requested batch indices', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verdict-files-'));
    writeFileSync(join(dir, 'summary-verdicts-0.json'), JSON.stringify({ verdicts: [{ id: 'n:a', verdict: 'verified' }] }));
    writeFileSync(join(dir, 'summary-verdicts-7.json'), JSON.stringify({ verdicts: [{ id: 'n:b', verdict: 'verified' }] }));
    expect(readVerdictFiles(dir, { indices: [0] }).files).toEqual(['summary-verdicts-0.json']);
    expect(readVerdictFiles(dir).files).toEqual(['summary-verdicts-0.json', 'summary-verdicts-7.json']);
  });
});
