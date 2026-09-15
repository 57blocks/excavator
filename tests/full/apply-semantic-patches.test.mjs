// Slice D (full-semantic-isolation) — apply-semantic-patches.mjs: committing
// model-authored node-local semantic patches into semantic-cache.json, with
// an unmappable nodeId becoming a semantic gap rather than a committed cache
// entry under a made-up key (never a fact anchor).
//
// Uses a REAL fact graph (built via the shared deterministic driver,
// runLazyAnalysis — the exact mechanism Full mode reuses) so
// commitSemanticCacheEntry's source-manifest.json CAS check has a real
// manifest to check against; nothing here calls a model — patches are
// injected fixtures.
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runLazyAnalysis } from '../../skills/excavator/lazy-analyze.mjs';
import { applySemanticPatches } from '../../skills/excavator/apply-semantic-patches.mjs';
import { collectFactNodeIds } from '../../skills/excavator/semantic-graph.mjs';

const FIXED_NOW = () => '2024-01-01T00:00:00.000Z';

function makeFixtureProject() {
  const root = mkdtempSync(join(tmpdir(), 'apply-semantic-patches-fixture-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture', description: 'x' }, null, 2));
  mkdirSync(join(root, 'src'));
  writeFileSync(
    join(root, 'src', 'a.ts'),
    "export function run(): void {\n  console.log('run');\n}\n",
  );
  return root;
}

describe('apply-semantic-patches.mjs', () => {
  let root;
  let graph;
  let runNode;

  beforeEach(async () => {
    root = makeFixtureProject();
    await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    graph = JSON.parse(readFileSync(join(root, '.excavator', 'knowledge-graph.json'), 'utf-8'));
    runNode = graph.nodes.find((n) => n.type === 'function' && n.name === 'run');
    expect(runNode).toBeDefined();
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('commits a patch whose nodeId is a real fact node into semantic-cache.json', async () => {
    const manifest = JSON.parse(readFileSync(join(root, '.excavator', 'source-manifest.json'), 'utf-8'));
    const hash = manifest.entries.find((e) => e.path === 'src/a.ts').contentHash;

    const factNodeIds = collectFactNodeIds(graph);
    const { committed, total, gaps } = await applySemanticPatches({
      projectRoot: root,
      factNodeIds,
      patches: [{ nodeId: runNode.id, filePath: 'src/a.ts', summary: 'Runs the fixture.', tags: ['entrypoint'], semanticSourceHash: hash }],
    });

    expect(total).toBe(1);
    expect(committed).toBe(1);
    expect(gaps).toEqual([]);

    const cache = JSON.parse(readFileSync(join(root, '.excavator', 'semantic-cache.json'), 'utf-8'));
    expect(cache.entries[runNode.id].summary).toBe('Runs the fixture.');
    expect(cache.entries[runNode.id].tags).toEqual(['entrypoint']);
  });

  it('never commits a patch naming a nodeId with no fact-graph counterpart, and records a semantic gap instead', async () => {
    const bogusId = 'function:src/a.ts:doesNotExist';
    const factNodeIds = collectFactNodeIds(graph);
    const { committed, total, gaps, results } = await applySemanticPatches({
      projectRoot: root,
      factNodeIds,
      patches: [{ nodeId: bogusId, filePath: 'src/a.ts', summary: 'hallucinated', semanticSourceHash: 'whatever' }],
    });

    expect(total).toBe(1);
    expect(committed).toBe(0);
    expect(results[0]).toMatchObject({ nodeId: bogusId, ok: false, status: 'unmappable-node' });

    const gap = gaps.find((g) => g.kind === 'semantic-patch-unmappable-node');
    expect(gap).toBeDefined();
    expect(gap.samples).toContain(bogusId);

    // Never wrote a cache entry for the bogus id — no fact anchor by proxy.
    const cachePath = join(root, '.excavator', 'semantic-cache.json');
    // The valid-patch test above did not run in this test's tmp dir, so a
    // real project can legitimately have no cache file yet.
    let cache = { entries: {} };
    try {
      cache = JSON.parse(readFileSync(cachePath, 'utf-8'));
    } catch { /* absent is fine — nothing was ever committed here */ }
    expect(cache.entries[bogusId]).toBeUndefined();
  });

  it('handles a mix of valid and unmappable patches in one batch, committing only the valid one', async () => {
    const manifest = JSON.parse(readFileSync(join(root, '.excavator', 'source-manifest.json'), 'utf-8'));
    const hash = manifest.entries.find((e) => e.path === 'src/a.ts').contentHash;
    const factNodeIds = collectFactNodeIds(graph);

    const { committed, total, gaps } = await applySemanticPatches({
      projectRoot: root,
      factNodeIds,
      patches: [
        { nodeId: runNode.id, filePath: 'src/a.ts', summary: 'ok', semanticSourceHash: hash },
        { nodeId: 'function:src/a.ts:ghost', filePath: 'src/a.ts', summary: 'nope', semanticSourceHash: hash },
      ],
    });

    expect(total).toBe(2);
    expect(committed).toBe(1);
    expect(gaps.some((g) => g.kind === 'semantic-patch-unmappable-node')).toBe(true);

    const cache = JSON.parse(readFileSync(join(root, '.excavator', 'semantic-cache.json'), 'utf-8'));
    expect(cache.entries[runNode.id].summary).toBe('ok');
    expect(cache.entries['function:src/a.ts:ghost']).toBeUndefined();
  });
});
