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

/**
 * Fix A: revision folds sorted (member relative path + member HEAD) AND the
 * parent (non-member) directory digest into one composite hash, so a
 * parent-only content change also changes `revision` (source-snapshot spec,
 * UPDATED "MultiRepoSnapshot 由成员 HEAD 决定" requirement). Independently
 * reimplemented here (not calling into manifest.mjs) so this test would
 * actually catch a bug in that formula, not just echo it.
 *
 * In `makeFixture()`, the parent's only non-member content is `README.md`
 * ('# workspace\n') — member-a/ and member-b/ are carved out.
 */
function expectedRevision(root) {
  const shaA = git(join(root, 'member-a'), ['rev-parse', 'HEAD']).trim();
  const shaB = git(join(root, 'member-b'), ['rev-parse', 'HEAD']).trim();
  const memberHash = createHash('sha256');
  memberHash.update('excavator:multi-repo-members:v1\0');
  for (const [id, sha] of [['member-a', shaA], ['member-b', shaB]].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
    memberHash.update(id); memberHash.update('\0'); memberHash.update(sha); memberHash.update('\n');
  }
  const memberDigest = memberHash.digest('hex');

  const readmeHash = createHash('sha256').update(readFileSync(join(root, 'README.md'))).digest('hex');
  const parentHash = createHash('sha256');
  parentHash.update('excavator:source-manifest:v1\0');
  parentHash.update('README.md'); parentHash.update('\0'); parentHash.update(readmeHash); parentHash.update('\n');
  const parentDigest = parentHash.digest('hex');

  const composite = createHash('sha256');
  composite.update('excavator:multi-repo-revision:v1\0');
  composite.update(memberDigest);
  composite.update('\0');
  composite.update(parentDigest);
  return `multi-repo:${composite.digest('hex')}`;
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

  it('revision is sha256 over sorted (member relative path + member HEAD) folded with the parent directory digest', () => {
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

  it('combines parent/member ledgers with each member prefix exactly once', () => {
    const snapshot = resolveSourceSnapshot(root);
    const paths = snapshot.selection.entries.map((entry) => entry.path);
    expect(paths).toContain('README.md');
    expect(paths).toContain('member-a/index.ts');
    expect(paths).toContain('member-b/index.ts');
    expect(paths.some((path) => path.includes('member-a/member-a/'))).toBe(false);
    expect(new Set(paths).size).toBe(paths.length);
    expect(snapshot.selection.candidates).toBe(
      snapshot.selection.selected
      + snapshot.selection.filteredByDefaults
      + snapshot.selection.filteredByIgnore
      + snapshot.selection.sensitive,
    );
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

describe('MultiRepoSnapshot — Fix A: parent non-member content is folded into the revision', () => {
  let root;
  beforeEach(() => { root = makeFixture(); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('a parent non-member file change changes the revision; a member working-tree change does not', () => {
    const before = resolveSourceSnapshot(root);

    // Member working-tree change (uncommitted) — the member is read as its
    // HEAD only, so this must NOT change the multi-repo revision.
    writeFileSync(join(root, 'member-a', 'index.ts'), 'export const a = 999;\n');
    const afterMemberEdit = resolveSourceSnapshot(root);
    expect(afterMemberEdit.revision).toBe(before.revision);

    // Restore, so the next assertion isolates the parent-content effect.
    writeFileSync(join(root, 'member-a', 'index.ts'), 'export const a = 1;\n');

    // Parent (non-member) file change — MUST change the revision (Fix A):
    // otherwise a parent-only edit would never produce a freshness mismatch
    // and revision-sync would silently miss it.
    writeFileSync(join(root, 'README.md'), '# workspace, edited\n');
    const afterParentEdit = resolveSourceSnapshot(root);
    expect(afterParentEdit.revision).not.toBe(before.revision);
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
