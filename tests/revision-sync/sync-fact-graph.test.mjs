// Group 5 — revision-based incremental sync (openspec: changes/source-snapshot,
// capability `revision-sync`).
//
// Purpose-built synthetic fixtures only (AGENTS.md: no real-project source).
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { syncFactGraph, computeChangedFileSet } from '../../skills/excavator/sync-fact-graph.mjs';
import { runLazyAnalysis, defaultRunScript } from '../../skills/excavator/lazy-analyze.mjs';
import { resolveSourceSnapshot } from '../../skills/excavator/source-snapshot.mjs';

const FIXED_NOW = () => '2024-01-01T00:00:00.000Z';
const LATER_NOW = () => '2024-06-01T00:00:00.000Z';

function git(dir, args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dir, encoding: 'utf-8' });
}

/** a.ts calls b.ts's helper(); c.ts is a standalone, never-touched file used
 *  to assert unchanged files produce byte-identical facts across a sync. */
function writeFixtureFiles(root) {
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'a.ts'), "import { helper } from './b';\n\nexport function run(): void {\n  helper();\n}\n");
  writeFileSync(join(root, 'src', 'b.ts'), "export function helper(): void {}\nexport function other(): void {}\n");
  writeFileSync(join(root, 'src', 'c.ts'), "export function standalone(): number { return 42; }\n");
}

function makeDirFixture() {
  const root = mkdtempSync(join(tmpdir(), 'excavator-sync-dir-fixture-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'sync-fixture' }, null, 2));
  writeFixtureFiles(root);
  return root;
}

function makeGitFixture() {
  const root = makeDirFixture();
  git(root, ['init', '-q']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'initial']);
  return root;
}

function readManifest(root) {
  return JSON.parse(readFileSync(join(root, '.excavator', 'source-manifest.json'), 'utf-8'));
}

function readGraph(root) {
  return JSON.parse(readFileSync(join(root, '.excavator', 'knowledge-graph.json'), 'utf-8'));
}

function findNode(graph, name) {
  return graph.nodes.find((n) => n.type === 'function' && n.name === name);
}

// ---------------------------------------------------------------------------

describe('syncFactGraph — freshness match skips the rebuild', () => {
  let root;
  beforeEach(() => { root = makeDirFixture(); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('skips when sourceRevision/selectionDigest/pipelineVersion all match the persisted manifest', async () => {
    await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    const manifestBefore = readFileSync(join(root, '.excavator', 'source-manifest.json'), 'utf-8');
    const graphBefore = readFileSync(join(root, '.excavator', 'knowledge-graph.json'), 'utf-8');

    // verify-the-instrument: count runScript invocations — a real skip must
    // invoke NOTHING, so this positively proves no rebuild ran (not merely
    // that the output happens to look the same).
    let calls = 0;
    const countingRunScript = (scriptName, args) => { calls++; return defaultRunScript(scriptName, args); };

    const result = await syncFactGraph({ projectRoot: root, now: LATER_NOW, runScript: countingRunScript });

    expect(result.kind).toBe('skipped');
    expect(result.metaAdvanced).toBe(false);
    expect(result.changed).toBeNull();
    expect(calls).toBe(0);
    expect(readFileSync(join(root, '.excavator', 'source-manifest.json'), 'utf-8')).toBe(manifestBefore);
    expect(readFileSync(join(root, '.excavator', 'knowledge-graph.json'), 'utf-8')).toBe(graphBefore);
  });
});

describe('syncFactGraph — a revision change triggers a sync whose products equal a fresh projection', () => {
  let root;
  beforeEach(() => { root = makeDirFixture(); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('adding a file changes sourceRevision and the synced graph equals an independent fresh build over the same content', async () => {
    await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    const manifestBefore = readManifest(root);

    writeFileSync(join(root, 'src', 'd.ts'), 'export function extra(): void {}\n');

    const result = await syncFactGraph({ projectRoot: root, now: LATER_NOW });
    expect(result.kind).toBe('synced');
    expect(result.metaAdvanced).toBe(true);
    expect(result.saveError).toBeNull();
    expect(result.sourceRevision).not.toBe(manifestBefore.sourceRevision);
    expect(result.changed).toEqual({ added: ['src/d.ts'], modified: [], removed: [] });

    const syncedGraph = readGraph(root);

    // An INDEPENDENT fresh build over an identical copy of the current
    // content (a brand-new directory, no manifest at all) must produce the
    // exact same facts — this is what "products equal a fresh projection"
    // means: sync is not a different, cheaper algorithm, it IS the full
    // deterministic re-projection.
    const freshRoot = mkdtempSync(join(tmpdir(), 'excavator-sync-fresh-'));
    try {
      writeFileSync(join(freshRoot, 'package.json'), JSON.stringify({ name: 'sync-fixture' }, null, 2));
      writeFixtureFiles(freshRoot);
      writeFileSync(join(freshRoot, 'src', 'd.ts'), 'export function extra(): void {}\n');
      await runLazyAnalysis({ projectRoot: freshRoot, now: LATER_NOW });
      const freshGraph = readGraph(freshRoot);

      expect(syncedGraph.nodes).toEqual(freshGraph.nodes);
      expect(syncedGraph.edges).toEqual(freshGraph.edges);
      expect(syncedGraph.coverage).toEqual(freshGraph.coverage);
      expect(syncedGraph.gaps).toEqual(freshGraph.gaps);
      expect(syncedGraph.project.factsDigest).toBe(freshGraph.project.factsDigest);
    } finally {
      rmSync(freshRoot, { recursive: true, force: true });
    }
  });
});

describe('syncFactGraph — non-git directory add/modify/delete are correctly classified', () => {
  let root;
  beforeEach(() => { root = makeDirFixture(); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('reports added/modified/removed against the persisted manifest', async () => {
    await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });

    writeFileSync(join(root, 'src', 'a.ts'), "import { helper } from './b';\n\nexport function run(): void {\n  helper();\n  helper();\n}\n"); // modified
    rmSync(join(root, 'src', 'c.ts')); // removed
    writeFileSync(join(root, 'src', 'd.ts'), 'export function extra(): void {}\n'); // added

    const result = await syncFactGraph({ projectRoot: root, now: LATER_NOW });
    expect(result.kind).toBe('synced');
    expect(result.changed).toEqual({
      added: ['src/d.ts'],
      modified: ['src/a.ts'],
      removed: ['src/c.ts'],
    });

    // The deleted file's fact node (and any edges touching it) must be gone
    // from the published graph, not merely absent from the `changed` report
    // — spec: "删除的文件 SHALL 移除其事实节点与边".
    const graph = readGraph(root);
    expect(findNode(graph, 'standalone')).toBeUndefined();
    expect(graph.nodes.some((n) => n.filePath === 'src/c.ts')).toBe(false);
    expect(graph.edges.some((e) => e.source.includes('src/c.ts') || e.target.includes('src/c.ts'))).toBe(false);
  });
});

describe('syncFactGraph — git commit add/modify/delete/rename are correctly classified', () => {
  let root;
  beforeEach(() => { root = makeGitFixture(); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('a single commit with a modify, a delete, an add and a rename classifies every path correctly', async () => {
    await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });

    writeFileSync(join(root, 'src', 'a.ts'), "import { helper } from './b';\n\nexport function run(): void {\n  helper();\n  helper();\n}\n"); // modify
    rmSync(join(root, 'src', 'c.ts')); // delete
    writeFileSync(join(root, 'src', 'e.ts'), 'export function extra(): void {}\n'); // add
    renameSync(join(root, 'src', 'b.ts'), join(root, 'src', 'f.ts')); // rename -> delete src/b.ts + add src/f.ts
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'modify/delete/add/rename']);

    const result = await syncFactGraph({ projectRoot: root, now: LATER_NOW });
    expect(result.kind).toBe('synced');
    expect(result.changed.modified).toEqual(['src/a.ts']);
    expect(result.changed.removed.sort()).toEqual(['src/b.ts', 'src/c.ts']);
    expect(result.changed.added.sort()).toEqual(['src/e.ts', 'src/f.ts']);
  });

  it('a revert commit that restores original content resyncs back to the exact original graph', async () => {
    const first = await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    const originalGraph = readGraph(root);

    const original = readFileSync(join(root, 'src', 'a.ts'), 'utf-8');
    writeFileSync(join(root, 'src', 'a.ts'), "import { helper } from './b';\n\nexport function run(): void {\n  helper();\n  helper();\n}\n");
    git(root, ['commit', '-q', '-am', 'change a.ts']);
    const syncedChange = await syncFactGraph({ projectRoot: root, now: LATER_NOW });
    expect(syncedChange.kind).toBe('synced');
    expect(syncedChange.changed.modified).toEqual(['src/a.ts']);

    // Revert: restore the ORIGINAL content in a new commit.
    writeFileSync(join(root, 'src', 'a.ts'), original);
    git(root, ['commit', '-q', '-am', 'revert a.ts']);
    const syncedRevert = await syncFactGraph({ projectRoot: root, now: LATER_NOW });
    expect(syncedRevert.kind).toBe('synced');
    expect(syncedRevert.changed.modified).toEqual(['src/a.ts']); // content changed relative to the PERSISTED (post-change) manifest

    const revertedGraph = readGraph(root);
    expect(revertedGraph.nodes).toEqual(originalGraph.nodes);
    expect(revertedGraph.edges).toEqual(originalGraph.edges);
    expect(revertedGraph.project.factsDigest).toBe(originalGraph.project.factsDigest);
    expect(first.factsDigest).toBe(originalGraph.project.factsDigest);
  });
});

describe('syncFactGraph — a changed file\'s line ranges and calls update; unchanged files are byte-identical', () => {
  let root;
  beforeEach(() => { root = makeDirFixture(); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('inserting lines and switching the call target updates only the changed file\'s facts', async () => {
    await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    const before = readGraph(root);
    const runBefore = findNode(before, 'run');
    const standaloneBefore = findNode(before, 'standalone');
    expect(runBefore).toBeDefined();
    expect(standaloneBefore).toBeDefined();

    // Insert comment lines before `run` (shifts its lineRange) AND switch
    // the call inside its body from helper() to other() (changes the calls
    // edge target). c.ts (standalone) is never touched.
    writeFileSync(
      join(root, 'src', 'a.ts'),
      "import { helper, other } from './b';\n\n// inserted comment line 1\n// inserted comment line 2\nexport function run(): void {\n  other();\n}\n",
    );

    const result = await syncFactGraph({ projectRoot: root, now: LATER_NOW });
    expect(result.kind).toBe('synced');
    expect(result.changed.modified).toEqual(['src/a.ts']);

    const after = readGraph(root);
    const runAfter = findNode(after, 'run');
    const otherAfter = findNode(after, 'other');
    const helperAfter = findNode(after, 'helper');
    const standaloneAfter = findNode(after, 'standalone');

    // Line range moved (shifted down by the inserted comment lines).
    expect(runAfter.lineRange[0]).toBeGreaterThan(runBefore.lineRange[0]);

    // The calls edge now targets other(), not helper(), and the old edge is gone.
    const callsFromRun = after.edges.filter((e) => e.type === 'calls' && e.source === runAfter.id);
    expect(callsFromRun).toHaveLength(1);
    expect(callsFromRun[0].target).toBe(otherAfter.id);
    expect(after.edges.some((e) => e.type === 'calls' && e.source === runAfter.id && e.target === helperAfter.id)).toBe(false);

    // c.ts's node is completely untouched by the edit to a.ts.
    expect(standaloneAfter).toEqual(standaloneBefore);
  });
});

describe('syncFactGraph — a failed save does not advance the manifest', () => {
  let root;
  beforeEach(() => { root = makeDirFixture(); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('verify-the-instrument: an unrelated rebuild DOES advance the manifest (positive control); an injected save failure does not', async () => {
    await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });

    writeFileSync(join(root, 'src', 'd.ts'), 'export function extra(): void {}\n');

    // Positive control: prove the instrument (comparing manifest content)
    // actually detects an advance when nothing is broken.
    const controlRoot = mkdtempSync(join(tmpdir(), 'excavator-sync-control-'));
    try {
      writeFileSync(join(controlRoot, 'package.json'), JSON.stringify({ name: 'sync-fixture' }, null, 2));
      writeFixtureFiles(controlRoot);
      await runLazyAnalysis({ projectRoot: controlRoot, now: FIXED_NOW });
      writeFileSync(join(controlRoot, 'src', 'd.ts'), 'export function extra(): void {}\n');
      const controlManifestBefore = readFileSync(join(controlRoot, '.excavator', 'source-manifest.json'), 'utf-8');
      const controlResult = await syncFactGraph({ projectRoot: controlRoot, now: LATER_NOW });
      expect(controlResult.metaAdvanced).toBe(true);
      expect(readFileSync(join(controlRoot, '.excavator', 'source-manifest.json'), 'utf-8')).not.toBe(controlManifestBefore);
    } finally {
      rmSync(controlRoot, { recursive: true, force: true });
    }

    // Now the real assertion: an injected build-fingerprints failure on the
    // SAME kind of change must leave the manifest untouched.
    const manifestBefore = readFileSync(join(root, '.excavator', 'source-manifest.json'), 'utf-8');
    const graphBefore = readFileSync(join(root, '.excavator', 'knowledge-graph.json'), 'utf-8');
    const failingRunScript = (scriptName, args) => {
      if (scriptName === 'build-fingerprints.mjs') return { status: 1, stdout: '', stderr: 'simulated fingerprints failure' };
      return defaultRunScript(scriptName, args);
    };

    const result = await syncFactGraph({ projectRoot: root, now: LATER_NOW, runScript: failingRunScript });
    expect(result.kind).toBe('synced');
    expect(result.metaAdvanced).toBe(false);
    expect(result.saveError).toMatch(/build-fingerprints/);
    expect(readFileSync(join(root, '.excavator', 'source-manifest.json'), 'utf-8')).toBe(manifestBefore);
    // Staged publish (openspec: changes/product-serialization-ceiling, design
    // D4): the fingerprints-failure gate is checked BEFORE anything is
    // staged, so knowledge-graph.json is byte-identical to before this
    // failed sync — not merely still present, but literally untouched. This
    // replaces the prior (pre-staged-publish) behavior, where the graph
    // write ran unconditionally ahead of this gate and WOULD have been
    // overwritten even on a withheld manifest.
    expect(existsSync(join(root, '.excavator', 'knowledge-graph.json'))).toBe(true);
    expect(readFileSync(join(root, '.excavator', 'knowledge-graph.json'), 'utf-8')).toBe(graphBefore);

    // Recovery: a subsequent sync WITHOUT the injected failure must succeed
    // and finally advance the manifest — proving the earlier failure really
    // was the cause, not a permanently broken fixture.
    const recovered = await syncFactGraph({ projectRoot: root, now: LATER_NOW });
    expect(recovered.metaAdvanced).toBe(true);
    expect(readFileSync(join(root, '.excavator', 'source-manifest.json'), 'utf-8')).not.toBe(manifestBefore);
  });
});

describe('syncFactGraph — an adapter-type change forces a full rebuild, never an incremental sync', () => {
  let root;
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('a plain directory later git-init\'d rebuilds fully, even though file content is unchanged', async () => {
    root = makeDirFixture();
    await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    const manifestBefore = readManifest(root);
    expect(manifestBefore.sourceRevision).toMatch(/^directory:/);

    // verify-the-instrument: with IDENTICAL content and no adapter change,
    // sync must SKIP (proving the fixture is not simply always-different).
    const noOpResult = await syncFactGraph({ projectRoot: root, now: LATER_NOW });
    expect(noOpResult.kind).toBe('skipped');

    // Now actually change the adapter type: git-init the same directory with
    // no content change at all.
    git(root, ['init', '-q']);
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'adopt git']);

    const result = await syncFactGraph({ projectRoot: root, now: LATER_NOW });
    expect(result.kind).toBe('full-rebuild');
    expect(result.changed).toBeNull(); // MUST NOT take the incremental path here.
    expect(result.sourceRevision).toMatch(/^git:/);
    expect(result.metaAdvanced).toBe(true);

    const manifestAfter = readManifest(root);
    expect(manifestAfter.sourceRevision).toMatch(/^git:/);

    // The full rebuild actually re-derived project metadata from the NEW
    // adapter kind — gitCommitHash goes from null (directory) to a real sha
    // (git) purely because of the adapter switch.
    const graph = readGraph(root);
    expect(graph.project.gitCommitHash).toBeTruthy();
  });
});

describe('computeChangedFileSet — pure diff helper', () => {
  it('git kind uses commit diff; directory kind uses manifest diff, both restricted to the analysis inventory', async () => {
    const root = makeGitFixture();
    try {
      const before = resolveSourceSnapshot(root);
      writeFileSync(join(root, 'src', 'a.ts'), "import { helper } from './b';\n\nexport function run(): void {\n  helper();\n  helper();\n}\n");
      git(root, ['commit', '-q', '-am', 'modify a']);
      const after = resolveSourceSnapshot(root);

      const changed = computeChangedFileSet(after, { sourceRevision: before.revision, entries: before.entries() });
      expect(changed).toEqual({ added: [], modified: ['src/a.ts'], removed: [] });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
