// Table-driven tests for install.sh (Codex only — see openspec/changes/
// excavator-rename design D6). Runs the real script against a temporary
// $HOME so nothing touches the developer's actual dotfiles.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');
const installScript = join(repoRoot, 'install.sh');

const skillNames = readdirSync(join(repoRoot, 'skills'), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

function run(args, home) {
  return spawnSync(installScript, args, {
    env: { ...process.env, HOME: home },
    encoding: 'utf-8',
  });
}

describe('install.sh (Codex)', () => {
  let tempHome;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'excavator-install-test-'));
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
  });

  it('discovers exactly the 8 shipped service skills', () => {
    expect(skillNames.length).toBe(8);
    expect(skillNames).toContain('excavator');
    expect(skillNames).toContain('excavator-chat');
    expect(skillNames).toContain('excavator-diff');
    expect(skillNames).toContain('excavator-domain');
    expect(skillNames).toContain('excavator-explain');
    expect(skillNames).toContain('excavator-figma');
    expect(skillNames).toContain('excavator-knowledge');
    expect(skillNames).toContain('excavator-onboard');
  });

  it('symlinks the plugin root to ~/.excavator-plugin, pointing at this checkout', () => {
    const result = run([], tempHome);
    expect(result.status, result.stderr).toBe(0);
    const link = join(tempHome, '.excavator-plugin');
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(realpathSync(link)).toBe(realpathSync(repoRoot));
  });

  it.each(skillNames)(
    'symlinks skills/%s into ~/.agents/skills/%s with a reachable SKILL.md',
    (name) => {
      const result = run([], tempHome);
      expect(result.status, result.stderr).toBe(0);
      const link = join(tempHome, '.agents', 'skills', name);
      expect(lstatSync(link).isSymbolicLink()).toBe(true);
      expect(realpathSync(link)).toBe(realpathSync(join(repoRoot, 'skills', name)));
      expect(existsSync(join(link, 'SKILL.md'))).toBe(true);
    },
  );

  it('--uninstall removes every symlink it created and nothing else under HOME', () => {
    const installResult = run([], tempHome);
    expect(installResult.status, installResult.stderr).toBe(0);
    // Sentinel: an unrelated pre-existing file under HOME must survive.
    writeFileSync(join(tempHome, 'unrelated.txt'), 'keep me\n');

    const result = run(['--uninstall'], tempHome);
    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(join(tempHome, '.excavator-plugin'))).toBe(false);
    for (const name of skillNames) {
      expect(existsSync(join(tempHome, '.agents', 'skills', name))).toBe(false);
    }
    expect(existsSync(join(tempHome, 'unrelated.txt'))).toBe(true);
  });

  it('is idempotent — running install twice succeeds and results are unchanged', () => {
    const first = run([], tempHome);
    expect(first.status, first.stderr).toBe(0);
    const second = run([], tempHome);
    expect(second.status, second.stderr).toBe(0);
    expect(realpathSync(join(tempHome, '.excavator-plugin'))).toBe(realpathSync(repoRoot));
    for (const name of skillNames) {
      expect(
        realpathSync(join(tempHome, '.agents', 'skills', name)),
      ).toBe(realpathSync(join(repoRoot, 'skills', name)));
    }
  });

  it('does not create the plugin-root symlink when already run from ~/.excavator-plugin', () => {
    // Simulate "git clone ... ~/.excavator-plugin" by making that path a
    // real directory (not a symlink) whose realpath equals the checkout —
    // exercised here via a symlink for portability, matching the script's
    // own realpath-equality check.
    const preExisting = join(tempHome, '.excavator-plugin');
    symlinkSync(repoRoot, preExisting);
    const result = run([], tempHome);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('already resolves to this checkout');
    expect(realpathSync(preExisting)).toBe(realpathSync(repoRoot));
  });

  it('--help prints usage and exits 0 without touching HOME', () => {
    const result = run(['--help'], tempHome);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Usage:/);
    expect(existsSync(join(tempHome, '.excavator-plugin'))).toBe(false);
    expect(existsSync(join(tempHome, '.agents'))).toBe(false);
  });

  it('rejects an unknown option', () => {
    const result = run(['--bogus'], tempHome);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/Unknown option/);
  });
});
