// displayName oracles 1-2 through apply-semantic-patches (node-display-name):
// the patch's displayName must reach the cache entry, and a rejection must
// surface as a gap naming the status.
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runLazyAnalysis } from '../../skills/excavator/lazy-analyze.mjs';
import { applySemanticPatches } from '../../skills/excavator/apply-semantic-patches.mjs';
import { readKnowledgeGraph } from '../../skills/excavator/knowledge-graph-store.mjs';

const FIXED_NOW = () => '2024-01-01T00:00:00.000Z';

describe('apply-semantic-patches carries displayName', () => {
  let root;
  let factNodes;
  let runNode;
  let hash;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'apply-patches-display-name-'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture', description: 'x' }));
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'a.ts'), "export function run(): void {\n  console.log('run');\n}\n");
    await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    const graph = readKnowledgeGraph(join(root, '.excavator', 'knowledge-graph.jsonl'));
    runNode = graph.nodes.find((n) => n.type === 'function' && n.name === 'run');
    factNodes = graph.nodes;
    const manifest = JSON.parse(readFileSync(join(root, '.excavator', 'source-manifest.json'), 'utf-8'));
    hash = manifest.entries.find((e) => e.path === 'src/a.ts').contentHash;
  });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  const patch = (extra = {}) => ({
    nodeId: runNode.id, filePath: 'src/a.ts', summary: 'Runs the fixture.', tags: ['entrypoint'],
    evidence: { line: 2, quote: "console.log('run');" },
    semanticSourceHash: hash, ...extra,
  });

  it('lands a valid displayName in the cache entry', async () => {
    const out = await applySemanticPatches({
      projectRoot: root, factNodes, patches: [patch({ displayName: 'Run the fixture' })],
    });
    expect(out.gaps).toEqual([]);
    expect(out.committed).toBe(1);
    const cache = JSON.parse(readFileSync(join(root, '.excavator', 'semantic-cache.json'), 'utf-8'));
    expect(cache.entries[runNode.id].displayName).toBe('Run the fixture');
  });

  it('drops a verification verdict a model patch declares for itself', async () => {
    const out = await applySemanticPatches({
      projectRoot: root, factNodes,
      patches: [patch({ displayName: 'Run the fixture', verification: 'verified' })],
    });
    expect(out.committed).toBe(1);
    const cache = JSON.parse(readFileSync(join(root, '.excavator', 'semantic-cache.json'), 'utf-8'));
    expect(cache.entries[runNode.id]).not.toHaveProperty('verification');
  });

  it('turns a patch without displayName into a gap naming display-name-missing', async () => {
    const out = await applySemanticPatches({ projectRoot: root, factNodes, patches: [patch()] });
    expect(out.committed).toBe(0);
    expect(out.gaps.map((g) => g.kind)).toEqual(['semantic-patch-write-failed-display-name-missing']);
  });

  it('turns a malformed displayName into a gap naming display-name-shape', async () => {
    const out = await applySemanticPatches({
      projectRoot: root, factNodes, patches: [patch({ displayName: 'Run\nfixture' })],
    });
    expect(out.committed).toBe(0);
    expect(out.gaps.map((g) => g.kind)).toEqual(['semantic-patch-write-failed-display-name-shape']);
  });
});
