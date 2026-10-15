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
import { scopePredicate } from '../../skills/excavator/project-paths.mjs';

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

  it('rejects forceAll because a fresh Full node must be reused', () => {
    const semanticCache = canonicalCache({ 'file:a.ts': auditedEntry('x', 'h1') });
    expect(() => selectStaleFiles({
      knowledgeGraph: kg(['a.ts']),
      semanticCache,
      manifest: { entries: [{ path: 'a.ts', contentHash: 'h1' }] },
      forceAll: true,
    })).toThrow(/forceAll would regenerate/);
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

describe('select-stale-semantics.mjs — --scope', () => {
  const paths = ['src/a/one.ts', 'src/a/two.ts', 'src/ab/three.ts', 'src/b/four.ts', 'root.ts'];
  const manifest = { entries: paths.map((p, i) => ({ path: p, contentHash: `h${i}` })) };

  it('plans only the nodes under the scope directory, not a sibling sharing its prefix', () => {
    const result = selectStaleFiles({ knowledgeGraph: kg(paths), semanticCache: null, manifest, scope: 'src/a' });
    expect(result.staleFiles).toEqual(['src/a/one.ts', 'src/a/two.ts']);
    expect(result.plan.generate.map((e) => e.nodeId).sort()).toEqual(['file:src/a/one.ts', 'file:src/a/two.ts']);
    expect(result.scope).toBe('src/a');
  });

  it('accepts a trailing slash and a scope naming a single file', () => {
    expect(selectStaleFiles({ knowledgeGraph: kg(paths), semanticCache: null, manifest, scope: 'src/b/' }).staleFiles)
      .toEqual(['src/b/four.ts']);
    expect(selectStaleFiles({ knowledgeGraph: kg(paths), semanticCache: null, manifest, scope: 'root.ts' }).staleFiles)
      .toEqual(['root.ts']);
  });

  it('refuses a malformed scope and a scope that matches no node', () => {
    for (const bad of ['/src', '../src', 'src/../b', './src', '', '/']) {
      expect(() => selectStaleFiles({ knowledgeGraph: kg(paths), semanticCache: null, manifest, scope: bad }))
        .toThrow(/canonical project-relative path/);
    }
    expect(() => selectStaleFiles({ knowledgeGraph: kg(paths), semanticCache: null, manifest, scope: 'lib' }))
      .toThrow(/matches no fact-graph node/);
  });

  it('scopePredicate matches the directory itself and paths below it only', () => {
    const inScope = scopePredicate('src/a');
    expect(['src/a', 'src/a/x.ts', 'src/a/deep/y.ts'].every(inScope)).toBe(true);
    expect(['src/ab/x.ts', 'src', 'other/src/a/x.ts', undefined].some(inScope)).toBe(false);
  });
});
