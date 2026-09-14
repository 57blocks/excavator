// SourceSnapshot / Task 3 — MultiRepoSnapshot (member HEAD + parent directory)
// (openspec: changes/source-snapshot, capability `source-snapshot`).
//
// Purpose-built synthetic fixtures only (AGENTS.md: no real-project source).
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import { resolveSourceSnapshot, GitCommitSnapshot, MultiRepoSnapshot } from '../../skills/excavator/source-snapshot.mjs';

function git(dir, args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dir, encoding: 'utf-8' });
}

function makeMemberRepo(dir, fileContent) {
  mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q']);
  writeFileSync(join(dir, 'index.ts'), fileContent);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'initial']);
}

/** parent (non-git) + two member git repos + one parent-only file. */
function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'excavator-multirepo-fixture-'));
  writeFileSync(join(root, 'README.md'), '# workspace\n');
  makeMemberRepo(join(root, 'member-a'), "export const a = 1;\n");
  makeMemberRepo(join(root, 'member-b'), "export const b = 2;\n");
  return root;
}

function expectedRevision(root) {
  const shaA = git(join(root, 'member-a'), ['rev-parse', 'HEAD']).trim();
  const shaB = git(join(root, 'member-b'), ['rev-parse', 'HEAD']).trim();
  const hash = createHash('sha256');
  hash.update('excavator:multi-repo-members:v1\0');
  for (const [id, sha] of [['member-a', shaA], ['member-b', shaB]].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
    hash.update(id); hash.update('\0'); hash.update(sha); hash.update('\n');
  }
  return `multi-repo:${hash.digest('hex')}`;
}

describe('MultiRepoSnapshot — detection and revision', () => {
  let root;
  beforeEach(() => { root = makeFixture(); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('resolves a non-git parent with git member repos to a MultiRepoSnapshot', () => {
    const snapshot = resolveSourceSnapshot(root);
    expect(snapshot).toBeInstanceOf(MultiRepoSnapshot);
    expect(snapshot.kind).toBe('multi-repo');
    expect(snapshot.members.map((m) => m.id).sort()).toEqual(['member-a', 'member-b']);
  });

  it('revision is sha256 over sorted (member relative path + member HEAD)', () => {
    const snapshot = resolveSourceSnapshot(root);
    expect(snapshot.revision).toBe(expectedRevision(root));
  });

  it('listFiles includes member-prefixed paths and parent non-member files', () => {
    const snapshot = resolveSourceSnapshot(root);
    const files = snapshot.listFiles();
    expect(files).toContain('README.md');
    expect(files).toContain('member-a/index.ts');
    expect(files).toContain('member-b/index.ts');
  });

  it('readFile dispatches to the right member (or the parent) transparently', () => {
    const snapshot = resolveSourceSnapshot(root);
    expect(snapshot.readFile('member-a/index.ts').toString('utf-8')).toBe('export const a = 1;\n');
    expect(snapshot.readFile('README.md').toString('utf-8')).toBe('# workspace\n');
  });
});

describe('MultiRepoSnapshot — member working-tree changes do not affect the result', () => {
  let root;
  beforeEach(() => { root = makeFixture(); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('an uncommitted change inside a member repo leaves revision and content unchanged', () => {
    const before = resolveSourceSnapshot(root);
    writeFileSync(join(root, 'member-a', 'index.ts'), 'export const a = 999;\n'); // unstaged
    writeFileSync(join(root, 'member-a', 'untracked.ts'), 'export const u = 1;\n'); // untracked

    const after = resolveSourceSnapshot(root);
    expect(after.revision).toBe(before.revision);
    expect(after.readFile('member-a/index.ts').toString('utf-8')).toBe('export const a = 1;\n');
    expect(after.listFiles()).not.toContain('member-a/untracked.ts');
  });
});

describe('MultiRepoSnapshot — detection order: a git parent is GitCommitSnapshot, never multi-repo', () => {
  it('a parent that is ITSELF a git repo resolves to GitCommitSnapshot even with git-like subdirectories', () => {
    const root = mkdtempSync(join(tmpdir(), 'excavator-multirepo-parentgit-'));
    try {
      git(root, ['init', '-q']);
      writeFileSync(join(root, 'README.md'), '# parent is a repo\n');
      git(root, ['add', '-A']);
      git(root, ['commit', '-q', '-m', 'initial']);
      // A nested directory that ALSO happens to have its own .git — should
      // never cause the top-level detection to become multi-repo: D2 gives
      // GitCommitSnapshot priority whenever root itself is a repo.
      makeMemberRepo(join(root, 'nested-repo-like'), 'export const x = 1;\n');

      const snapshot = resolveSourceSnapshot(root);
      expect(snapshot).toBeInstanceOf(GitCommitSnapshot);
      expect(snapshot.kind).toBe('git');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('MultiRepoSnapshot — materialize()', () => {
  let root;
  beforeEach(() => { root = makeFixture(); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('lays out temp/<memberId>/... for each member plus parent files at the temp root', () => {
    const snapshot = resolveSourceSnapshot(root);
    const materialized = snapshot.materialize();
    try {
      expect(existsSync(join(materialized.dir, 'member-a', 'index.ts'))).toBe(true);
      expect(existsSync(join(materialized.dir, 'member-b', 'index.ts'))).toBe(true);
      expect(existsSync(join(materialized.dir, 'README.md'))).toBe(true);
      expect(readFileSync(join(materialized.dir, 'member-a', 'index.ts'), 'utf-8')).toBe('export const a = 1;\n');
    } finally {
      materialized.cleanup();
    }
  });
});
