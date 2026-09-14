// Group 6.1 — cross-adapter identity (openspec: changes/source-snapshot,
// capability `source-snapshot`, §12.4.1: "相同源码内容经 GitCommitSnapshot
// 与 DirectorySnapshot 分析，SHALL 得到相同的确定性事实投影与相同的
// `factsDigest`").
//
// Purpose-built synthetic fixtures only (AGENTS.md: no real-project source).
import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { runLazyAnalysis } from '../../skills/excavator/lazy-analyze.mjs';

function git(dir, args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dir, encoding: 'utf-8' });
}

/** Identical, real-enough content on both adapters: an import and a call
 *  between two functions — enough surface for nodes, an `imports` edge, a
 *  `contains` edge and a uniquely-resolvable `calls` edge. */
function writeSharedContent(root) {
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'identity-fixture', description: 'x' }, null, 2));
  mkdirSync(join(root, 'src'));
  writeFileSync(
    join(root, 'src', 'a.ts'),
    "import { helper } from './b';\n\nexport function run(): void {\n  helper();\n}\n",
  );
  writeFileSync(join(root, 'src', 'b.ts'), "export function helper(): void {}\n");
}

function readGraph(root) {
  return JSON.parse(readFileSync(join(root, '.excavator', 'knowledge-graph.json'), 'utf-8'));
}

const FIXED_NOW = () => '2024-01-01T00:00:00.000Z';

describe('cross-adapter identity — GitCommitSnapshot vs DirectorySnapshot', () => {
  let dirRoot;
  let gitRoot;
  afterEach(() => {
    rmSync(dirRoot, { recursive: true, force: true });
    rmSync(gitRoot, { recursive: true, force: true });
  });

  it('identical source content produces identical fact nodes/edges and the same factsDigest under both adapters', async () => {
    dirRoot = mkdtempSync(join(tmpdir(), 'excavator-identity-dir-'));
    writeSharedContent(dirRoot);

    gitRoot = mkdtempSync(join(tmpdir(), 'excavator-identity-git-'));
    writeSharedContent(gitRoot);
    git(gitRoot, ['init', '-q']);
    git(gitRoot, ['add', '-A']);
    git(gitRoot, ['commit', '-q', '-m', 'initial']);

    const dirResult = await runLazyAnalysis({ projectRoot: dirRoot, now: FIXED_NOW });
    const gitResult = await runLazyAnalysis({ projectRoot: gitRoot, now: FIXED_NOW });
    expect(dirResult.saveError).toBeNull();
    expect(gitResult.saveError).toBeNull();

    // Adapter kinds genuinely differ — this is not a vacuous comparison.
    expect(dirResult.sourceRevision).toMatch(/^directory:/);
    expect(gitResult.sourceRevision).toMatch(/^git:/);

    const dirGraph = readGraph(dirRoot);
    const gitGraph = readGraph(gitRoot);

    expect(dirGraph.nodes).toEqual(gitGraph.nodes);
    expect(dirGraph.edges).toEqual(gitGraph.edges);
    expect(dirGraph.coverage).toEqual(gitGraph.coverage);
    expect(dirGraph.gaps).toEqual(gitGraph.gaps);
    expect(dirGraph.project.factsDigest).toBe(gitGraph.project.factsDigest);

    // A real fact made it through identically on both sides: a.ts's run()
    // uniquely resolves its call to b.ts's helper().
    const runNode = dirGraph.nodes.find((n) => n.type === 'function' && n.name === 'run');
    const helperNode = dirGraph.nodes.find((n) => n.type === 'function' && n.name === 'helper');
    expect(runNode).toBeDefined();
    expect(helperNode).toBeDefined();
    expect(dirGraph.edges.some((e) => e.type === 'calls' && e.source === runNode.id && e.target === helperNode.id)).toBe(true);
  });
});
