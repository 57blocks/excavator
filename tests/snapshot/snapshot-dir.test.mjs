// The temporary directory a snapshot materializes into, and telling its name
// apart from a project's (openspec: changes/viewer-explorer, design D4d).
//
// Purpose-built synthetic fixtures only (AGENTS.md: no real-project source).
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { resolveSourceSnapshot } from '../../skills/excavator/source-snapshot.mjs';
import { isSnapshotDirName, makeSnapshotDir, SNAPSHOT_DIR_KINDS } from '../../skills/excavator/source-snapshot/snapshot-dir.mjs';

describe('snapshot directory names', () => {
  it('recognizes the name of every kind of snapshot directory it makes', () => {
    for (const kind of SNAPSHOT_DIR_KINDS) {
      const dir = makeSnapshotDir(kind);
      try {
        expect(isSnapshotDirName(basename(dir))).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('does not take a project name for a snapshot directory', () => {
    for (const name of ['my-project', 'excavator', 'excavator-snapshot-dir', 'excavator-snapshot-dir-abc', 'excavator-snapshot-zip-Ab12Cd', 'excavator-snapshot-git-Ab12Cd-x', '', null, undefined]) {
      expect(isSnapshotDirName(name)).toBe(false);
    }
  });

  it('a directory and a git project materialize into a directory with such a name', () => {
    const root = mkdtempSync(join(tmpdir(), 'excavator-snapdir-fixture-'));
    try {
      writeFileSync(join(root, 'a.ts'), 'export const a = 1;\n');
      const kinds = [];
      for (const setup of [() => {}, () => {
        const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { stdio: 'ignore' });
        git('init', '-q');
        git('add', 'a.ts');
        git('commit', '-q', '-m', 'init');
      }]) {
        setup();
        const snapshot = resolveSourceSnapshot(root);
        const materialized = snapshot.materialize();
        try {
          kinds.push(snapshot.kind);
          expect(isSnapshotDirName(basename(materialized.dir))).toBe(true);
        } finally {
          materialized.cleanup();
        }
      }
      expect(kinds).toEqual(['directory', 'git']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
