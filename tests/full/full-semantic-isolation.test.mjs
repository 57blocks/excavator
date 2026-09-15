// Slice D (full-semantic-isolation) — Task groups 1-2 acceptance:
//
//   1. after a Full semantic write (injected fake patches + layers),
//      knowledge-graph.json's fact fields are byte-identical (SHA-256
//      unchanged) and the semantics live in semantic-cache.json /
//      semantic-graph.json;
//   2. Full and Lazy over the same synthetic input produce the SAME
//      factDigest (factsDigest, in the field's actual name);
//   3. an unmappable layer nodeId / model output becomes a semantic gap, not
//      a fact anchor;
//   4. factDigest unchanged -> the semantic-graph write module reports
//      reuse/skip architecture; changed -> rebuild;
//   5. semantic-graph layers reference only real fact node ids.
//
// This is a fake-provider test (verify-the-instrument): "the model" here is
// an injected array of patches/layers, never a real provider call. Full's
// actual semantic CONTENT quality (summary/layer reliability) is explicitly
// OUT of scope for this suite — see the task report.
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

import { runLazyAnalysis } from '../../skills/excavator/lazy-analyze.mjs';
import { applySemanticPatches } from '../../skills/excavator/apply-semantic-patches.mjs';
import {
  buildSemanticGraph,
  writeSemanticGraph,
  readSemanticGraph,
  resolveArchitectureAction,
  collectFactNodeIds,
} from '../../skills/excavator/semantic-graph.mjs';

const FIXED_NOW = () => '2024-01-01T00:00:00.000Z';

function writeFixtureSource(root) {
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'full-fixture', description: 'x' }, null, 2));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(
    join(root, 'src', 'a.ts'),
    "import { helper } from './b';\n\nexport function run(): void {\n  helper();\n}\n",
  );
  writeFileSync(
    join(root, 'src', 'b.ts'),
    "export function helper(): void {\n  console.log('hi');\n}\n",
  );
}

function makeRoot() {
  return mkdtempSync(join(tmpdir(), 'full-semantic-isolation-'));
}

function sha256OfFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function readGraph(root) {
  return JSON.parse(readFileSync(join(root, '.excavator', 'knowledge-graph.json'), 'utf-8'));
}

describe('full-semantic-isolation — Full and Lazy share the same deterministic fact build', () => {
  let lazyRoot;
  let fullRoot;
  beforeEach(() => {
    lazyRoot = makeRoot();
    fullRoot = makeRoot();
    writeFixtureSource(lazyRoot);
    writeFixtureSource(fullRoot);
  });
  afterEach(() => {
    rmSync(lazyRoot, { recursive: true, force: true });
    rmSync(fullRoot, { recursive: true, force: true });
  });

  it('produces the SAME factsDigest for identical source, independent of which "mode" ran the build', async () => {
    // Both roots run the exact same driver (lazy-analyze.mjs) — this IS the
    // requirement: "full mode first runs the same deterministic scan ->
    // structure-all -> build-fact-graph as lazy". There is only one fact-
    // build code path; this test proves it is genuinely reproducible across
    // independent directories, not merely "the same function called twice".
    const lazyResult = await runLazyAnalysis({ projectRoot: lazyRoot, now: FIXED_NOW });
    const fullResult = await runLazyAnalysis({ projectRoot: fullRoot, now: FIXED_NOW });

    expect(lazyResult.factsDigest).toBeTruthy();
    expect(lazyResult.factsDigest).toBe(fullResult.factsDigest);

    const lazyGraph = readGraph(lazyRoot);
    const fullGraph = readGraph(fullRoot);
    expect(fullGraph.project.factsDigest).toBe(lazyGraph.project.factsDigest);
    // Same node/edge shape, not just the same digest (belt and suspenders —
    // the digest already proves this, but a direct structural comparison
    // makes a false-positive digest collision visible too).
    expect(fullGraph.nodes.map((n) => n.id).sort()).toEqual(lazyGraph.nodes.map((n) => n.id).sort());
    expect(fullGraph.edges.length).toBe(lazyGraph.edges.length);
  });
});

describe('full-semantic-isolation — physical isolation of a Full semantic write', () => {
  let root;
  let graph;
  let runNode;
  let helperNode;
  let factHashBefore;

  beforeEach(async () => {
    root = makeRoot();
    writeFixtureSource(root);
    await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    graph = readGraph(root);
    runNode = graph.nodes.find((n) => n.type === 'function' && n.name === 'run');
    helperNode = graph.nodes.find((n) => n.type === 'function' && n.name === 'helper');
    factHashBefore = sha256OfFile(join(root, '.excavator', 'knowledge-graph.json'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('leaves knowledge-graph.json fact fields byte-identical (SHA-256 unchanged) after a Full semantic write', async () => {
    const manifest = JSON.parse(readFileSync(join(root, '.excavator', 'source-manifest.json'), 'utf-8'));
    const hashOf = (p) => manifest.entries.find((e) => e.path === p).contentHash;

    // Injected fake "file-analyzer" node-local patches.
    const factNodeIds = collectFactNodeIds(graph);
    const patchResult = await applySemanticPatches({
      projectRoot: root,
      factNodeIds,
      patches: [
        { nodeId: runNode.id, filePath: 'src/a.ts', summary: 'Runs the app entry point.', tags: ['entrypoint'], semanticSourceHash: hashOf('src/a.ts') },
        { nodeId: helperNode.id, filePath: 'src/b.ts', summary: 'Says hi.', semanticSourceHash: hashOf('src/b.ts') },
        // A hallucinated id — must become a gap, never a committed entry.
        { nodeId: 'function:src/a.ts:doesNotExist', filePath: 'src/a.ts', summary: 'fabricated', semanticSourceHash: hashOf('src/a.ts') },
      ],
    });
    expect(patchResult.committed).toBe(2);
    expect(patchResult.gaps.some((g) => g.kind === 'semantic-patch-unmappable-node')).toBe(true);

    // Injected fake "architecture-analyzer" layers — one bogus nodeId mixed in.
    const { semanticGraph, gaps: layerGaps } = buildSemanticGraph({
      factDigest: graph.project.factsDigest,
      factNodeIds,
      layers: [{
        id: 'layer:app', name: 'App', description: 'application code',
        nodeIds: [runNode.id, helperNode.id, 'function:src/a.ts:ghost'],
      }],
      relations: [{ id: 'rel:1', type: 'depends_on', source: runNode.id, target: helperNode.id }],
      extraGaps: patchResult.gaps,
      generatedAt: FIXED_NOW(),
    });
    writeSemanticGraph(join(root, '.excavator'), semanticGraph);

    // ── The core assertion: fact fields did not move. ──────────────────────
    const factHashAfter = sha256OfFile(join(root, '.excavator', 'knowledge-graph.json'));
    expect(factHashAfter).toBe(factHashBefore);

    const graphAfter = readGraph(root);
    expect(graphAfter).toEqual(graph); // exact structural equality, not just the hash
    for (const node of graphAfter.nodes) {
      expect(node.summary).toBe('');
      expect(node.tags).toEqual([]);
    }
    expect(graphAfter.layers).toEqual([]);

    // ── The semantics landed in the two overlay products instead. ─────────
    const cache = JSON.parse(readFileSync(join(root, '.excavator', 'semantic-cache.json'), 'utf-8'));
    expect(cache.entries[runNode.id].summary).toBe('Runs the app entry point.');
    expect(cache.entries[helperNode.id].summary).toBe('Says hi.');
    expect(cache.entries['function:src/a.ts:doesNotExist']).toBeUndefined();

    const semanticGraphOnDisk = readSemanticGraph(join(root, '.excavator'));
    expect(semanticGraphOnDisk.factDigest).toBe(graph.project.factsDigest);
    expect(semanticGraphOnDisk.layers).toHaveLength(1);
    // The bogus nodeId never made it into the written layer — every
    // remaining nodeId resolves to a real fact node.
    const factIds = new Set(graph.nodes.map((n) => n.id));
    for (const id of semanticGraphOnDisk.layers[0].nodeIds) {
      expect(factIds.has(id)).toBe(true);
    }
    expect(semanticGraphOnDisk.layers[0].nodeIds).toEqual(expect.arrayContaining([runNode.id, helperNode.id]));
    expect(semanticGraphOnDisk.relations).toHaveLength(1);

    // Both the layer-level gap and the merged-in patch-level gap are visible
    // in the ONE semantic overlay gap sink — nothing silently dropped.
    expect(layerGaps.some((g) => g.kind === 'layer-nodeId-unmappable')).toBe(true);
    expect(semanticGraphOnDisk.gaps.some((g) => g.kind === 'layer-nodeId-unmappable')).toBe(true);
    expect(semanticGraphOnDisk.gaps.some((g) => g.kind === 'semantic-patch-unmappable-node')).toBe(true);
  });

  it('factDigest gate: unchanged factDigest -> reuse (skip architecture); changed source -> rebuild', async () => {
    const { semanticGraph: first } = buildSemanticGraph({
      factDigest: graph.project.factsDigest,
      factNodeIds: collectFactNodeIds(graph),
      layers: [{ id: 'layer:app', name: 'App', description: 'd', nodeIds: [runNode.id] }],
    });
    writeSemanticGraph(join(root, '.excavator'), first);

    // Re-running the SAME deterministic fact build over unchanged source
    // reproduces the same factsDigest (lazy-analyze's own determinism
    // guarantee) — the gate must say "reuse".
    const rerun = await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    const existing = readSemanticGraph(join(root, '.excavator'));
    const gateBefore = resolveArchitectureAction({ currentFactDigest: rerun.factsDigest, existing });
    expect(gateBefore.action).toBe('reuse');

    // Now change the source: add a new file, so build-fact-graph produces a
    // genuinely different projection and factsDigest must move.
    writeFileSync(join(root, 'src', 'c.ts'), 'export function extra(): void {}\n');
    const afterChange = await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    expect(afterChange.factsDigest).not.toBe(rerun.factsDigest);

    const gateAfter = resolveArchitectureAction({ currentFactDigest: afterChange.factsDigest, existing });
    expect(gateAfter.action).toBe('rebuild');
  });
});
