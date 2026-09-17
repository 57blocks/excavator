import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { planSemanticCacheReuse } from '../../skills/excavator/semantic-cache-reuse.mjs';
import { assertDataDir, assertSourcePath, bindProjectRoot } from '../../skills/excavator/project-paths.mjs';
import { IDS, makeMcpFixture } from './fixture.mjs';
import { resolveSourceSnapshot } from '../../skills/excavator/source-snapshot.mjs';

const cleanup = [];
afterEach(() => { while (cleanup.length) cleanup.pop()(); });

describe('temporary MCP boundary fixture', () => {
  it('separates path and owner identity, and every cache status has one bucket', () => {
    const fixture = makeMcpFixture();
    cleanup.push(fixture.cleanup);
    const plan = planSemanticCacheReuse({
      requestedNodeIds: [IDS.a, IDS.b, IDS.ownerA, IDS.ownerB, IDS.missing, IDS.noncanonical, IDS.orphan, 'unknown', IDS.a],
      nodes: fixture.graph.nodes,
      manifestEntries: fixture.manifest.entries,
      semanticCache: fixture.cache,
    });
    expect(plan.reuse.map((x) => x.nodeId)).toEqual([IDS.a, IDS.b]);
    expect(plan.generate.map((x) => [x.nodeId, x.reason])).toEqual([
      [IDS.ownerA, 'stale'], [IDS.ownerB, 'missing'], [IDS.missing, 'missing'],
      [IDS.noncanonical, 'noncanonical-language'],
    ]);
    expect(plan.unavailable.map((x) => [x.nodeId, x.reason])).toEqual([
      [IDS.orphan, 'path-not-in-manifest'], ['unknown', 'unknown-node'],
    ]);
    expect(plan.counts).toEqual({ requested: 8, reuse: 2, generate: 4, unavailable: 2 });
    expect(fixture.manifest.entries.find((x) => x.path === 'src/same-a.ts').contentHash)
      .toBe(fixture.manifest.entries.find((x) => x.path === 'src/same-b.ts').contentHash);
    expect(IDS.ownerA).not.toBe(IDS.ownerB);
  });

  it('contains a source symlink and a data-directory symlink escaping the root', () => {
    const fixture = makeMcpFixture();
    cleanup.push(fixture.cleanup);
    expect(realpathSync(join(fixture.root, 'src', 'escape.ts'))).toBe(realpathSync(join(fixture.outside, 'secret.ts')));
    expect(fixture.manifest.entries.some((x) => x.path === 'src/escape.ts')).toBe(false);
    const escaped = makeMcpFixture({ escapedDataDir: true });
    cleanup.push(escaped.cleanup);
    expect(realpathSync(join(escaped.root, '.excavator'))).toBe(realpathSync(escaped.outside));
    const root = bindProjectRoot(fixture.root);
    expect(assertSourcePath(root, 'src/same-a.ts', fixture.snapshot)).toBe('src/same-a.ts');
    expect(() => assertSourcePath(root, '../secret.ts', fixture.snapshot)).toThrow(/canonical/);
    expect(() => assertSourcePath(root, join(fixture.outside, 'secret.ts'), fixture.snapshot)).toThrow(/canonical/);
    expect(() => assertSourcePath(root, 'src/escape.ts', fixture.snapshot)).toThrow(/snapshot/);
    expect(() => assertSourcePath(root, 'src/escape.ts', { listFiles: () => ['src/escape.ts'] })).toThrow(/outside project root/);
    expect(() => assertDataDir(bindProjectRoot(escaped.root))).toThrow(/real directory/);
  });

  it('permits a real Git worktree bound as its own canonical project root', () => {
    const fixture = makeMcpFixture();
    cleanup.push(fixture.cleanup);
    const parent = mkdtempSync(join(tmpdir(), 'excavator-mcp-worktree-parent-'));
    const worktree = join(parent, 'checkout');
    cleanup.push(() => rmSync(parent, { recursive: true, force: true }));
    const git = (args) => execFileSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.test', ...args],
      { cwd: fixture.root, stdio: 'pipe' });
    git(['init', '-q']);
    git(['add', 'src/same-a.ts']);
    git(['commit', '-q', '-m', 'fixture']);
    git(['worktree', 'add', '--detach', worktree]);
    cleanup.push(() => git(['worktree', 'remove', '--force', worktree]));
    const bound = bindProjectRoot(worktree);
    const snapshot = resolveSourceSnapshot(bound);
    expect(assertSourcePath(bound, 'src/same-a.ts', snapshot)).toBe('src/same-a.ts');
  });
});
