// Slice D (full-semantic-isolation) — select-stale-semantics.mjs: which
// files' node-local semantics are missing/stale (by source hash), so Full
// mode dispatches file-analyzer only for those files. Pure-function tests
// over synthetic knowledge-graph/semantic-cache/source-manifest fixtures.
import { describe, expect, it } from 'vitest';
import { selectStaleFiles } from '../../skills/excavator/select-stale-semantics.mjs';
import {
  CANONICAL_CONTENT_LANGUAGE,
  SEMANTIC_CACHE_VERSION,
} from '../../skills/excavator/semantic-cache.mjs';
import { auditSemanticCacheFields } from '../../skills/excavator/semantic-language-audit.mjs';

function kg(paths) {
  return { nodes: paths.map((p) => ({ id: `file:${p}`, type: 'file', filePath: p })) };
}

function canonicalCache(entries) {
  return {
    version: SEMANTIC_CACHE_VERSION,
    contentLanguage: CANONICAL_CONTENT_LANGUAGE,
    entries,
  };
}

function auditedEntry(summary, semanticSourceHash) {
  const fields = { summary };
  return {
    summary,
    semanticSourceHash,
    languageAudit: auditSemanticCacheFields({ fields }),
  };
}

describe('select-stale-semantics.mjs — selectStaleFiles', () => {
  it('treats every file as stale when there is no semantic-cache yet', () => {
    const { staleFiles, freshFiles, counts } = selectStaleFiles({
      knowledgeGraph: kg(['a.ts', 'b.ts']),
      semanticCache: null,
      manifest: { entries: [{ path: 'a.ts', contentHash: 'h1' }, { path: 'b.ts', contentHash: 'h2' }] },
    });
    expect(staleFiles).toEqual(['a.ts', 'b.ts']);
    expect(freshFiles).toEqual([]);
    expect(counts).toEqual({ stale: 2, fresh: 0, total: 2 });
  });

  it('treats a file with a fresh cache entry (hash matches current manifest) as not stale', () => {
    const { staleFiles, freshFiles } = selectStaleFiles({
      knowledgeGraph: kg(['a.ts', 'b.ts']),
      semanticCache: canonicalCache({ 'file:a.ts': auditedEntry('x', 'h1') }),
      manifest: { entries: [{ path: 'a.ts', contentHash: 'h1' }, { path: 'b.ts', contentHash: 'h2' }] },
    });
    expect(freshFiles).toEqual(['a.ts']);
    expect(staleFiles).toEqual(['b.ts']);
  });

  it('a changed file (new contentHash) makes a previously-fresh file stale again', () => {
    const semanticCache = canonicalCache({ 'file:a.ts': auditedEntry('x', 'h1-old') });
    const { staleFiles, freshFiles } = selectStaleFiles({
      knowledgeGraph: kg(['a.ts']),
      semanticCache,
      manifest: { entries: [{ path: 'a.ts', contentHash: 'h1-new' }] },
    });
    expect(staleFiles).toEqual(['a.ts']);
    expect(freshFiles).toEqual([]);
  });

  it('a file is stale if ANY of its nodes lacks a fresh cache entry, even if another node is fresh', () => {
    const knowledgeGraph = {
      nodes: [
        { id: 'file:a.ts', filePath: 'a.ts' },
        { id: 'function:a.ts:run', filePath: 'a.ts' },
      ],
    };
    const semanticCache = canonicalCache({ 'file:a.ts': auditedEntry('file summary', 'h1') });
    const { staleFiles } = selectStaleFiles({
      knowledgeGraph,
      semanticCache,
      manifest: { entries: [{ path: 'a.ts', contentHash: 'h1' }] },
    });
    // file:a.ts is fresh but function:a.ts:run has no cache entry at all.
    expect(staleFiles).toEqual(['a.ts']);
  });

  it('forceAll marks every file stale regardless of cache freshness', () => {
    const semanticCache = canonicalCache({ 'file:a.ts': auditedEntry('x', 'h1') });
    const { staleFiles, freshFiles } = selectStaleFiles({
      knowledgeGraph: kg(['a.ts']),
      semanticCache,
      manifest: { entries: [{ path: 'a.ts', contentHash: 'h1' }] },
      forceAll: true,
    });
    expect(staleFiles).toEqual(['a.ts']);
    expect(freshFiles).toEqual([]);
  });

  it('treats a hash-matching entry without the canonical marker as stale', () => {
    const { staleFiles, freshFiles } = selectStaleFiles({
      knowledgeGraph: kg(['a.ts']),
      semanticCache: { version: '1.0.0', entries: { 'file:a.ts': { summary: 'x', semanticSourceHash: 'h1' } } },
      manifest: { entries: [{ path: 'a.ts', contentHash: 'h1' }] },
    });

    expect(staleFiles).toEqual(['a.ts']);
    expect(freshFiles).toEqual([]);
  });
});
