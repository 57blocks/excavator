// Slice D (full-semantic-isolation) — CLI-level regression test for the new
// bundled scripts SKILL.md's Phase F dispatches as child processes (not just
// their programmatic exports): select-stale-semantics.mjs,
// apply-semantic-patches.mjs, semantic-graph.mjs (check/write/merge-gaps),
// and apply-verification.mjs's prepare-semantic/apply-semantic actions.
//
// This is the same sequence manually smoke-tested against the real CLIs
// during development; it is captured here as a permanent regression test so
// argv parsing / file-path wiring bugs (invisible to the pure-function unit
// tests in the sibling files) stay caught.
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const skillDir = join(__dirname, '../../skills/excavator');

function run(script, args) {
  return execFileSync(process.execPath, [join(skillDir, script), ...args], { encoding: 'utf-8' });
}

function makeFixtureProject() {
  const root = mkdtempSync(join(tmpdir(), 'full-cli-pipeline-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'cli-fixture' }, null, 2));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'a.ts'), 'export function run(): void {}\n');
  return root;
}

describe('Phase F CLI pipeline (child processes, not just programmatic exports)', () => {
  let root;
  beforeEach(() => {
    root = makeFixtureProject();
    run('lazy-analyze.mjs', [root]);
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('runs select-stale-semantics -> apply-semantic-patches -> semantic-graph write/check/merge-gaps -> apply-verification semantic actions end to end', () => {
    const dataDir = join(root, '.excavator');
    const intermediate = join(dataDir, 'intermediate');
    const graph = JSON.parse(readFileSync(join(dataDir, 'knowledge-graph.json'), 'utf-8'));
    const runNode = graph.nodes.find((n) => n.type === 'function' && n.name === 'run');

    // select-stale-semantics: first run, nothing cached -> everything stale.
    run('select-stale-semantics.mjs', [root]);
    const staleFiles = JSON.parse(readFileSync(join(intermediate, 'stale-files.json'), 'utf-8'));
    expect(staleFiles).toContain('src/a.ts');

    // apply-semantic-patches: one valid patch, one hallucinated nodeId.
    const manifest = JSON.parse(readFileSync(join(dataDir, 'source-manifest.json'), 'utf-8'));
    const hash = manifest.entries.find((e) => e.path === 'src/a.ts').contentHash;
    const patchesPath = join(intermediate, 'patches.json');
    writeFileSync(patchesPath, JSON.stringify({
      patches: [
        { nodeId: runNode.id, filePath: 'src/a.ts', summary: 'Runs.', tags: ['x'], semanticSourceHash: hash },
        { nodeId: 'function:src/a.ts:ghost', filePath: 'src/a.ts', summary: 'fake', semanticSourceHash: hash },
      ],
    }, null, 2));
    run('apply-semantic-patches.mjs', [root, '--patches', patchesPath]);
    const patchReport = JSON.parse(readFileSync(join(intermediate, 'semantic-patch-report.json'), 'utf-8'));
    expect(patchReport.committed).toBe(1);
    expect(patchReport.gaps.some((g) => g.kind === 'semantic-patch-unmappable-node')).toBe(true);

    const cache = JSON.parse(readFileSync(join(dataDir, 'semantic-cache.json'), 'utf-8'));
    expect(cache.entries[runNode.id].summary).toBe('Runs.');

    // semantic-graph: check -> rebuild (no existing file yet).
    expect(run('semantic-graph.mjs', [root, 'check']).trim()).toBe('rebuild');

    const layersPath = join(intermediate, 'layers.json');
    writeFileSync(layersPath, JSON.stringify({
      layers: [{ id: 'layer:app', name: 'App', description: 'd', nodeIds: [runNode.id, 'file:ghost.ts'] }],
      relations: [],
    }, null, 2));
    const gapsPath = join(intermediate, 'extra-gaps.json');
    writeFileSync(gapsPath, JSON.stringify(patchReport.gaps, null, 2));
    run('semantic-graph.mjs', [root, 'write', '--layers', layersPath, '--relations', layersPath, '--extra-gaps', gapsPath]);

    const semanticGraph = JSON.parse(readFileSync(join(dataDir, 'semantic-graph.json'), 'utf-8'));
    expect(semanticGraph.layers[0].nodeIds).toEqual([runNode.id]); // bogus id dropped
    expect(semanticGraph.gaps.some((g) => g.kind === 'layer-nodeId-unmappable')).toBe(true);
    expect(semanticGraph.gaps.some((g) => g.kind === 'semantic-patch-unmappable-node')).toBe(true);

    // semantic-graph: check again -> reuse (factDigest unchanged).
    expect(run('semantic-graph.mjs', [root, 'check']).trim()).toBe('reuse');

    // merge-gaps refreshes gaps only, on the reuse branch.
    run('semantic-graph.mjs', [root, 'merge-gaps', '--extra-gaps', gapsPath]);
    const afterMerge = JSON.parse(readFileSync(join(dataDir, 'semantic-graph.json'), 'utf-8'));
    expect(afterMerge.layers).toEqual(semanticGraph.layers);
    expect(afterMerge.gaps.length).toBe(semanticGraph.gaps.length);

    // apply-verification semantic actions.
    run('apply-verification.mjs', [root, 'prepare-semantic']);
    const verifyManifest = JSON.parse(readFileSync(join(intermediate, 'semantic-verify-manifest.json'), 'utf-8'));
    expect(verifyManifest.selectedIds).toEqual([runNode.id]);
    writeFileSync(
      join(intermediate, 'summary-verdicts-0.json'),
      JSON.stringify({ verdicts: [{ id: runNode.id, verdict: 'verified' }] }, null, 2),
    );
    run('apply-verification.mjs', [root, 'apply-semantic']);
    const cacheAfterVerify = JSON.parse(readFileSync(join(dataDir, 'semantic-cache.json'), 'utf-8'));
    expect(cacheAfterVerify.entries[runNode.id].verification).toBe('verified');

    // The whole exercise never touched the fact graph's node fields.
    const finalGraph = JSON.parse(readFileSync(join(dataDir, 'knowledge-graph.json'), 'utf-8'));
    for (const node of finalGraph.nodes) {
      expect(node.summary).toBe('');
      expect(node.tags).toEqual([]);
    }
    expect(existsSync(join(dataDir, 'semantic-graph.json'))).toBe(true);
  });
});
