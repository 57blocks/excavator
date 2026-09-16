// SourceSnapshot / Task 2 — GitCommitSnapshot, HEAD-only
// (openspec: changes/source-snapshot, capability `source-snapshot`).
//
// Purpose-built synthetic git fixtures only (AGENTS.md: no real-project
// source). Every fixture commits with a fixed author so the produced shas
// are irrelevant to assertions (we always re-derive the expected sha via
// `git rev-parse HEAD` rather than hardcoding one).
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdtempSync, rmSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { resolveSourceSnapshot, GitCommitSnapshot } from '../../skills/excavator/source-snapshot.mjs';

function git(root, args) {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: root, encoding: 'utf-8' });
}

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'excavator-gitsnap-fixture-'));
  git(root, ['init', '-q']);
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'a.ts'), "export function a() { return 1; }\n");
  writeFileSync(join(root, 'README.md'), '# fixture\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'initial']);
  return root;
}

function headSha(root) {
  return git(root, ['rev-parse', 'HEAD']).trim();
}

describe('GitCommitSnapshot — HEAD-only revision', () => {
  let root;
  beforeEach(() => { root = makeFixture(); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('resolves a git repo root to a GitCommitSnapshot with revision git:<full-head-sha>', () => {
    const snapshot = resolveSourceSnapshot(root);
    expect(snapshot).toBeInstanceOf(GitCommitSnapshot);
    expect(snapshot.kind).toBe('git');
    expect(snapshot.revision).toBe(`git:${headSha(root)}`);
  });

  it('listFiles/readFile reflect exactly the committed tree', () => {
    const snapshot = resolveSourceSnapshot(root);
    expect(snapshot.listFiles().sort()).toEqual(['README.md', 'src/a.ts']);
    expect(snapshot.readFile('src/a.ts').toString('utf-8')).toBe('export function a() { return 1; }\n');
  });

  it('staged, unstaged, and untracked changes do not move the revision or the read content', () => {
    const before = resolveSourceSnapshot(root);
    const beforeFiles = before.listFiles().sort();
    const beforeContent = before.readFile('src/a.ts').toString('utf-8');

    // Unstaged modification to a tracked file.
    writeFileSync(join(root, 'src', 'a.ts'), 'export function a() { return 999; }\n');
    // Staged new file.
    writeFileSync(join(root, 'src', 'staged.ts'), 'export const staged = true;\n');
    git(root, ['add', 'src/staged.ts']);
    // Untracked new file.
    writeFileSync(join(root, 'untracked.ts'), 'export const untracked = true;\n');

    const after = resolveSourceSnapshot(root);
    expect(after.revision).toBe(before.revision);
    expect(after.listFiles().sort()).toEqual(beforeFiles);
    expect(after.readFile('src/a.ts').toString('utf-8')).toBe(beforeContent);
  });

  it('prints the "Analyzing git:<short-sha>; uncommitted changes ignored" notice on resolution', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const snapshot = resolveSourceSnapshot(root);
      const shortSha = headSha(root).slice(0, 7);
      const printed = spy.mock.calls.map((c) => c[0]).join('');
      expect(printed).toContain(`Analyzing git:${shortSha}; uncommitted changes ignored`);
      expect(snapshot.revision).toContain(headSha(root));
    } finally {
      spy.mockRestore();
    }
  });

  it('reads .excavatorignore from HEAD, not from a dirty working-tree edit', () => {
    writeFileSync(join(root, '.excavatorignore'), 'ignored.txt\n');
    writeFileSync(join(root, 'ignored.txt'), 'should not be analyzed\n');
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'add excavatorignore']);

    const committed = resolveSourceSnapshot(root);
    expect(committed.listFiles()).not.toContain('ignored.txt');

    // Dirty, UNSTAGED edit that would un-ignore the file if it were honored.
    writeFileSync(join(root, '.excavatorignore'), '# nothing ignored now\n');

    const stillHead = resolveSourceSnapshot(root);
    expect(stillHead.revision).toBe(committed.revision);
    expect(stillHead.listFiles()).not.toContain('ignored.txt');
  });

  it('never materializes sensitive committed bytes', () => {
    writeFileSync(join(root, 'header.txt'), '-----BEGIN PRIVATE KEY-----\nGIT_CANARY\n');
    writeFileSync(join(root, 'extension.key'), 'GIT_EXTENSION_CANARY\n');
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'add synthetic secrets']);

    const snapshot = resolveSourceSnapshot(root);
    expect(snapshot.listFiles()).not.toContain('header.txt');
    expect(snapshot.listFiles()).not.toContain('extension.key');
    expect(snapshot.selection.sensitive).toBe(2);
    expect(snapshot.search(['GIT_CANARY', 'GIT_EXTENSION_CANARY'])).toEqual([]);
    const materialized = snapshot.materialize();
    try {
      expect(existsSync(join(materialized.dir, 'header.txt'))).toBe(false);
      expect(existsSync(join(materialized.dir, 'extension.key'))).toBe(false);
    } finally {
      materialized.cleanup();
    }
  });

  it('preserves a committed symlink as a named processing skip instead of a regular file', () => {
    symlinkSync('src/a.ts', join(root, 'linked.ts'));
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'add symlink']);

    const snapshot = resolveSourceSnapshot(root);
    expect(snapshot.listFiles()).not.toContain('linked.ts');
    expect(snapshot.selection.entries).toContainEqual({ kind: 'selected', path: 'linked.ts' });
    expect(snapshot.processingSkips).toContainEqual({ path: 'linked.ts', reason: 'symlink' });
    const materialized = snapshot.materialize();
    try {
      expect(existsSync(join(materialized.dir, 'linked.ts'))).toBe(false);
    } finally {
      materialized.cleanup();
    }
  });
});
