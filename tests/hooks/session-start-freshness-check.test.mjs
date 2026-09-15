// Group 4 (openspec: changes/full-semantic-isolation, capability
// `consumer-freshness`) — the SessionStart hook's staleness DECISION now
// comes from the shared `resolveFreshness` helper instead of an inline
// meta.json gitCommitHash / `git rev-parse HEAD` shell comparison.
//
// Purpose-built synthetic fixtures only (AGENTS.md: no real-project source).
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runLazyAnalysis } from '../../skills/excavator/lazy-analyze.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');
const HOOK_SCRIPT = join(repoRoot, 'hooks', 'session-start-freshness-check.mjs');

const FIXED_NOW = () => '2024-01-01T00:00:00.000Z';

function run(cwd) {
  return spawnSync(process.execPath, [HOOK_SCRIPT], { cwd, encoding: 'utf-8' });
}

let root;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'excavator-session-start-freshness-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function writeConfig(autoUpdate = true) {
  mkdirSync(join(root, '.excavator'), { recursive: true });
  writeFileSync(join(root, '.excavator', 'config.json'), JSON.stringify({ autoUpdate }));
}

describe('session-start-freshness-check.mjs — the decision, not the message', () => {
  it('exits non-zero (silent) when autoUpdate is disabled', () => {
    writeConfig(false);
    writeFileSync(join(root, '.excavator', 'knowledge-graph.json'), '{}');
    const result = run(root);
    expect(result.status).not.toBe(0);
  });

  it('exits non-zero when there is no config.json at all', () => {
    mkdirSync(join(root, '.excavator'), { recursive: true });
    writeFileSync(join(root, '.excavator', 'knowledge-graph.json'), '{}');
    const result = run(root);
    expect(result.status).not.toBe(0);
  });

  it('exits non-zero for a malformed config.json', () => {
    mkdirSync(join(root, '.excavator'), { recursive: true });
    writeFileSync(join(root, '.excavator', 'config.json'), '{not-json');
    writeFileSync(join(root, '.excavator', 'knowledge-graph.json'), '{}');
    const result = run(root);
    expect(result.status).not.toBe(0);
  });

  it('exits non-zero when there is no knowledge-graph.json yet', () => {
    writeConfig(true);
    const result = run(root);
    expect(result.status).not.toBe(0);
  });

  it('exits non-zero (fresh) right after analysis', async () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'hook-fixture' }));
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'a.ts'), 'export function run(): void {}\n');
    await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    writeConfig(true);

    const result = run(root);
    expect(result.status).not.toBe(0);
  });

  it('exits 0 (stale) once the source changes after analysis — the same signal every consumer skill uses', async () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'hook-fixture' }));
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'a.ts'), 'export function run(): void {}\n');
    await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    writeConfig(true);

    writeFileSync(join(root, 'src', 'a.ts'), 'export function run(): void { /* changed */ }\n');

    const result = run(root);
    expect(result.status).toBe(0);
  });

  it('never writes to stdout — hooks.json owns the user-facing message text', async () => {
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'hook-fixture' }));
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'a.ts'), 'export function run(): void {}\n');
    await runLazyAnalysis({ projectRoot: root, now: FIXED_NOW });
    writeConfig(true);
    writeFileSync(join(root, 'src', 'a.ts'), 'export function run(): void { /* changed */ }\n');

    const result = run(root);
    expect(result.stdout).toBe('');
  });
});

describe('hooks.json SessionStart command wires the new script in, message text unchanged', () => {
  const hooksConfig = JSON.parse(readFileSync(join(repoRoot, 'hooks', 'hooks.json'), 'utf8'));
  const command = hooksConfig.hooks.SessionStart[0].hooks[0].command;

  it('invokes session-start-freshness-check.mjs to decide, and echoes the propose-and-wait message on success', () => {
    expect(command).toContain('session-start-freshness-check.mjs');
    expect(command).toMatch(/propose/i);
    expect(command).toMatch(/wait for the user/i);
    expect(command).not.toContain('gitCommitHash');
    expect(command).not.toMatch(/git rev-parse HEAD/);
  });
});
