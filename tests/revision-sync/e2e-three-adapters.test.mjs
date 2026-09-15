// Group 6.2 — synthetic end-to-end: each of the 3 SourceSnapshot adapters
// (openspec: changes/source-snapshot), first build via `runLazyAnalysis`
// then one incremental round via `sync-fact-graph.mjs`'s `syncFactGraph`.
// Deterministic, zero LLM (every script here is a plain Node script — no
// model/subagent dispatch happens anywhere in this call chain), facts
// present, gaps visible.
//
// Purpose-built synthetic fixtures only (AGENTS.md: no real-project source).
// Group 6.3 (opt-in real-corpus run against wcp/wcp-auth) is intentionally
// NOT here — acceptance runs it separately, uncommitted.
import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { runLazyAnalysis } from '../../skills/excavator/lazy-analyze.mjs';
import { syncFactGraph } from '../../skills/excavator/sync-fact-graph.mjs';

const FIXED_NOW = () => '2024-01-01T00:00:00.000Z';
const LATER_NOW = () => '2024-06-01T00:00:00.000Z';

function git(dir, args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dir, encoding: 'utf-8' });
}

function readGraph(root) {
  return JSON.parse(readFileSync(join(root, '.excavator', 'knowledge-graph.json'), 'utf-8'));
}

function readManifest(root) {
  return JSON.parse(readFileSync(join(root, '.excavator', 'source-manifest.json'), 'utf-8'));
}

/** Two files, a resolvable call, and one intentionally UNRESOLVABLE call
 *  (`missingHelper()`, nothing defines it) — so a gap is genuinely visible
 *  in `graph.gaps`, not merely an empty array by construction. */
function writeBaseProject(root) {
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'e2e-fixture', description: 'x' }, null, 2));
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(
    join(root, 'src', 'a.ts'),
    "import { helper } from './b';\n\nexport function run(): void {\n  helper();\n  missingHelper();\n}\n",
  );
  writeFileSync(join(root, 'src', 'b.ts'), "export function helper(): void {}\n");
}

/** Asserts the shared, adapter-agnostic properties every e2e round must
 *  hold: deterministic build, real facts present, at least one visible gap. */
function assertFactsAndGapsVisible(graph) {
  expect(graph.nodes.length).toBeGreaterThan(0);
  expect(graph.edges.some((e) => e.type === 'calls')).toBe(true);
  expect(Array.isArray(graph.gaps)).toBe(true);
  expect(graph.gaps.length).toBeGreaterThan(0); // missingHelper() never resolves — a real, visible gap.
  expect(typeof graph.project.factsDigest).toBe('string');
  expect(graph.project.factsDigest.length).toBeGreaterThan(0);
}

describe('synthetic e2e — DirectorySnapshot adapter: first build + one incremental sync round', () => {
  let root;
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('is deterministic end-to-end with zero LLM calls', async () => {
    root = mkdtempSync(join(tmpdir(), 'excavator-e2e-dir-'));
    writeBaseProject(root);

    const first = await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    expect(first.saveError).toBeNull();
    expect(readManifest(root).sourceRevision).toMatch(/^directory:/);
    assertFactsAndGapsVisible(readGraph(root));

    writeFileSync(join(root, 'src', 'c.ts'), 'export function extra(): number { return 1; }\n');
    const sync = await syncFactGraph({ projectRoot: root, now: LATER_NOW });
    expect(sync.kind).toBe('synced');
    expect(sync.metaAdvanced).toBe(true);
    expect(sync.changed).toEqual({ added: ['src/c.ts'], modified: [], removed: [] });

    const graph = readGraph(root);
    assertFactsAndGapsVisible(graph);
    expect(graph.nodes.some((n) => n.name === 'extra')).toBe(true);
  });
});

describe('synthetic e2e — GitCommitSnapshot adapter: first build + one incremental sync round', () => {
  let root;
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('is deterministic end-to-end with zero LLM calls', async () => {
    root = mkdtempSync(join(tmpdir(), 'excavator-e2e-git-'));
    writeBaseProject(root);
    git(root, ['init', '-q']);
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'initial']);

    const first = await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    expect(first.saveError).toBeNull();
    expect(readManifest(root).sourceRevision).toMatch(/^git:/);
    assertFactsAndGapsVisible(readGraph(root));

    writeFileSync(join(root, 'src', 'c.ts'), 'export function extra(): number { return 1; }\n');
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'add c.ts']);
    const sync = await syncFactGraph({ projectRoot: root, now: LATER_NOW });
    expect(sync.kind).toBe('synced');
    expect(sync.metaAdvanced).toBe(true);
    expect(sync.changed).toEqual({ added: ['src/c.ts'], modified: [], removed: [] });

    const graph = readGraph(root);
    assertFactsAndGapsVisible(graph);
    expect(graph.nodes.some((n) => n.name === 'extra')).toBe(true);
    expect(graph.project.gitCommitHash).toBeTruthy();
  });
});

describe('synthetic e2e — MultiRepoSnapshot adapter: first build + one incremental sync round', () => {
  let root;
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('is deterministic end-to-end with zero LLM calls, across a member commit AND a parent-only edit', async () => {
    root = mkdtempSync(join(tmpdir(), 'excavator-e2e-multirepo-'));
    writeFileSync(join(root, 'README.md'), '# workspace\n');

    const memberDir = join(root, 'member-a');
    mkdirSync(join(memberDir, 'src'), { recursive: true });
    writeFileSync(join(memberDir, 'package.json'), JSON.stringify({ name: 'member-a' }, null, 2));
    writeFileSync(
      join(memberDir, 'src', 'a.ts'),
      "import { helper } from './b';\n\nexport function run(): void {\n  helper();\n  missingHelper();\n}\n",
    );
    writeFileSync(join(memberDir, 'src', 'b.ts'), "export function helper(): void {}\n");
    git(memberDir, ['init', '-q']);
    git(memberDir, ['add', '-A']);
    git(memberDir, ['commit', '-q', '-m', 'initial']);

    const first = await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    expect(first.saveError).toBeNull();
    expect(readManifest(root).sourceRevision).toMatch(/^multi-repo:/);
    assertFactsAndGapsVisible(readGraph(root));
    expect(readGraph(root).nodes.some((n) => n.filePath === 'member-a/src/a.ts')).toBe(true);

    // One incremental round touching BOTH a member commit and a parent-only
    // (non-member) file — Fix A: both must be picked up as a revision change.
    writeFileSync(join(memberDir, 'src', 'c.ts'), 'export function extra(): number { return 1; }\n');
    git(memberDir, ['add', '-A']);
    git(memberDir, ['commit', '-q', '-m', 'add c.ts']);
    writeFileSync(join(root, 'README.md'), '# workspace, updated\n');

    const sync = await syncFactGraph({ projectRoot: root, now: LATER_NOW });
    expect(sync.kind).toBe('synced');
    expect(sync.metaAdvanced).toBe(true);

    const graph = readGraph(root);
    assertFactsAndGapsVisible(graph);
    expect(graph.nodes.some((n) => n.filePath === 'member-a/src/c.ts')).toBe(true);
  });
});
