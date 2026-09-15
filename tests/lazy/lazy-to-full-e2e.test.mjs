// Slice E / Task 3.1 (openspec: changes/lazy-mode-completion) — a single
// synthetic end-to-end spine proving Lazy first run -> structural retrieval
// -> on-demand semantics -> Full -> Domain freshness are actually WIRED
// together over one project, not just individually correct in isolation.
//
// This is a thin spine, not a re-test of each stage's own deep behavior —
// every stage's own suite already owns that:
//   - Lazy first run (zero-model, no batch/HTML/Tour, determinism):
//     tests/lazy/lazy-analyze.test.mjs
//   - source-index chunking/BM25/incremental rebuild, retrieval merge/
//     traversal mechanics: tests/retrieval/build-source-index.test.mjs,
//     tests/retrieval/retrieve.test.mjs
//   - semantic-cache field whitelist/CAS/lock/staleness:
//     tests/semantic-cache/semantic-cache.test.mjs
//   - Full's Phase F CLI sequence (select-stale-semantics -> apply-semantic-
//     patches -> semantic-graph write/check/merge-gaps):
//     tests/full/full-cli-pipeline.test.mjs
//   - fact-field byte-stability + factsDigest parity across Lazy/Full, and
//     the factDigest reuse/rebuild gate: tests/full/full-semantic-isolation.test.mjs
//   - domain-graph.json freshness gate (every mismatch reason, CLI shape):
//     tests/domain/domain-freshness.test.mjs
//
// What THIS file asserts that none of those do alone: the SAME project,
// carried through all five stages in one run, with the cross-stage
// invariants that prove they compose — most importantly that
// knowledge-graph.json's fact fields never move, from the very first Lazy
// run all the way through a completed Full semantic write, and that the
// on-demand cache entry a structural-then-semantic question created is the
// SAME entry Full later reuses rather than recomputes.
//
// Purpose-built synthetic fixture only (AGENTS.md: no real-project source).
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { runLazyAnalysis } from '../../skills/excavator/lazy-analyze.mjs';
import { bm25Search, mergeCandidates } from '../../skills/excavator/retrieve.mjs';
import { applySemanticPatches } from '../../skills/excavator/apply-semantic-patches.mjs';
import { selectStaleFiles } from '../../skills/excavator/select-stale-semantics.mjs';
import { isFresh } from '../../skills/excavator/semantic-cache.mjs';
import {
  buildSemanticGraph,
  writeSemanticGraph,
  readSemanticGraph,
  resolveArchitectureAction,
  collectFactNodeIds,
} from '../../skills/excavator/semantic-graph.mjs';
import { annotateDomain } from '../../skills/excavator-domain/annotate-domain.mjs';
import { resolveDomainFreshness } from '../../skills/excavator-domain/domain-freshness.mjs';

const FIXED_NOW = () => '2024-01-01T00:00:00.000Z';

function makeFixtureProject() {
  const root = mkdtempSync(join(tmpdir(), 'lazy-to-full-e2e-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'e2e-fixture', description: 'lazy-to-full spine' }, null, 2));
  mkdirSync(join(root, 'src'));
  writeFileSync(
    join(root, 'src', 'a.ts'),
    "import { helper } from './b';\n\nexport function run(): void {\n  helper();\n}\n",
  );
  writeFileSync(
    join(root, 'src', 'b.ts'),
    "export function helper(): void {\n  console.log('hi');\n}\n",
  );
  return root;
}

function sha256OfFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

describe('Lazy -> structural retrieval -> on-demand semantics -> Full -> Domain freshness (synthetic spine)', () => {
  let root;
  let dataDir;
  beforeEach(() => {
    root = makeFixtureProject();
    dataDir = join(root, '.excavator');
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('wires every stage together over one project without ever letting semantics leak back into the fact graph', async () => {
    // ── 1. Lazy first run ────────────────────────────────────────────────
    const lazyResult = await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    expect(lazyResult.saveError).toBeNull();

    expect(existsSync(join(dataDir, 'knowledge-graph.json'))).toBe(true);
    expect(existsSync(join(dataDir, 'source-index.json'))).toBe(true);
    expect(existsSync(join(dataDir, 'source-manifest.json'))).toBe(true);
    // No semantic products, no LLM batch file yet. The DEEP proof (zero
    // subagent-name tokens in the driver, forced-empty tour/layers, etc.) is
    // owned by tests/lazy/lazy-analyze.test.mjs; this is the wiring-level
    // check that THIS run — the one whose fact graph the rest of this test
    // builds on — produced none of them either.
    expect(existsSync(join(dataDir, 'semantic-cache.json'))).toBe(false);
    expect(existsSync(join(dataDir, 'semantic-graph.json'))).toBe(false);
    expect(existsSync(join(dataDir, 'intermediate', 'batches.json'))).toBe(false);

    const graph = readJson(join(dataDir, 'knowledge-graph.json'));
    expect(graph.tour).toEqual([]);
    const runNode = graph.nodes.find((n) => n.type === 'function' && n.name === 'run');
    const helperNode = graph.nodes.find((n) => n.type === 'function' && n.name === 'helper');
    expect(runNode).toBeDefined();
    expect(helperNode).toBeDefined();

    const factHashAfterLazy = sha256OfFile(join(dataDir, 'knowledge-graph.json'));

    // ── 2. A structural question stays structural ──────────────────────────
    // "Where is `run`?" is answered from source-index.json + the fact graph
    // alone. bm25Search/mergeCandidates' own ranking behavior is unit-tested
    // in tests/retrieval/*; what's owned HERE is that running them over
    // THIS project's real, on-disk source-index.json still resolves to the
    // right fact node (source-index and fact-graph node ids must agree —
    // build-source-index.mjs's own header names this as a design invariant,
    // not merely a coincidence) and creates no semantic product as a side
    // effect.
    const sourceIndex = readJson(join(dataDir, 'source-index.json'));
    const bm25Hits = bm25Search(sourceIndex, ['run'], 5);
    expect(bm25Hits.length).toBeGreaterThan(0);
    expect(bm25Hits[0].chunk?.nodeId).toBe(runNode.id);

    const exactCandidate = { nodeId: runNode.id, path: runNode.filePath, symbol: 'run' };
    const merged = mergeCandidates({
      exact: [exactCandidate],
      bm25: bm25Hits.map((h) => ({ nodeId: h.chunk?.nodeId, score: h.score })),
    });
    expect(merged[0].nodeId).toBe(runNode.id);
    expect(existsSync(join(dataDir, 'semantic-cache.json'))).toBe(false); // still no semantic product

    // ── 3. On-demand semantics for ONE node ─────────────────────────────────
    const manifest = readJson(join(dataDir, 'source-manifest.json'));
    const hashOf = (p) => manifest.entries.find((e) => e.path === p).contentHash;
    const factNodeIds = collectFactNodeIds(graph);

    const onDemandPatch = await applySemanticPatches({
      projectRoot: root,
      factNodeIds,
      patches: [{
        nodeId: runNode.id,
        filePath: 'src/a.ts',
        summary: 'Runs the app entry point.',
        tags: ['entrypoint'],
        semanticSourceHash: hashOf('src/a.ts'),
      }],
    });
    expect(onDemandPatch.committed).toBe(1);
    expect(existsSync(join(dataDir, 'semantic-cache.json'))).toBe(true);
    expect(existsSync(join(dataDir, 'semantic-graph.json'))).toBe(false); // Full-only product, still absent

    const cacheAfterOnDemand = readJson(join(dataDir, 'semantic-cache.json'));
    expect(cacheAfterOnDemand.entries[runNode.id].summary).toBe('Runs the app entry point.');

    // The load-bearing invariant of the whole design (plan §4.4, "physical
    // product boundary"): an on-demand semantic write lands ONLY in
    // semantic-cache.json — knowledge-graph.json's fact fields never move.
    expect(sha256OfFile(join(dataDir, 'knowledge-graph.json'))).toBe(factHashAfterLazy);

    // "a second lookup reuses the cached entry, no re-generation": the
    // node's cache entry is fresh against the CURRENT manifest hash.
    expect(isFresh(cacheAfterOnDemand.entries[runNode.id], hashOf('src/a.ts'), cacheAfterOnDemand)).toBe(true);

    // ── 4. Full: the Phase F semantic sequence ──────────────────────────────
    // select-stale-semantics.mjs decides FILE-level dispatch: a.ts still
    // carries an un-cached FILE node (only its `run` function node was
    // patched on demand), so both files remain in its list — that is correct
    // file-dispatch behavior, not a bug (a file's own summary and its
    // declarations' summaries are tracked as separate fact nodes; see
    // node-identity's file-vs-declaration node split). The node-granularity
    // "no re-generation" guarantee proven above (via `isFresh`) is what
    // actually matters for step 3-4's dedup story; this call only proves the
    // wiring — that Full's own dispatch step runs against this project's
    // real cache/manifest and produces the expected file set.
    const staleBeforeFull = selectStaleFiles({ knowledgeGraph: graph, semanticCache: cacheAfterOnDemand, manifest });
    expect(staleBeforeFull.staleFiles).toContain('src/a.ts');
    expect(staleBeforeFull.staleFiles).toContain('src/b.ts');

    const fullPatch = await applySemanticPatches({
      projectRoot: root,
      factNodeIds,
      patches: [{
        nodeId: helperNode.id,
        filePath: 'src/b.ts',
        summary: 'Says hi.',
        semanticSourceHash: hashOf('src/b.ts'),
      }],
    });
    expect(fullPatch.committed).toBe(1);

    const { semanticGraph } = buildSemanticGraph({
      factDigest: graph.project.factsDigest,
      factNodeIds,
      layers: [{ id: 'layer:app', name: 'App', description: 'application code', nodeIds: [runNode.id, helperNode.id] }],
      generatedAt: FIXED_NOW(),
    });
    writeSemanticGraph(dataDir, semanticGraph);

    expect(existsSync(join(dataDir, 'semantic-graph.json'))).toBe(true);
    const onDisk = readSemanticGraph(dataDir);
    expect(onDisk.factDigest).toBe(graph.project.factsDigest);
    expect(onDisk.layers[0].nodeIds.slice().sort()).toEqual([runNode.id, helperNode.id].sort());

    const cacheAfterFull = readJson(join(dataDir, 'semantic-cache.json'));
    expect(cacheAfterFull.entries[runNode.id].summary).toBe('Runs the app entry point.'); // untouched, reused
    expect(cacheAfterFull.entries[helperNode.id].summary).toBe('Says hi.');

    // Fact fields are STILL byte-identical after the complete Full write —
    // the core cross-stage assertion of this whole spine (see the "red-when-
    // broken" evidence in the task report: flipping this to `.not.toBe(...)`
    // was verified to fail before being reverted to this form).
    expect(sha256OfFile(join(dataDir, 'knowledge-graph.json'))).toBe(factHashAfterLazy);
    const graphAfterFull = readJson(join(dataDir, 'knowledge-graph.json'));
    for (const node of graphAfterFull.nodes) {
      expect(node.summary).toBe('');
      expect(node.tags).toEqual([]);
    }

    // Re-running Lazy's own deterministic fact build reproduces the same
    // factsDigest (no source changed) — re-running Full's Architecture step
    // against it must therefore REUSE the semantic graph just written rather
    // than rebuild it. The gate's own reuse/rebuild correctness (including
    // the "source changed -> rebuild" branch) is deeply tested in
    // tests/full/full-semantic-isolation.test.mjs; this is the one call that
    // proves it is wired to THIS run's actual factDigest.
    const rerun = await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    const gate = resolveArchitectureAction({ currentFactDigest: rerun.factsDigest, existing: onDisk });
    expect(gate.action).toBe('reuse');

    // ── 5. Domain freshness ──────────────────────────────────────────────────
    // A domain graph stamped against THIS run's sourceRevision/factDigest is
    // usable; one with a mismatched sourceRevision/factDigest (as if Domain
    // had run against an older fact layer) is rejected outright and never
    // enters an answer. Every mismatch-reason case (sourceRevision alone,
    // factDigest alone, never-stamped, CLI shape) is owned by
    // tests/domain/domain-freshness.test.mjs; this is the wiring check that
    // the gate actually sees THIS spine's real fact layer as fresh.
    const manifestAfterFull = readJson(join(dataDir, 'source-manifest.json'));
    const domainGraph = {
      version: '1.0.0',
      project: { name: 'e2e-fixture', languages: ['typescript'], gitCommitHash: null },
      nodes: [], edges: [], layers: [], tour: [],
    };
    const { annotated: freshDomain } = annotateDomain({
      domainGraph,
      knowledgeGraph: graphAfterFull,
      sourceRevision: manifestAfterFull.sourceRevision,
    });
    writeFileSync(join(dataDir, 'domain-graph.json'), JSON.stringify(freshDomain), 'utf-8');
    const freshResult = await resolveDomainFreshness(root);
    expect(freshResult.usable).toBe(true);
    expect(freshResult.status).toBe('fresh');

    const staleDomain = {
      ...freshDomain,
      sourceRevision: 'git:' + '0'.repeat(40),
      factDigest: '0'.repeat(64),
    };
    writeFileSync(join(dataDir, 'domain-graph.json'), JSON.stringify(staleDomain), 'utf-8');
    const staleResult = await resolveDomainFreshness(root);
    expect(staleResult.usable).toBe(false);
    expect(staleResult.status).toBe('stale');
  });
});
