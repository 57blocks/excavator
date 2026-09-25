// Slice A / Task 2 — deterministic Fact Builder contract
// (openspec: changes/lazy-first-run/specs/fact-graph).
//
// build-fact-graph.mjs is a PROJECTION of already-produced JSON
// (scan-result.json + structure-all.json + import-map.json) — it must call no
// model and re-parse no source. These fixtures are small, synthetic, in-memory
// objects shaped exactly like the real scripts' output (see
// extract-structure-result.mjs's buildResult() and extract-import-map.mjs's
// output for the authoritative row shapes); no CLI process is spawned.
import { describe, expect, it } from 'vitest';
import { buildFactGraph } from '../../skills/excavator/build-fact-graph.mjs';
import { conservationViolations } from '../../skills/excavator/coverage-ledger.mjs';
import { canonicalizeForDigest, sha256Hex } from '../../skills/excavator/fact-graph-resolve.mjs';

// ---------------------------------------------------------------------------
// Fixture: a small two-file project with one uniquely-resolvable call, one
// unresolvable call, a parse-failed file, a scan-time-skipped binary, a
// complexity spread (file- and declaration-level), and an identity collision.
// ---------------------------------------------------------------------------
function baseFixture() {
  const scan = {
    files: [
      { path: 'src/a.ts', language: 'typescript', sizeLines: 5, fileCategory: 'code' },
      { path: 'src/b.ts', language: 'typescript', sizeLines: 5, fileCategory: 'code' },
      { path: 'src/broken.ts', language: 'typescript', sizeLines: 10, fileCategory: 'code' },
      { path: 'src/big.ts', language: 'typescript', sizeLines: 260, fileCategory: 'code' },
      { path: 'src/collide.ts', language: 'typescript', sizeLines: 30, fileCategory: 'code' },
    ],
    skipped: [{ path: 'bin/native.dll', reason: 'binary', language: 'unknown' }],
    coverage: { limits: { maxFileLines: 20000, maxFileBytes: 2097152 } },
  };

  const structureAll = {
    results: [
      {
        path: 'src/a.ts', language: 'typescript', fileCategory: 'code',
        totalLines: 5, nonEmptyLines: 5, status: 'parsed',
        functions: [{ name: 'run', owner: '', startLine: 1, endLine: 4, params: ['x'] }],
        imports: [{ source: './b', specifiers: ['helper'], line: 1 }],
        exports: [{ name: 'run', line: 2, isDefault: false }],
        callGraph: [
          { caller: 'run', callee: 'helper', lineNumber: 3 },
          { caller: 'run', callee: 'ghost', lineNumber: 4 },
        ],
        metrics: {},
      },
      {
        path: 'src/b.ts', language: 'typescript', fileCategory: 'code',
        totalLines: 5, nonEmptyLines: 5, status: 'parsed',
        functions: [{ name: 'helper', owner: '', startLine: 1, endLine: 5, params: [] }],
        exports: [{ name: 'helper', line: 1, isDefault: false }],
        metrics: {},
      },
      {
        path: 'src/broken.ts', language: 'typescript', fileCategory: 'code',
        totalLines: 10, nonEmptyLines: 8, status: 'parse-failed',
        statusReason: 'extractor-error-or-invalid-output',
        metrics: {},
      },
      {
        path: 'src/big.ts', language: 'typescript', fileCategory: 'code',
        totalLines: 260, nonEmptyLines: 60, status: 'parsed',
        functions: [
          { name: 'small', owner: '', startLine: 1, endLine: 10, params: [] }, // span 10 -> simple
          { name: 'huge', owner: '', startLine: 20, endLine: 269, params: [] }, // span 250 -> complex
        ],
        metrics: {},
      },
      {
        path: 'src/collide.ts', language: 'typescript', fileCategory: 'code',
        totalLines: 30, nonEmptyLines: 30, status: 'parsed',
        functions: [
          { name: 'save', owner: 'Repo', startLine: 1, endLine: 5, params: [] },
          { name: 'save', owner: 'Repo', startLine: 20, endLine: 25, params: [] },
        ],
        metrics: {},
      },
    ],
  };

  const importMap = {
    importMap: {
      'src/a.ts': ['src/b.ts'],
      'src/b.ts': [],
      'src/broken.ts': [],
      'src/big.ts': [],
      'src/collide.ts': [],
    },
    unresolved: {},
  };

  return { scan, structureAll, importMap };
}

describe('zero-model determinism', () => {
  it('same input, run twice, produces an identical projection (incl. factsDigest)', () => {
    const { scan, structureAll, importMap } = baseFixture();
    const first = buildFactGraph({ scan, structureAll, importMap });
    const second = buildFactGraph({
      scan: JSON.parse(JSON.stringify(scan)),
      structureAll: JSON.parse(JSON.stringify(structureAll)),
      importMap: JSON.parse(JSON.stringify(importMap)),
    });
    expect(second).toEqual(first);
    expect(second.factsDigest).toBe(first.factsDigest);
  });

  it('factsDigest excludes run metadata: unrelated fields differ, same facts -> same digest', () => {
    const a = baseFixture();
    const b = baseFixture();
    // Fields build-fact-graph never reads, standing in for "run metadata"
    // (timestamp, model name, sourceRevision) that a real run would carry.
    a.scan.contentDigest = 'run-A-content-hash';
    b.scan.contentDigest = 'run-B-content-hash';
    a.structureAll.chunkSize = 400;
    b.structureAll.chunkSize = 100;
    a.structureAll.scriptCompleted = true;
    b.structureAll.someUnrelatedRunField = 'model-name-or-timestamp';

    const pa = buildFactGraph(a);
    const pb = buildFactGraph(b);
    expect(pb.factsDigest).toBe(pa.factsDigest);
    expect(pb.nodes).toEqual(pa.nodes);
    expect(pb.edges).toEqual(pa.edges);
  });

  // openspec: changes/product-serialization-ceiling, task 4.3 — the digest
  // input string is now built via serializeJsonProduct('facts-digest-input',
  // ..., {indent: 0}) instead of a bare JSON.stringify. The digest VALUE
  // must be unchanged: reconstructs the pre-change formula independently
  // (from the public return value: `digestCoverage` is a deep clone of
  // `coverage` with `.selection` deleted and the three pre-extraction skip
  // reasons pruned per language, exactly mirroring build-fact-graph.mjs's own
  // — otherwise-private — steps) and compares against the real factsDigest.
  it('factsDigest is byte-identical to the pre-change JSON.stringify + sha256Hex formula', () => {
    const { scan, structureAll, importMap } = baseFixture();
    const result = buildFactGraph({ scan, structureAll, importMap });

    const digestCoverage = JSON.parse(JSON.stringify(result.coverage));
    delete digestCoverage.selection;
    let preExtractionFiles = 0;
    let preExtractionIgnored = 0;
    for (const row of Object.values(digestCoverage.byLanguage ?? {})) {
      for (const reason of ['filtered-by-defaults', 'filtered-by-ignore', 'sensitive']) {
        const count = row.skipped?.[reason] ?? 0;
        preExtractionFiles += count;
        if (reason !== 'sensitive') preExtractionIgnored += count;
        if (row.skipped) delete row.skipped[reason];
        row.files -= count;
      }
    }
    for (const [language, row] of Object.entries(digestCoverage.byLanguage ?? {})) {
      if (row.files === 0) delete digestCoverage.byLanguage[language];
    }
    digestCoverage.files -= preExtractionFiles;
    digestCoverage.ignored = Math.max(0, (digestCoverage.ignored ?? 0) - preExtractionIgnored);

    const preChangeDigest = sha256Hex(
      JSON.stringify(canonicalizeForDigest({ nodes: result.nodes, edges: result.edges, coverage: digestCoverage, gaps: result.gaps })),
    );
    expect(result.factsDigest).toBe(preChangeDigest);
  });
});

describe('calls resolution — unique resolves to an edge, unresolvable becomes a gap', () => {
  it('a uniquely-resolvable call produces a calls edge with evidence', () => {
    const { scan, structureAll, importMap } = baseFixture();
    const { edges } = buildFactGraph({ scan, structureAll, importMap });

    const callEdge = edges.find(
      (e) => e.type === 'calls' && e.target.includes(':src/b.ts:') && e.target.includes('helper'),
    );
    expect(callEdge).toBeDefined();
    expect(callEdge.source).toContain('src/a.ts');
    expect(callEdge.source).toContain('run');
    expect(callEdge.provenance).toBe('extracted');
    expect(callEdge.evidence).toEqual([{ file: 'src/a.ts', line: 3, source: 'tree-sitter' }]);
  });

  it('an unresolvable call produces NO edge and is recorded as a gap', () => {
    const { scan, structureAll, importMap } = baseFixture();
    const { edges, gaps } = buildFactGraph({ scan, structureAll, importMap });

    expect(edges.some((e) => e.type === 'calls' && e.target.includes('ghost'))).toBe(false);
    const gap = gaps.find((g) => g.kind === 'calls-unresolved');
    expect(gap).toBeDefined();
    expect(gap.count).toBeGreaterThanOrEqual(1);
    expect(gap.samples.some((s) => s.includes('ghost'))).toBe(true);
  });
});

describe('coverage ledger — every scanned input lands in one bucket', () => {
  it('a parse-failed file is a visible gap with a reason, not silently dropped', () => {
    const { scan, structureAll, importMap } = baseFixture();
    const { gaps, coverage } = buildFactGraph({ scan, structureAll, importMap });

    const gap = gaps.find((g) => g.kind === 'parse-failed');
    expect(gap).toBeDefined();
    expect(gap.reason).toMatch(/typescript/);
    expect(gap.samples).toContain('src/broken.ts');
    expect(coverage.byLanguage.typescript.skipped['parse-failed']).toBe(1);
  });

  it('conserves files = parsed + zeroSymbol + skipped, across scan-time and structure-time buckets', () => {
    const { scan, structureAll, importMap } = baseFixture();
    const { coverage } = buildFactGraph({ scan, structureAll, importMap });

    expect(conservationViolations(coverage)).toEqual([]);
    expect(coverage.files).toBe(scan.files.length + scan.skipped.length);
  });

  it('a parse-failed file still gets a file fact node — it was read, just not parsed', () => {
    const { scan, structureAll, importMap } = baseFixture();
    const { nodes } = buildFactGraph({ scan, structureAll, importMap });
    const brokenFileNode = nodes.find((n) => n.type === 'file' && n.filePath === 'src/broken.ts');
    expect(brokenFileNode).toBeDefined();
    expect(brokenFileNode.anchorSource).toBe('census');
  });
});

describe('name-only class methods — visible gap, not silent', () => {
  it('a TS class method listed by name only (no line range) becomes a visible gap', () => {
    const scan = { files: [{ path: 'svc.ts', language: 'typescript', fileCategory: 'code' }] };
    const structureAll = {
      results: [{
        path: 'svc.ts', language: 'typescript', fileCategory: 'code',
        totalLines: 12, nonEmptyLines: 10, status: 'parsed',
        functions: [],
        classes: [{ name: 'Svc', startLine: 1, endLine: 12, methods: ['save', 'load'], properties: [] }],
        metrics: {},
      }],
    };
    const { nodes, gaps } = buildFactGraph({ scan, structureAll, importMap: null });
    expect(nodes.some((n) => n.type === 'class' && n.name === 'Svc')).toBe(true);
    // methods listed by name only are NOT invented as nodes ...
    expect(nodes.some((n) => n.type === 'function' && (n.name === 'save' || n.name === 'load'))).toBe(false);
    // ... but they are NOT silent either — a visible gap accounts for both.
    const gap = gaps.find((g) => g.kind === 'methods-name-only');
    expect(gap).toBeDefined();
    expect(gap.count).toBe(2);
    expect(gap.samples.some((s) => s.includes('Svc.save'))).toBe(true);
  });

  it('owner-carrying methods in functions[] (Go/Rust/C++) are projected, not falsely gapped', () => {
    const scan = { files: [{ path: 'repo.go', language: 'go', fileCategory: 'code' }] };
    const structureAll = {
      results: [{
        path: 'repo.go', language: 'go', fileCategory: 'code',
        totalLines: 10, nonEmptyLines: 9, status: 'parsed',
        functions: [{ name: 'Save', owner: 'Repo', startLine: 3, endLine: 6, params: [] }],
        classes: [{ name: 'Repo', startLine: 1, endLine: 10, methods: ['Save'], properties: [] }],
        metrics: {},
      }],
    };
    const { nodes, gaps, edges } = buildFactGraph({ scan, structureAll, importMap: null });
    expect(nodes.some((n) => n.type === 'function' && n.name === 'Save' && n.owner === 'Repo')).toBe(true);
    expect(gaps.some((g) => g.kind === 'methods-name-only')).toBe(false);
    expect(edges.some((e) => e.type === 'contains' && e.source.includes('class:repo.go:Repo'))).toBe(true);
  });
});

describe('complexity — fixed thresholds by non-blank line count, no model', () => {
  it('file-level complexity uses structure-all\'s exact nonEmptyLines', () => {
    const { scan, structureAll, importMap } = baseFixture();
    const { nodes } = buildFactGraph({ scan, structureAll, importMap });
    const bigFile = nodes.find((n) => n.type === 'file' && n.filePath === 'src/big.ts');
    // nonEmptyLines: 60 -> moderate (50-200)
    expect(bigFile.complexity).toBe('moderate');
    const aFile = nodes.find((n) => n.type === 'file' && n.filePath === 'src/a.ts');
    // nonEmptyLines: 5 -> simple (<50)
    expect(aFile.complexity).toBe('simple');
  });

  it('declaration-level complexity buckets by line span: <50 simple, 50-200 moderate, >200 complex', () => {
    const { scan, structureAll, importMap } = baseFixture();
    const { nodes } = buildFactGraph({ scan, structureAll, importMap });
    const small = nodes.find((n) => n.type === 'function' && n.name === 'small');
    const huge = nodes.find((n) => n.type === 'function' && n.name === 'huge');
    expect(small.complexity).toBe('simple'); // span 10
    expect(huge.complexity).toBe('complex'); // span 250
  });
});

describe('Lazy schema — empty/deterministic semantic fields, nothing model-written', () => {
  it('every fact node has empty summary/tags and no verification field', () => {
    const { scan, structureAll, importMap } = baseFixture();
    const { nodes } = buildFactGraph({ scan, structureAll, importMap });
    for (const node of nodes) {
      expect(node.summary).toBe('');
      expect(node.tags).toEqual([]);
      expect(node.verification).toBeUndefined();
    }
    // Note: the fact-graph spec scenario also says "...and layers"; GraphNode
    // (packages/core/src/types.ts) has no per-node `layers` field — layers are
    // a graph-level grouping produced by the Full pipeline's Architecture
    // phase, which Lazy skips entirely (design D4). build-fact-graph's return
    // value carries no `layers` key at all, so there is nothing model-written
    // to assert on beyond the per-node fields above.
  });
});

describe('identity collisions — surfaced, never silently merged', () => {
  it('two distinguishable same-id declarations produce one gap and exactly one node', () => {
    const { scan, structureAll, importMap } = baseFixture();
    const { nodes, gaps } = buildFactGraph({ scan, structureAll, importMap });

    const collisionId = 'function:src/collide.ts:Repo#save()';
    const matchingNodes = nodes.filter((n) => n.id === collisionId);
    expect(matchingNodes).toHaveLength(1);

    const gap = gaps.find((g) => g.kind === 'identity-collision' && g.scope === collisionId);
    expect(gap).toBeDefined();
    expect(gap.count).toBe(2);
    expect(gap.samples).toContain('src/collide.ts:1-5');
    expect(gap.samples).toContain('src/collide.ts:20-25');
  });
});

describe('exports and imports edges', () => {
  it('a resolvable export produces a file -> declaration exports edge', () => {
    const { scan, structureAll, importMap } = baseFixture();
    const { edges } = buildFactGraph({ scan, structureAll, importMap });
    const exportEdge = edges.find((e) => e.type === 'exports' && e.source.includes('src/b.ts') && e.target.includes('helper'));
    expect(exportEdge).toBeDefined();
    expect(exportEdge.evidence[0]).toEqual({ file: 'src/b.ts', line: 1, source: 'tree-sitter' });
  });

  it('import-map produces a file -> file imports edge with a cited line', () => {
    const { scan, structureAll, importMap } = baseFixture();
    const { edges } = buildFactGraph({ scan, structureAll, importMap });
    const importEdge = edges.find((e) => e.type === 'imports' && e.source.includes('src/a.ts') && e.target.includes('src/b.ts'));
    expect(importEdge).toBeDefined();
    expect(importEdge.evidence).toEqual([{ file: 'src/a.ts', line: 1, source: 'import-map' }]);
  });
});

describe('contains edges', () => {
  it('every function/class is contained by its file', () => {
    const { scan, structureAll, importMap } = baseFixture();
    const { edges, nodes } = buildFactGraph({ scan, structureAll, importMap });
    const runNode = nodes.find((n) => n.type === 'function' && n.name === 'run');
    const containsEdge = edges.find(
      (e) => e.type === 'contains' && e.source === 'file:src/a.ts' && e.target === runNode.id,
    );
    expect(containsEdge).toBeDefined();
    expect(containsEdge.provenance).toBe('extracted');
  });
});
