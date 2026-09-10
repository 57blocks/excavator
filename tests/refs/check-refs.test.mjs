// Tests for scripts/check-refs.mjs — the cross-reference integrity gate
// (design D8). Two cases: the real repository must pass, and a copy with
// one broken reference (an instrument, proving the gate can actually see a
// known-bad state) must fail and name the broken agent.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');
function runCheckRefs(repoDir) {
  // check-refs.mjs resolves its own REPO_ROOT from import.meta.url (its own
  // location), not from cwd — so the instrument test must run the copy's
  // own script, not the original repo's, or it would silently check the
  // original tree regardless of what was renamed in the copy.
  return spawnSync(process.execPath, [join(repoDir, 'scripts', 'check-refs.mjs')], {
    cwd: repoDir,
    encoding: 'utf-8',
  });
}

describe('check-refs.mjs', () => {
  it('exits 0 against the real repository and reports what it checked', () => {
    const result = runCheckRefs(repoRoot);
    expect(result.status, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0);
    expect(result.stdout).toMatch(/\d+ skills, \d+ agents checked/);
    expect(result.stdout).toMatch(/agent references checked: \d+/);
    expect(result.stdout).toMatch(/slash references checked: \d+/);
    expect(result.stdout).toMatch(/script path references checked: \d+/);
    expect(result.stdout).toMatch(/hooks\.json plugin-root paths checked: \d+/);
    expect(result.stdout).toMatch(/locale key entries checked: \d+/);
    expect(result.stdout).toContain('All references resolved. OK.');
  });

  describe('instrument: a copy with one renamed agent file must fail loudly', () => {
    let tempRepo;

    afterEach(() => {
      if (tempRepo) rmSync(tempRepo, { recursive: true, force: true });
    });

    it('exits non-zero and names the missing agent and a file that referenced it', () => {
      tempRepo = mkdtempSync(join(tmpdir(), 'check-refs-instrument-'));
      const rsync = spawnSync(
        'rsync',
        [
          '-a',
          '--exclude=node_modules',
          '--exclude=dist',
          '--exclude=.git',
          `${repoRoot}/`,
          `${tempRepo}/`,
        ],
        { encoding: 'utf-8' },
      );
      expect(rsync.status, rsync.stderr).toBe(0);

      // skills/excavator/SKILL.md and hooks/auto-update-prompt.md both
      // reference agents/excavator-file-analyzer.md — renaming it breaks
      // both check 1 (name/file mismatch) and check 2 (dangling reference).
      renameSync(
        join(tempRepo, 'agents', 'excavator-file-analyzer.md'),
        join(tempRepo, 'agents', 'excavator-file-analyzer-renamed.md'),
      );

      const result = runCheckRefs(tempRepo);
      expect(result.status).not.toBe(0);
      expect(result.stdout + result.stderr).toContain('excavator-file-analyzer');
      expect(result.stdout + result.stderr).toMatch(
        /skills\/excavator\/SKILL\.md references agents\/excavator-file-analyzer\.md/,
      );
    });
  });
});
