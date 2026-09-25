import { describe, expect, it, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { pickSmokeNode, TOOLS_IN_ORDER } from '../../deploy/mcp-smoke.mjs';

const repoRoot = process.cwd();
const smokeScript = resolve(repoRoot, 'deploy/mcp-smoke.mjs');
const lazyAnalyzeScript = resolve(repoRoot, 'skills/excavator/lazy-analyze.mjs');

const cleanup = [];
afterEach(() => { while (cleanup.length) cleanup.pop()(); });

describe('pickSmokeNode (pure)', () => {
  it('returns null for an empty graph', () => {
    expect(pickSmokeNode({ nodes: [] })).toBeNull();
    expect(pickSmokeNode(null)).toBeNull();
  });

  it('prefers a file-type node with a filePath', () => {
    const graph = { nodes: [
      { id: 'function:a.js:f()', type: 'function', filePath: 'a.js' },
      { id: 'file:b.js', type: 'file', filePath: 'b.js' },
    ] };
    expect(pickSmokeNode(graph).id).toBe('file:b.js');
  });

  it('falls back to any node with a filePath, then to the first node', () => {
    const graph = { nodes: [{ id: 'function:a.js:f()', type: 'function', filePath: 'a.js' }] };
    expect(pickSmokeNode(graph).id).toBe('function:a.js:f()');
  });
});

describe('mcp-smoke.mjs end to end (task 2.8), against a real lazy-analyzed synthetic repo', () => {
  it('calls all seven tools and exits 0', () => {
    const dir = mkdtempSync(join(tmpdir(), 'excavator-mcp-smoke-'));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));

    writeFileSync(join(dir, 'index.js'), 'function add(a, b) {\n  return a + b;\n}\nmodule.exports = { add };\n');
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'smoke@excavator.local'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'Excavator Smoke'], { cwd: dir });
    execFileSync('git', ['add', '-A'], { cwd: dir });
    execFileSync('git', ['commit', '-q', '-m', 'initial'], { cwd: dir });

    const lazy = spawnSync(process.execPath, [lazyAnalyzeScript, dir], { encoding: 'utf-8' });
    expect(lazy.status).toBe(0);

    const smoke = spawnSync(process.execPath, [smokeScript, '--project-root', dir], { encoding: 'utf-8' });
    if (smoke.status !== 0) {
      console.error('mcp-smoke stdout:\n', smoke.stdout, '\nstderr:\n', smoke.stderr);
    }
    expect(smoke.status).toBe(0);

    for (const tool of TOOLS_IN_ORDER) {
      expect(smoke.stdout).toMatch(new RegExp(`PASS ${tool}`));
    }
    expect(smoke.stdout).not.toMatch(/FAIL/);
  }, 30_000);

  it('fails cleanly with a non-zero exit when no facts exist yet', () => {
    const dir = mkdtempSync(join(tmpdir(), 'excavator-mcp-smoke-nofacts-'));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
    mkdirSync(join(dir, 'src'));

    const smoke = spawnSync(process.execPath, [smokeScript, '--project-root', dir], { encoding: 'utf-8' });
    expect(smoke.status).not.toBe(0);
    expect(smoke.stderr).toMatch(/knowledge-graph\.json/);
  });
});
