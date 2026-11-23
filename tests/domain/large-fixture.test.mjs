/**
 * The large measurement fixture keeps the premise the PR's before/after
 * numbers rest on: 30 backend modules, a deterministic tree, and fewer entry
 * points than the 200 the old extractor kept, so a gap in a single-analyzer
 * run comes from the analyzer and not from an extractor cap.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LARGE_MODULES, writeLargeMultiModuleProject } from '../fixtures/domain-areas/large-multi-module.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const EXTRACT = resolve(repoRoot, 'skills/excavator-domain/extract-domain-context.py');

const roots = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop(), { recursive: true, force: true });
});

describe('large multi-module fixture', () => {
  it('is deterministic and stays under the old 200 entry-point cap', () => {
    const a = mkdtempSync(join(tmpdir(), 'domain-large-'));
    const b = mkdtempSync(join(tmpdir(), 'domain-large-'));
    roots.push(a, b);
    const files = writeLargeMultiModuleProject(a);
    expect(writeLargeMultiModuleProject(b)).toEqual(files);
    for (const file of files.filter((f) => f.includes('/modules/'))) {
      expect(readFileSync(join(b, file), 'utf-8')).toBe(readFileSync(join(a, file), 'utf-8'));
    }
    expect(LARGE_MODULES).toHaveLength(30);
    const result = spawnSync('python3', [EXTRACT, a], { encoding: 'utf-8' });
    if (result.error) throw result.error;
    expect(result.status, result.stderr).toBe(0);
    const context = JSON.parse(readFileSync(join(a, '.excavator/intermediate/domain-context.json'), 'utf-8'));
    expect(context.entryPoints.length).toBeGreaterThan(100);
    expect(context.entryPoints.length).toBeLessThan(200);
    const withEntries = new Set(context.entryPoints.map((e) => dirname(e.file)));
    for (const module of LARGE_MODULES) expect(withEntries.has(module), module).toBe(true);
  });
});
