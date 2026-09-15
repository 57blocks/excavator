// Group 4 (openspec: changes/full-semantic-isolation, capability
// `consumer-freshness`) — the ONE shared freshness helper every consumer
// skill and the auto-update hook now use instead of its own ad hoc
// gitCommitHash/git-diff logic.
//
// Purpose-built synthetic fixtures only (AGENTS.md: no real-project source).
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { resolveFreshness } from '../../skills/excavator/consumer-freshness.mjs';
import { runLazyAnalysis } from '../../skills/excavator/lazy-analyze.mjs';

const FIXED_NOW = () => '2024-01-01T00:00:00.000Z';

function git(dir, args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dir, encoding: 'utf-8' });
}

function writeFixtureFiles(root) {
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src', 'a.ts'), "export function run(): void {}\n");
  writeFileSync(join(root, 'src', 'b.ts'), "export function helper(): void {}\n");
}

function makeDirFixture() {
  const root = mkdtempSync(join(tmpdir(), 'excavator-freshness-dir-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'freshness-fixture' }, null, 2));
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

describe('resolveFreshness — missing manifest', () => {
  let root;
  beforeEach(() => { root = makeDirFixture(); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('reports missing (never throws) when no analysis has ever run, but still resolves the current revision', async () => {
    const result = await resolveFreshness(root);
    expect(result.status).toBe('missing');
    expect(result.manifestSourceRevision).toBeNull();
    // Even with nothing persisted yet, the CURRENT source snapshot is still
    // resolvable — this is what makes the "missing" bucket distinguishable
    // from a hard failure: the helper knows what "now" looks like, it just
    // has nothing to compare it to.
    expect(result.currentSourceRevision).toMatch(/^directory:/);
    expect(result.reason).toMatch(/no persisted source-manifest\.json/);
  });

  it('reports missing for a corrupt source-manifest.json rather than throwing', async () => {
    mkdirSync(join(root, '.excavator'), { recursive: true });
    writeFileSync(join(root, '.excavator', 'source-manifest.json'), '{not-json');
    const result = await resolveFreshness(root);
    expect(result.status).toBe('missing');
    expect(result.reason).toMatch(/not valid JSON/);
  });
});

describe('resolveFreshness — directory target (content-hash guard)', () => {
  let root;
  beforeEach(() => { root = makeDirFixture(); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('is fresh right after analysis: current revision equals the persisted manifest', async () => {
    await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    const result = await resolveFreshness(root);
    expect(result.status).toBe('fresh');
    expect(result.currentSourceRevision).toBe(result.manifestSourceRevision);
    expect(result.manifestSourceRevision).toBe(readManifest(root).sourceRevision);
  });

  it('verify-the-instrument: is stale once a file\'s content changes after analysis', async () => {
    await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    const before = await resolveFreshness(root);
    expect(before.status).toBe('fresh'); // instrument sees the known-good baseline first

    writeFileSync(join(root, 'src', 'a.ts'), "export function run(): void { /* changed */ }\n");

    const after = await resolveFreshness(root);
    expect(after.status).toBe('stale');
    expect(after.currentSourceRevision).not.toBe(after.manifestSourceRevision);
    expect(after.manifestSourceRevision).toBe(before.manifestSourceRevision); // manifest itself untouched
  });

  it('is stale when a new file is added, even though every existing file is unchanged', async () => {
    await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    writeFileSync(join(root, 'src', 'c.ts'), 'export function extra(): void {}\n');
    const result = await resolveFreshness(root);
    expect(result.status).toBe('stale');
  });
});

describe('resolveFreshness — git target (HEAD-only, no working-tree leak)', () => {
  let root;
  beforeEach(() => { root = makeGitFixture(); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('is fresh right after analysis', async () => {
    await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    const result = await resolveFreshness(root);
    expect(result.status).toBe('fresh');
    expect(result.currentSourceRevision).toMatch(/^git:/);
  });

  it('verify-the-instrument: a DIRTY working tree with HEAD unchanged is still fresh — no working-tree leak', async () => {
    await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    const clean = await resolveFreshness(root);
    expect(clean.status).toBe('fresh');

    // Dirty the working tree three ways: modify a tracked file (unstaged),
    // stage a change, and add an untracked file. None of this touches HEAD.
    writeFileSync(join(root, 'src', 'a.ts'), 'export function run(): void { /* dirty, uncommitted */ }\n');
    git(root, ['add', 'src/a.ts']);
    writeFileSync(join(root, 'src', 'new-untracked.ts'), 'export const x = 1;\n');

    const dirty = await resolveFreshness(root);
    expect(dirty.status).toBe('fresh');
    expect(dirty.currentSourceRevision).toBe(clean.currentSourceRevision);

    // The negative control that proves this is a REAL comparison, not a
    // helper that always reports fresh for a git target: actually committing
    // the dirty state moves HEAD, and that DOES flip the status.
    git(root, ['commit', '-am', 'commit the dirty change']);
    const afterCommit = await resolveFreshness(root);
    expect(afterCommit.status).toBe('stale');
    expect(afterCommit.currentSourceRevision).not.toBe(clean.currentSourceRevision);
  });
});
